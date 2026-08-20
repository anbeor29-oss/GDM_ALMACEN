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
}

function validarClabe(clabe?: string): string | null {
  const c = String(clabe || '').replace(/\D/g, '');
  if (!c) return null;
  if (c.length !== 18) {
    throw new ValidationError('La CLABE debe tener exactamente 18 dígitos');
  }
  return c;
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
  const moneda = String(d.moneda || 'MXN').toUpperCase().slice(0, 3);

  try {
    const r = await query<any>(
      `INSERT INTO bancos_cuentas
         (company_id, banco_clave, banco_nombre, alias, numero_cuenta, clabe,
          moneda, saldo_inicial, saldo_inicial_fecha, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10)
       RETURNING *`,
      [companyId, d.bancoClave || null, banco, alias,
       String(d.numeroCuenta || '').trim().slice(0, 30) || null, clabe, moneda,
       pesos(d.saldoInicial), d.saldoInicialFecha || null,
       String(d.notas || '').trim() || null]
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
): Promise<{ estado: any; extraccion: ResultadoExtraccion; reemplazo: boolean }> {
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

    return { estado: est.rows[0], extraccion, reemplazo };
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
