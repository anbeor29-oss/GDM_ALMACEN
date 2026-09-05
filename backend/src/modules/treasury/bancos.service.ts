/**
 * bancos.service — cuentas bancarias, estados de cuenta y el saldo al corte.
 *
 * PARA QUÉ
 * Tesorería programaba pagos sin saber cuánto hay en el banco. El saldo vivía
 * en el portal y en la cabeza de quien lo consultaba; al armar una remesa de
 * $49,075 nadie podía decir si la cuenta lo aguantaba.
 *
 * EL SALDO ES "AL CORTE", Y ASÍ SE DICE
 * Lo que muestra el sistema es el saldo final del último estado de cuenta
 * procesado, más los movimientos de ese estado. NO es el saldo en tiempo real:
 * llamarlo así sería mentir, porque entre el corte y hoy pasaron cheques,
 * cargos automáticos y comisiones que el banco todavía no reportó.
 *
 * VOLVER A CARGAR UN MES REEMPLAZA
 * Un estado de cuenta es un documento cerrado. Cargar dos veces el de julio y
 * acumular los movimientos daría un saldo del doble, y nadie lo notaría hasta
 * cuadrar contra el banco. Por eso la carga es un reemplazo, dentro de una
 * transacción: o queda el estado nuevo completo, o queda el anterior intacto.
 */

import { PoolClient } from 'pg';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError, ConflictError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import { extraerMovimientos, ResultadoExtraccion } from './extractor-movimientos.service';
import { BANKS_MX } from '../suppliers/banks-mx';
import ExcelJS from 'exceljs';

const pesos = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

/* ═══════════════════ CUENTAS ═══════════════════ */

export interface DatosCuenta {
  bancoClave?: string;
  bancoNombre?: string;
  alias?: string;
  numeroCuenta?: string;
  clabe?: string;
  moneda?: string;
  saldoInicial?: number;
  saldoInicialFecha?: string;
  notas?: string;
  cuentaContableId?: string | null;
}

function validarClabe(clabe?: string): string | null {
  const c = String(clabe || '').replace(/\D/g, '');
  if (!c) return null;
  if (c.length !== 18) {
    throw new ValidationError('La CLABE debe tener exactamente 18 dígitos');
  }
  return c;
}

/**
 * Que la CLABE corresponda al banco elegido.
 *
 * Los TRES PRIMEROS DÍGITOS de la CLABE son la clave del banco. Si no cuadran,
 * una de las dos cosas está mal capturada — y el que se entera es el dinero: la
 * transferencia rebota, o peor, sale a la institución equivocada.
 *
 * Se avisa con las dos claves a la vista, no con un "dato inválido": quien
 * captura tiene que poder ver cuál de los dos corrigió mal.
 */
function revisarClabeContraBanco(clabe: string | null, bancoClave?: string) {
  if (!clabe || !bancoClave) return;
  const delaClabe = clabe.slice(0, 3);
  if (delaClabe !== String(bancoClave).padStart(3, '0')) {
    const banco = BANKS_MX.find((b) => b.code === delaClabe);
    throw new ValidationError(
      `La CLABE empieza con ${delaClabe}` +
      (banco ? ` (${banco.name})` : '') +
      `, pero el banco elegido tiene la clave ${bancoClave}. Los tres primeros ` +
      'dígitos de la CLABE SON la clave del banco: uno de los dos está mal, y ' +
      'con la clave equivocada la transferencia rebota.'
    );
  }
}

export async function crearCuenta(companyId: string, d: DatosCuenta) {
  const alias = String(d.alias || '').trim().slice(0, 80);
  const banco = String(d.bancoNombre || '').trim().slice(0, 120);
  if (!alias) {
    throw new ValidationError(
      'Ponle un nombre a la cuenta —"Bancrea principal", "nómina", "dólares"—: ' +
      'el número de cuenta no distingue nada de un vistazo.'
    );
  }
  if (!banco) throw new ValidationError('Falta el banco');

  const clabe = validarClabe(d.clabe);
  revisarClabeContraBanco(clabe, d.bancoClave);
  const moneda = String(d.moneda || 'MXN').toUpperCase().slice(0, 3);

  try {
    const r = await query<any>(
      `INSERT INTO bancos_cuentas
         (company_id, banco_clave, banco_nombre, alias, numero_cuenta, clabe,
          moneda, saldo_inicial, saldo_inicial_fecha, notas, cuenta_contable_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11)
       RETURNING *`,
      [companyId, d.bancoClave || null, banco, alias,
       String(d.numeroCuenta || '').trim().slice(0, 30) || null, clabe, moneda,
       pesos(d.saldoInicial), d.saldoInicialFecha || null,
       String(d.notas || '').trim() || null, d.cuentaContableId || null]
    );
    logger.info(`[bancos] cuenta dada de alta: ${alias} (${banco})`);
    return r.rows[0];
  } catch (e: any) {
    if (e?.code === '23505') {
      throw new ConflictError(
        'Ya hay una cuenta con esa CLABE en esta empresa. Dos cuentas con la ' +
        'misma CLABE es un error de captura, no dos cuentas.'
      );
    }
    throw e;
  }
}

export async function actualizarCuenta(companyId: string, id: string, d: DatosCuenta) {
  const campos: string[] = [];
  const args: any[] = [id, companyId];
  const set = (col: string, valor: any) => {
    args.push(valor);
    campos.push(`${col} = $${args.length}`);
  };

  if (d.alias !== undefined)        set('alias', String(d.alias).trim().slice(0, 80));
  if (d.bancoNombre !== undefined)  set('banco_nombre', String(d.bancoNombre).trim().slice(0, 120));
  if (d.bancoClave !== undefined)   set('banco_clave', d.bancoClave || null);
  if (d.numeroCuenta !== undefined) set('numero_cuenta', String(d.numeroCuenta).trim().slice(0, 30) || null);
  if (d.clabe !== undefined)        set('clabe', validarClabe(d.clabe));
  if (d.moneda !== undefined)       set('moneda', String(d.moneda).toUpperCase().slice(0, 3));
  if (d.notas !== undefined)        set('notas', String(d.notas).trim() || null);
  if (d.cuentaContableId !== undefined) set('cuenta_contable_id', d.cuentaContableId || null);

  /* El saldo inicial NO se cambia a la ligera: es el punto de partida de todo
   * el arrastre. Cambiarlo con estados ya cargados movería todos los saldos. */
  if (d.saldoInicial !== undefined) {
    const conEstados = await query<any>(
      `SELECT COUNT(*)::int n FROM bancos_estados_cuenta WHERE cuenta_id = $1`, [id]);
    if (conEstados.rows[0].n > 0) {
      throw new ConflictError(
        'Esta cuenta ya tiene estados de cuenta cargados: cambiar el saldo ' +
        'inicial movería todos los saldos calculados. Si el punto de partida ' +
        'estaba mal, borra los estados y vuelve a cargarlos.'
      );
    }
    set('saldo_inicial', pesos(d.saldoInicial));
    if (d.saldoInicialFecha !== undefined) set('saldo_inicial_fecha', d.saldoInicialFecha || null);
  }

  if (campos.length === 0) throw new ValidationError('No hay nada que cambiar');

  const r = await query<any>(
    `UPDATE bancos_cuentas SET ${campos.join(', ')}, updated_at = NOW()
      WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
      RETURNING *`,
    args
  );
  if (r.rows.length === 0) throw new NotFoundError('Cuenta no encontrada');
  return r.rows[0];
}

/**
 * Las cuentas con su saldo AL CORTE del último estado procesado.
 *
 * El saldo sale del último estado cargado, no de sumar movimientos sueltos: un
 * movimiento sin su estado da un saldo que no se puede verificar contra nada.
 */
export async function listarCuentas(companyId: string) {
  const r = await query<any>(
    `SELECT c.*,
            u.anio  AS ultimo_anio,
            u.mes   AS ultimo_mes,
            u.saldo_final AS saldo_al_corte,
            u.cuadra      AS ultimo_cuadra,
            u.con_advertencia AS ultimo_advertencias,
            (SELECT a.codigo FROM accounting_accounts a WHERE a.id = c.cuenta_contable_id) AS cuenta_contable_codigo,
            (SELECT COUNT(*)::int FROM bancos_estados_cuenta e
              WHERE e.cuenta_id = c.id) AS estados_cargados
       FROM bancos_cuentas c
       LEFT JOIN LATERAL (
         SELECT e.anio, e.mes, e.saldo_final, e.cuadra, e.con_advertencia
           FROM bancos_estados_cuenta e
          WHERE e.cuenta_id = c.id
          ORDER BY e.anio DESC, e.mes DESC
          LIMIT 1
       ) u ON true
      WHERE c.company_id = $1 AND c.deleted_at IS NULL
      ORDER BY c.activa DESC, c.alias`,
    [companyId]
  );

  return r.rows.map((x: any) => ({
    ...x,
    saldo_inicial: pesos(x.saldo_inicial),
    /* Sin estados cargados, el saldo que se conoce es el de partida. */
    saldo_al_corte: x.saldo_al_corte !== null && x.saldo_al_corte !== undefined
      ? pesos(x.saldo_al_corte)
      : pesos(x.saldo_inicial),
    /* Al corte de CUÁNDO. Sin esto, un saldo de hace cuatro meses se lee como
     * si fuera de hoy. */
    corte: x.ultimo_anio
      ? `${String(x.ultimo_mes).padStart(2, '0')}/${x.ultimo_anio}`
      : null,
  }));
}

export async function borrarCuenta(companyId: string, id: string) {
  const r = await query<any>(
    `UPDATE bancos_cuentas SET deleted_at = NOW(), activa = false
      WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL RETURNING id`,
    [id, companyId]
  );
  if (r.rows.length === 0) throw new NotFoundError('Cuenta no encontrada');
  return { id };
}

/* ═══════════════════ ESTADOS DE CUENTA ═══════════════════ */

export interface DatosCarga {
  cuentaId: string;
  anio: number;
  mes: number;
  texto: string;
  origen?: 'PDF' | 'TEXTO' | 'CSV';
  archivoNombre?: string;
}

/**
 * Procesa un estado de cuenta y lo guarda REEMPLAZANDO el del mismo mes.
 *
 * Todo va en una transacción: si algo falla a media carga, queda el estado
 * anterior intacto. Media carga sería peor que ninguna — un mes con la mitad de
 * los movimientos da un saldo plausible y equivocado.
 */
export async function cargarEstadoDeCuenta(
  companyId: string,
  d: DatosCarga,
  userId?: string
): Promise<{
  estado: any;
  extraccion: ResultadoExtraccion;
  reemplazo: boolean;
  /** Si el saldo inicial casa con el cierre del mes anterior. `null` si no hay con qué comparar. */
  enlaza: boolean | null;
}> {
  const anio = Number(d.anio);
  const mes = Number(d.mes);
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
    throw new ValidationError('El año del estado de cuenta no es válido');
  }
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new ValidationError('El mes debe ir de 1 a 12');
  }
  if (!String(d.texto || '').trim()) {
    throw new ValidationError('No hay texto que procesar');
  }

  const cuenta = await query<any>(
    `SELECT id, alias, saldo_inicial FROM bancos_cuentas
      WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
    [d.cuentaId, companyId]
  );
  if (cuenta.rows.length === 0) throw new NotFoundError('Cuenta no encontrada');

  const extraccion = extraerMovimientos(d.texto, { anio, mes });

  /* ── EL SALDO INICIAL TIENE QUE SER EL FINAL DEL MES ANTERIOR ──
   *
   * Es la comprobación que ata un mes con el siguiente. Sin ella, cada estado
   * cuadra consigo mismo y la serie completa puede estar rota: basta con que
   * falte un mes de por medio para que todos los saldos posteriores arrastren
   * el hueco, y cada uno por separado se vea perfecto.
   *
   * Se avisa, no se bloquea. Bloquear impediría cargar agosto antes que julio
   * —que es como llegan cuando alguien se pone al corriente— y dejaría sin
   * manera de corregir el mes que está mal. */
  const anterior = await query<any>(
    `SELECT anio, mes, saldo_final FROM bancos_estados_cuenta
      WHERE cuenta_id = $1 AND (anio < $2 OR (anio = $2 AND mes < $3))
      ORDER BY anio DESC, mes DESC LIMIT 1`,
    [d.cuentaId, anio, mes]
  );

  let enlaza: boolean | null = null;
  if (anterior.rows.length > 0 && anterior.rows[0].saldo_final !== null) {
    const finAnterior = pesos(anterior.rows[0].saldo_final);
    if (extraccion.saldoInicial === null) {
      extraccion.avisos.push(
        `El mes anterior (${String(anterior.rows[0].mes).padStart(2, '0')}/` +
        `${anterior.rows[0].anio}) cerró en ${finAnterior.toFixed(2)}, pero este ` +
        'documento no declara saldo inicial: no hay contra qué compararlo.'
      );
    } else {
      enlaza = Math.abs(extraccion.saldoInicial - finAnterior) <= 0.02;
      if (!enlaza) {
        extraccion.avisos.push(
          `NO ENLAZA CON EL MES ANTERIOR: ${String(anterior.rows[0].mes).padStart(2, '0')}/` +
          `${anterior.rows[0].anio} cerró en ${finAnterior.toFixed(2)} y éste abre en ` +
          `${extraccion.saldoInicial.toFixed(2)}. Faltan ` +
          `${pesos(Math.abs(extraccion.saldoInicial - finAnterior)).toFixed(2)} — ` +
          'o falta un mes de por medio, o una de las dos cargas está incompleta.'
        );
      }
    }
  } else if (anterior.rows.length === 0 && extraccion.saldoInicial !== null) {
    /* El primer mes se compara contra el saldo de partida de la cuenta. */
    const partida = pesos(cuenta.rows[0].saldo_inicial);
    if (Math.abs(extraccion.saldoInicial - partida) > 0.02) {
      extraccion.avisos.push(
        `Es el primer mes de esta cuenta y su saldo inicial (${extraccion.saldoInicial.toFixed(2)}) ` +
        `no coincide con el saldo de partida capturado (${partida.toFixed(2)}). ` +
        'Revisa cuál de los dos es el bueno antes de seguir cargando meses.'
      );
    } else {
      enlaza = true;
    }
  }

  return transaction(async (client: PoolClient) => {
    /* Reemplazo, no acumulación. Los movimientos se van con el estado por la
     * llave foránea en cascada. */
    const previo = await transactionQuery<any>(
      client,
      `DELETE FROM bancos_estados_cuenta
        WHERE cuenta_id = $1 AND anio = $2 AND mes = $3 RETURNING id`,
      [d.cuentaId, anio, mes]
    );
    const reemplazo = previo.rows.length > 0;

    const est = await transactionQuery<any>(
      client,
      `INSERT INTO bancos_estados_cuenta
         (company_id, cuenta_id, anio, mes, saldo_inicial, saldo_final, origen,
          archivo_nombre, banco_detectado, movimientos_total, total_retiros,
          total_depositos, con_advertencia, cuadra, procesado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [companyId, d.cuentaId, anio, mes,
       extraccion.saldoInicial, extraccion.saldoFinal,
       d.origen || 'TEXTO', d.archivoNombre || null, extraccion.banco,
       extraccion.movimientos.length, extraccion.totalRetiros,
       extraccion.totalDepositos, extraccion.conAdvertencia,
       extraccion.cuadra, userId || null]
    );
    const estadoId = est.rows[0].id;

    for (const m of extraccion.movimientos) {
      await transactionQuery(
        client,
        `INSERT INTO bancos_movimientos
           (company_id, cuenta_id, estado_id, fecha, concepto, referencia,
            retiro, deposito, saldo, saldo_calculado, advertencia, inferido,
            orden, linea_origen)
         VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [companyId, d.cuentaId, estadoId, m.fecha, m.concepto, m.referencia,
         m.retiro, m.deposito, m.saldo, m.saldoCalculado,
         m.advertencia || null, m.inferido, m.orden, m.lineaOrigen || null]
      );
    }

    logger.info(
      `[bancos] ${cuenta.rows[0].alias} ${mes}/${anio}: ` +
      `${extraccion.movimientos.length} movimiento(s), ` +
      `${extraccion.cuadra ? 'CUADRA' : 'NO CUADRA'}` +
      (reemplazo ? ' (reemplazó la carga anterior)' : '')
    );

    return { estado: est.rows[0], extraccion, reemplazo, enlaza };
  });
}

/** Los meses cargados de una cuenta, del más reciente al más viejo. */
export async function listarEstados(companyId: string, cuentaId: string) {
  const r = await query<any>(
    `SELECT e.*, u.email AS procesado_por_email
       FROM bancos_estados_cuenta e
       LEFT JOIN users u ON u.id = e.procesado_por
      WHERE e.company_id = $1 AND e.cuenta_id = $2
      ORDER BY e.anio DESC, e.mes DESC`,
    [companyId, cuentaId]
  );
  return r.rows;
}

export async function detalleEstado(companyId: string, estadoId: string) {
  const e = await query<any>(
    `SELECT e.*, c.alias, c.banco_nombre, c.moneda
       FROM bancos_estados_cuenta e
       JOIN bancos_cuentas c ON c.id = e.cuenta_id
      WHERE e.id = $1 AND e.company_id = $2`,
    [estadoId, companyId]
  );
  if (e.rows.length === 0) throw new NotFoundError('Estado de cuenta no encontrado');

  const m = await query<any>(
    `SELECT * FROM bancos_movimientos
      WHERE estado_id = $1 ORDER BY orden`,
    [estadoId]
  );
  return { estado: e.rows[0], movimientos: m.rows };
}

export async function borrarEstado(companyId: string, estadoId: string) {
  const r = await query<any>(
    `DELETE FROM bancos_estados_cuenta WHERE id = $1 AND company_id = $2
      RETURNING id, anio, mes`,
    [estadoId, companyId]
  );
  if (r.rows.length === 0) throw new NotFoundError('Estado de cuenta no encontrado');
  return r.rows[0];
}

/**
 * El control mes a mes de una cuenta: cada mes con su saldo y si cuadró.
 *
 * Los huecos importan tanto como los meses cargados. Un año con marzo y mayo
 * pero sin abril tiene un salto de saldo que no se explica solo, y verlo en la
 * lista es lo que evita cuadrar contra un saldo que arrastra un mes perdido.
 */
export async function controlMensual(companyId: string, cuentaId: string, anio?: number) {
  const args: any[] = [companyId, cuentaId];
  let filtroAnio = '';
  if (anio) {
    args.push(anio);
    filtroAnio = ` AND e.anio = $${args.length}`;
  }

  const r = await query<any>(
    `SELECT e.anio, e.mes, e.saldo_inicial, e.saldo_final, e.cuadra,
            e.movimientos_total, e.total_retiros, e.total_depositos,
            e.con_advertencia, e.banco_detectado, e.id,
            (SELECT COUNT(*)::int FROM bancos_movimientos m
              WHERE m.estado_id = e.id AND m.inferido) AS inferidos
       FROM bancos_estados_cuenta e
      WHERE e.company_id = $1 AND e.cuenta_id = $2${filtroAnio}
      ORDER BY e.anio, e.mes`,
    args
  );

  const meses = r.rows.map((x: any) => ({
    ...x,
    saldo_inicial: x.saldo_inicial === null ? null : pesos(x.saldo_inicial),
    saldo_final: x.saldo_final === null ? null : pesos(x.saldo_final),
    total_retiros: pesos(x.total_retiros),
    total_depositos: pesos(x.total_depositos),
  }));

  /* Los saltos entre meses consecutivos: el final de uno debe ser el inicial
   * del siguiente. Si no lo es, falta un mes o una de las dos cargas está mal. */
  const saltos: string[] = [];
  for (let i = 1; i < meses.length; i++) {
    const ant = meses[i - 1];
    const act = meses[i];
    if (ant.saldo_final === null || act.saldo_inicial === null) continue;
    if (Math.abs(ant.saldo_final - act.saldo_inicial) > 0.02) {
      saltos.push(
        `El saldo final de ${String(ant.mes).padStart(2, '0')}/${ant.anio} ` +
        `(${ant.saldo_final.toFixed(2)}) no coincide con el inicial de ` +
        `${String(act.mes).padStart(2, '0')}/${act.anio} (${act.saldo_inicial.toFixed(2)}). ` +
        'Falta un mes de por medio, o una de las dos cargas está incompleta.'
      );
    }
  }

  const sinCuadrar = meses.filter((m: any) => !m.cuadra).length;

  return { meses, saltos, sinCuadrar };
}


/**
 * El estado de cuenta como CSV — el "archivo puente".
 *
 * Es lo que se lleva a la contabilidad, a Excel o al contador: las mismas
 * columnas del documento del banco, ya normalizadas y con el saldo arrastrado
 * al lado del declarado.
 *
 * Lleva la columna INFERIDO a propósito. Un movimiento que dedujo el sistema y
 * que el banco no reportó no puede llegar a un archivo contable sin decir que
 * lo es: quien lo reciba tiene que poder distinguirlos.
 *
 * Se separa con COMA y se abre con BOM: Excel en español lee el archivo como
 * UTF-8 sólo si lo trae, y sin él los acentos salen rotos en cada concepto.
 */
export async function csvDeEstado(companyId: string, estadoId: string): Promise<{ csv: string; nombre: string }> {
  const { estado, movimientos } = await detalleEstado(companyId, estadoId);

  const escapar = (v: any) => {
    const t = String(v ?? '');
    return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const dosDecimales = (v: any) =>
    v === null || v === undefined ? '' : Number(v).toFixed(2);
  /* DD/MM/AAAA, como el resto del sistema. */
  const fecha = (v: any) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v instanceof Date ? v.toISOString() : v));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  };

  const filas: string[] = [];
  filas.push([
    'Fecha', 'Concepto', 'Referencia', 'Deposito', 'Retiro',
    'Saldo', 'SaldoCalculado', 'Inferido', 'Advertencia',
  ].join(','));

  for (const m of movimientos) {
    filas.push([
      escapar(fecha(m.fecha)),
      escapar(m.concepto),
      escapar(m.referencia),
      dosDecimales(m.deposito),
      dosDecimales(m.retiro),
      dosDecimales(m.saldo),
      dosDecimales(m.saldo_calculado),
      m.inferido ? 'SI' : '',
      escapar(m.advertencia),
    ].join(','));
  }

  /* El resumen al pie: es lo que permite cuadrar el CSV sin volver al sistema. */
  filas.push('');
  filas.push(['SALDO INICIAL', '', '', '', '', dosDecimales(estado.saldo_inicial)].join(','));
  filas.push(['TOTALES', '', '',
    dosDecimales(estado.total_depositos), dosDecimales(estado.total_retiros)].join(','));
  filas.push(['SALDO FINAL', '', '', '', '', dosDecimales(estado.saldo_final)].join(','));
  filas.push(['CUADRA', estado.cuadra ? 'SI' : 'NO'].join(','));

  const nombre =
    `${String(estado.alias).replace(/[^\w-]+/g, '_')}-` +
    `${estado.anio}-${String(estado.mes).padStart(2, '0')}.csv`;

  return { csv: '\uFEFF' + filas.join('\r\n'), nombre };
}

/**
 * El estado de cuenta como Excel (.xlsx): la rejilla de movimientos con saldo
 * inicial, dep\u00F3sitos, retiros y saldo final. Es "el PDF convertido a Excel" que
 * pide la conciliaci\u00F3n, ya normalizado por el extractor.
 */
export async function excelDeEstado(companyId: string, estadoId: string): Promise<{ buffer: Buffer; nombre: string }> {
  const { estado, movimientos } = await detalleEstado(companyId, estadoId);

  const fechaMx = (v: any) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v instanceof Date ? v.toISOString() : v));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  };
  const num = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Estado de cuenta');
  ws.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Concepto', key: 'concepto', width: 48 },
    { header: 'Referencia', key: 'referencia', width: 16 },
    { header: 'Dep\u00F3sito', key: 'deposito', width: 15 },
    { header: 'Retiro', key: 'retiro', width: 15 },
    { header: 'Saldo', key: 'saldo', width: 15 },
  ];

  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = `${estado.banco_nombre || ''}  \u00B7  ${estado.alias || ''}  \u00B7  ${String(estado.mes).padStart(2, '0')}/${estado.anio}`;
  ws.getCell('A1').font = { bold: true, size: 12 };
  ws.addRow([]);

  const cab = ws.addRow(['Fecha', 'Concepto', 'Referencia', 'Dep\u00F3sito', 'Retiro', 'Saldo']);
  cab.font = { bold: true };
  cab.eachCell((c) => { c.border = { bottom: { style: 'thin' } }; });

  ws.addRow(['', 'SALDO INICIAL', '', null, null, num(estado.saldo_inicial)]).font = { italic: true };

  for (const m of movimientos) {
    ws.addRow([
      fechaMx(m.fecha), m.concepto || '', m.referencia || '',
      num(m.deposito), num(m.retiro), num(m.saldo ?? m.saldo_calculado),
    ]);
  }

  const tot = ws.addRow(['', 'TOTALES', '', num(estado.total_depositos), num(estado.total_retiros), null]);
  tot.font = { bold: true };
  const fin = ws.addRow(['', 'SALDO FINAL', '', null, null, num(estado.saldo_final)]);
  fin.font = { bold: true };
  ws.addRow(['', estado.cuadra ? 'Cuadra \u2713' : 'NO cuadra', '', '', '', '']);

  ['D', 'E', 'F'].forEach((col) => {
    ws.getColumn(col).numFmt = '#,##0.00';
    ws.getColumn(col).alignment = { horizontal: 'right' };
  });

  const buffer = await wb.xlsx.writeBuffer();
  const nombre =
    `estado-${String(estado.alias || 'cuenta').replace(/[^\w-]+/g, '_')}-` +
    `${estado.anio}-${String(estado.mes).padStart(2, '0')}.xlsx`;
  return { buffer: Buffer.from(buffer), nombre };
}
