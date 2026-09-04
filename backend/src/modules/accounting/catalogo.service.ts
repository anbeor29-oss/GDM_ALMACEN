/**
 * Catálogo de cuentas — siembra, consulta y mantenimiento.
 *
 * ── LAS TRES CAPAS, Y POR QUÉ ESTÁN SEPARADAS ──
 *
 *   nif_normas              global, de referencia   — se siembra una vez
 *   sat_codigos_agrupadores global, de referencia   — se siembra una vez
 *   accounting_accounts     POR EMPRESA             — se siembra al activar
 *
 * Las dos primeras no llevan company_id porque no son de nadie: las NIF y el
 * Anexo 24 son los mismos para todos los contribuyentes del país. Copiarlas por
 * empresa significaría que actualizar el Anexo 24 el año que viene hay que
 * hacerlo N veces, y a la tercera empresa ya no coinciden entre sí.
 *
 * La tercera SÍ es por empresa, porque el catálogo de cuentas es de la empresa
 * —aunque hoy arranque con la numeración del SAT.
 */

import { query, transaction, transactionQuery } from '../../config/database';
import type { PoolClient } from 'pg';
import { NIF_NORMAS } from './nif-normas.data';
import { construirCatalogoSat, NIVEL2_PENDIENTE, type CodigoSat } from './catalogo-sat.data';
import logger from '../../middleware/logger';

/* ═══════════════════════════════════════════════════════════════════════════
   1. SIEMBRA DE REFERENCIAS (global, idempotente)
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ResultadoSiembra {
  nifSembradas: number;
  satSembrados: number;
  satNivel1: number;
  satNivel2: number;
  nivel2Pendiente: number;
  cuentasConNivel2Incompleto: number;
}

/**
 * Siembra las NIF y el código agrupador del SAT.
 *
 * Idempotente: se puede correr cuantas veces haga falta. Usa ON CONFLICT DO
 * UPDATE en el nombre para que una corrección del catálogo se propague, pero
 * nunca borra: un código que ya se usó en una cuenta no puede desaparecer bajo
 * los pies de esa cuenta.
 */
export async function sembrarReferencias(): Promise<ResultadoSiembra> {
  /* ── Las NIF primero: el catálogo del SAT las referencia ── */
  for (const n of NIF_NORMAS) {
    await query(
      `INSERT INTO nif_normas (clave, serie, titulo, ambito, resumen)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (clave) DO UPDATE
         SET titulo = EXCLUDED.titulo,
             ambito = EXCLUDED.ambito,
             resumen = EXCLUDED.resumen`,
      [n.clave, n.serie, n.titulo, n.ambito, n.resumen ?? null],
    );
  }

  /* ── El catálogo del SAT ──
   * En dos pasadas: primero los nivel 1, luego los nivel 2. La segunda pasada
   * referencia a la primera por FK, así que el orden no es negociable. */
  const catalogo = construirCatalogoSat();
  const nivel1 = catalogo.filter((c) => c.nivel === 1);
  const nivel2 = catalogo.filter((c) => c.nivel === 2);

  const insertar = async (c: CodigoSat) => {
    await query(
      `INSERT INTO sat_codigos_agrupadores
         (codigo, padre, nombre, nivel, tipo, naturaleza, nif_norma)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (codigo) DO UPDATE
         SET nombre     = EXCLUDED.nombre,
             tipo       = EXCLUDED.tipo,
             naturaleza = EXCLUDED.naturaleza,
             nif_norma  = EXCLUDED.nif_norma`,
      [c.codigo, c.padre ?? null, c.nombre, c.nivel, c.tipo, c.naturaleza, c.nif ?? null],
    );
  };

  for (const c of nivel1) await insertar(c);
  for (const c of nivel2) await insertar(c);

  const pendientes = NIVEL2_PENDIENTE.reduce((a, [, n]) => a + n, 0);

  logger.info(
    `Catálogo SAT sembrado: ${catalogo.length} códigos ` +
    `(${nivel1.length} mayores, ${nivel2.length} subcuentas). ` +
    `Faltan ~${pendientes} subcuentas de ${NIVEL2_PENDIENTE.length} cuentas ` +
    `que el resumen del Anexo 24 no detalla — hace falta el archivo oficial.`,
  );

  return {
    nifSembradas: NIF_NORMAS.length,
    satSembrados: catalogo.length,
    satNivel1: nivel1.length,
    satNivel2: nivel2.length,
    nivel2Pendiente: pendientes,
    cuentasConNivel2Incompleto: NIVEL2_PENDIENTE.length,
  };
}

/** Lo que falta del Anexo 24, para poder pedirlo en vez de inventarlo. */
export function faltantesDelAnexo24() {
  return NIVEL2_PENDIENTE.map(([codigo, cuantas, nombre]) => ({
    codigo, nombre, subcuentasFaltantes: cuantas,
  }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. ACTIVAR CONTABILIDAD EN UNA EMPRESA
   ═══════════════════════════════════════════════════════════════════════════ */

export interface OpcionesActivacion {
  anio: number;
  mesInicioEjercicio?: number;
  metodoValuacionInv?: 'PROMEDIO' | 'CAPAS' | 'ULTIMO' | 'ESTANDAR';
  /** Sembrar el catálogo con la numeración del SAT. */
  sembrarCatalogo?: boolean;
  /** Hasta qué nivel del SAT se copia como cuenta propia. */
  hastaNivel?: 1 | 2;
}

/**
 * Deja la empresa lista para contabilizar: configuración, ejercicio, doce
 * periodos y —si se pide— el catálogo semilla.
 *
 * Todo dentro de una transacción. Una empresa con ejercicio pero sin periodos,
 * o con catálogo a medias, es peor que una sin contabilidad: parece que ya
 * quedó.
 */
export async function activarContabilidad(
  companyId: string,
  opciones: OpcionesActivacion,
) {
  const {
    anio,
    mesInicioEjercicio = 1,
    metodoValuacionInv = 'PROMEDIO',
    sembrarCatalogo = true,
    hastaNivel = 2,
  } = opciones;

  return transaction(async (client: PoolClient) => {
    /* ── Configuración ── */
    await transactionQuery(
      client,
      `INSERT INTO company_accounting_settings
         (company_id, contabilidad_activa, mes_inicio_ejercicio, metodo_valuacion_inv)
       VALUES ($1, TRUE, $2, $3)
       ON CONFLICT (company_id) DO UPDATE
         SET contabilidad_activa   = TRUE,
             mes_inicio_ejercicio  = EXCLUDED.mes_inicio_ejercicio,
             metodo_valuacion_inv  = EXCLUDED.metodo_valuacion_inv,
             updated_at            = NOW()`,
      [companyId, mesInicioEjercicio, metodoValuacionInv],
    );

    /* ── Ejercicio ──
     * Doce meses desde el inicio, menos un día. Se suman SIEMPRE 12 meses:
     * un ejercicio que arranca en enero también dura un año, y condicionar la
     * suma al mes de arranque dejaba el fin ANTES del inicio. */
    const inicio = new Date(Date.UTC(anio, mesInicioEjercicio - 1, 1));
    const fin = new Date(Date.UTC(anio, mesInicioEjercicio - 1 + 12, 1));
    fin.setUTCDate(fin.getUTCDate() - 1);

    const fy = await transactionQuery<any>(
      client,
      `INSERT INTO accounting_fiscal_years (company_id, anio, fecha_inicio, fecha_fin)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (company_id, anio) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [companyId, anio, inicio.toISOString().slice(0, 10), fin.toISOString().slice(0, 10)],
    );
    const fiscalYearId = fy.rows[0].id;

    /* ── Los doce periodos ──
     * Se crean los doce de golpe, no conforme se necesiten. Un periodo que
     * "aparece" al capturar la primera póliza del mes es un periodo que nadie
     * cerró: el hueco no se ve hasta la anual. */
    let periodos = 0;
    for (let i = 0; i < 12; i++) {
      const m = new Date(Date.UTC(anio, mesInicioEjercicio - 1 + i, 1));
      const finMes = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0));
      const r = await transactionQuery<any>(
        client,
        `INSERT INTO accounting_periods
           (company_id, fiscal_year_id, anio, mes, fecha_inicio, fecha_fin)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (company_id, anio, mes) DO NOTHING
         RETURNING id`,
        [companyId, fiscalYearId, m.getUTCFullYear(), m.getUTCMonth() + 1,
         m.toISOString().slice(0, 10), finMes.toISOString().slice(0, 10)],
      );
      if (r.rows.length) periodos++;
    }

    /* ── El catálogo semilla ── */
    let cuentas = 0;
    if (sembrarCatalogo) {
      cuentas = await sembrarCatalogoEmpresa(client, companyId, hastaNivel);
    }

    return { fiscalYearId, anio, periodos, cuentas };
  });
}

/**
 * Copia el catálogo del SAT como catálogo propio de la empresa.
 *
 * ── LO QUE NO SE HACE AQUÍ, A PROPÓSITO ──
 * 'codigo' y 'codigo_agrupador' quedan con el MISMO valor, y aun así son dos
 * columnas. Es la decisión que permite el empate posterior con catálogos ya
 * formados: el día que llegue uno ajeno con "1102-001 Bancrea", se registra
 * como equivalencia y el catálogo propio puede re-numerarse sin tocar el
 * agrupador.
 *
 * Colapsarlas ahora porque coinciden cerraría esa puerta para siempre.
 */
async function sembrarCatalogoEmpresa(
  client: PoolClient,
  companyId: string,
  hastaNivel: 1 | 2,
): Promise<number> {
  const sat = await transactionQuery<any>(
    client,
    `SELECT codigo, padre, nombre, nivel, tipo, naturaleza, nif_norma
       FROM sat_codigos_agrupadores
      WHERE nivel <= $1
      ORDER BY nivel, codigo`,
    [hastaNivel],
  );

  if (!sat.rows.length) {
    throw new Error(
      'El catálogo del SAT no está sembrado. Corre primero la siembra de ' +
      'referencias (npm run contabilidad:sembrar).',
    );
  }

  const idPorCodigo = new Map<string, string>();
  let n = 0;

  for (const c of sat.rows) {
    const parentId = c.padre ? idPorCodigo.get(c.padre) ?? null : null;

    /* Las cuentas que exigen tercero: sin party_id, '105 Clientes' es un saldo
     * que no se puede cobrar —se sabe cuánto, no a quién. */
    const requiereTercero = ['105', '106', '107', '120', '186',
                             '201', '205', '206', '251'].includes(c.codigo.split('.')[0]);

    const r = await transactionQuery<any>(
      client,
      `INSERT INTO accounting_accounts
         (company_id, parent_id, codigo, nombre, codigo_agrupador,
          tipo, naturaleza, es_complementaria, nif_norma, nivel,
          permite_movimientos, requiere_tercero)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (company_id, codigo) DO NOTHING
       RETURNING id`,
      [
        companyId, parentId, c.codigo, c.nombre, c.codigo,
        c.tipo, c.naturaleza,
        /* Complementaria = naturaleza CONTRARIA a la que su tipo implica,
         * porque corrige el rubro en vez de sumarle.
         *
         * La regla no es "activo con saldo acreedor": eso deja fuera a '402
         * Devoluciones sobre ventas' (ingreso con saldo deudor) y a '503
         * Devoluciones sobre compras' (costo con saldo acreedor), que restan
         * exactamente igual que una depreciación acumulada. */
        (['ACTIVO', 'COSTO', 'GASTO', 'RIF'].includes(c.tipo) && c.naturaleza === 'ACREEDORA')
        || (['PASIVO', 'CAPITAL', 'INGRESO'].includes(c.tipo) && c.naturaleza === 'DEUDORA'),
        c.nif_norma, c.nivel,
        /* Nivel 1 sólo recibe movimientos si no vamos a crearle hijos. */
        !(hastaNivel === 2 && c.nivel === 1),
        requiereTercero,
      ],
    );

    if (r.rows.length) {
      idPorCodigo.set(c.codigo, r.rows[0].id);
      n++;
    } else {
      const ya = await transactionQuery<any>(
        client,
        `SELECT id FROM accounting_accounts WHERE company_id=$1 AND codigo=$2`,
        [companyId, c.codigo],
      );
      if (ya.rows.length) idPorCodigo.set(c.codigo, ya.rows[0].id);
    }
  }

  return n;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. CONSULTA
   ═══════════════════════════════════════════════════════════════════════════ */

export interface FiltroCuentas {
  busqueda?: string;
  tipo?: string;
  soloMovimientos?: boolean;
  soloActivas?: boolean;
  nivel?: number;
}

export async function listarCuentas(companyId: string, f: FiltroCuentas = {}) {
  const cond: string[] = ['c.company_id = $1'];
  const par: any[] = [companyId];

  if (f.soloActivas !== false) cond.push('c.activa');
  if (f.soloMovimientos) cond.push('c.permite_movimientos');
  if (f.tipo) { par.push(f.tipo); cond.push(`c.tipo = $${par.length}`); }
  if (f.nivel) { par.push(f.nivel); cond.push(`c.nivel = $${par.length}`); }

  if (f.busqueda?.trim()) {
    /* translate() y no unaccent(): unaccent es una extensión que puede no estar
     * instalada, y su fallo dentro de una transacción la aborta entera. */
    par.push(`%${f.busqueda.trim().toLowerCase()}%`);
    cond.push(
      `(LOWER(c.codigo) LIKE $${par.length}
        OR LOWER(translate(c.nombre,'áéíóúÁÉÍÓÚñÑ','aeiouAEIOUnN')) LIKE
           translate($${par.length},'áéíóúÁÉÍÓÚñÑ','aeiouAEIOUnN'))`,
    );
  }

  const r = await query<any>(
    `SELECT c.*, n.titulo AS nif_titulo, s.nombre AS agrupador_nombre,
            (SELECT COUNT(*) FROM accounting_accounts h WHERE h.parent_id = c.id) AS hijos
       FROM accounting_accounts c
       LEFT JOIN nif_normas n ON n.clave = c.nif_norma
       LEFT JOIN sat_codigos_agrupadores s ON s.codigo = c.codigo_agrupador
      WHERE ${cond.join(' AND ')}
      ORDER BY c.codigo`,
    par,
  );
  return r.rows;
}

/** El catálogo como árbol, para pintarlo. */
export async function arbolDeCuentas(companyId: string) {
  const planas = await listarCuentas(companyId, { soloActivas: false });
  const porId = new Map<string, any>();
  for (const c of planas) porId.set(c.id, { ...c, hijosLista: [] });

  const raiz: any[] = [];
  for (const c of porId.values()) {
    if (c.parent_id && porId.has(c.parent_id)) porId.get(c.parent_id).hijosLista.push(c);
    else raiz.push(c);
  }
  return raiz;
}

export async function obtenerCuenta(companyId: string, id: string) {
  const r = await query<any>(
    `SELECT c.*, n.titulo AS nif_titulo, n.resumen AS nif_resumen
       FROM accounting_accounts c
       LEFT JOIN nif_normas n ON n.clave = c.nif_norma
      WHERE c.company_id = $1 AND c.id = $2`,
    [companyId, id],
  );
  return r.rows[0] ?? null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. ALTA Y EDICIÓN
   ═══════════════════════════════════════════════════════════════════════════ */

export interface DatosCuenta {
  codigo: string;
  nombre: string;
  parentId?: string | null;
  codigoAgrupador?: string | null;
  tipo?: string;
  naturaleza?: string;
  esComplementaria?: boolean;
  nifNorma?: string | null;
  requiereTercero?: boolean;
  requiereProducto?: boolean;
  requiereAlmacen?: boolean;
  requiereCentro?: boolean;
  moneda?: string;
  notas?: string;
}

const TIPOS = ['ACTIVO', 'PASIVO', 'CAPITAL', 'INGRESO', 'COSTO', 'GASTO', 'RIF', 'ORDEN'];

export async function crearCuenta(companyId: string, d: DatosCuenta) {
  const codigo = d.codigo?.trim();
  if (!codigo) throw new Error('El código de la cuenta es obligatorio.');
  if (!d.nombre?.trim()) throw new Error('El nombre de la cuenta es obligatorio.');

  /* ── El padre manda tipo y naturaleza ──
   * Una subcuenta de '102 Bancos' clasificada como PASIVO descuadra el balance
   * sin que ninguna póliza esté mal. Se hereda en vez de preguntarse. */
  let padre: any = null;
  if (d.parentId) {
    const r = await query<any>(
      `SELECT * FROM accounting_accounts WHERE company_id=$1 AND id=$2`,
      [companyId, d.parentId],
    );
    padre = r.rows[0];
    if (!padre) throw new Error('La cuenta padre no existe en esta empresa.');

    if (!codigo.startsWith(padre.codigo)) {
      throw new Error(
        `El código "${codigo}" no cuelga de "${padre.codigo}". Una subcuenta ` +
        `tiene que empezar con el código de su cuenta padre, o el catálogo ` +
        `deja de poder consolidarse por prefijo.`,
      );
    }
  }

  const tipo = padre?.tipo ?? d.tipo;
  const naturaleza = padre?.naturaleza ?? d.naturaleza;

  if (!tipo || !TIPOS.includes(tipo)) {
    throw new Error(`Tipo de cuenta inválido. Debe ser uno de: ${TIPOS.join(', ')}.`);
  }
  if (!naturaleza || !['DEUDORA', 'ACREEDORA'].includes(naturaleza)) {
    throw new Error('La naturaleza debe ser DEUDORA o ACREEDORA.');
  }

  /* ── El agrupador tiene que existir ──
   * Un agrupador tecleado a mano que no está en el Anexo 24 pasa inadvertido
   * hasta el día del envío al buzón, que es cuando ya no hay tiempo. */
  if (d.codigoAgrupador) {
    const s = await query<any>(
      `SELECT codigo FROM sat_codigos_agrupadores WHERE codigo=$1`,
      [d.codigoAgrupador],
    );
    if (!s.rows.length) {
      throw new Error(
        `El código agrupador "${d.codigoAgrupador}" no existe en el Anexo 24 ` +
        `sembrado. Revísalo, o pide que se complete el catálogo oficial.`,
      );
    }
  }

  const dup = await query<any>(
    `SELECT id FROM accounting_accounts WHERE company_id=$1 AND codigo=$2`,
    [companyId, codigo],
  );
  if (dup.rows.length) throw new Error(`Ya existe la cuenta "${codigo}" en esta empresa.`);

  const nivel = padre ? padre.nivel + 1 : 1;

  const r = await query<any>(
    `INSERT INTO accounting_accounts
       (company_id, parent_id, codigo, nombre, codigo_agrupador, tipo, naturaleza,
        es_complementaria, nif_norma, nivel, requiere_tercero, requiere_producto,
        requiere_almacen, requiere_centro, moneda, notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      companyId, d.parentId ?? null, codigo, d.nombre.trim(),
      d.codigoAgrupador ?? null, tipo, naturaleza,
      d.esComplementaria ?? padre?.es_complementaria ?? false,
      d.nifNorma ?? padre?.nif_norma ?? null, nivel,
      d.requiereTercero ?? false, d.requiereProducto ?? false,
      d.requiereAlmacen ?? false, d.requiereCentro ?? false,
      d.moneda ?? 'MXN', d.notas ?? null,
    ],
  );
  return r.rows[0];
}

export async function actualizarCuenta(companyId: string, id: string, d: Partial<DatosCuenta>) {
  const actual = await obtenerCuenta(companyId, id);
  if (!actual) throw new Error('La cuenta no existe.');

  const campos: string[] = [];
  const par: any[] = [];
  const set = (col: string, val: any) => { par.push(val); campos.push(`${col} = $${par.length}`); };

  if (d.nombre !== undefined) set('nombre', d.nombre.trim());
  if (d.moneda !== undefined) set('moneda', (d.moneda || 'MXN').toString().trim().slice(0, 3).toUpperCase() || 'MXN');
  if (d.codigoAgrupador !== undefined) {
    if (d.codigoAgrupador) {
      const s = await query<any>(`SELECT codigo FROM sat_codigos_agrupadores WHERE codigo=$1`,
        [d.codigoAgrupador]);
      if (!s.rows.length) {
        throw new Error(`El código agrupador "${d.codigoAgrupador}" no existe en el Anexo 24.`);
      }
    }
    set('codigo_agrupador', d.codigoAgrupador);
  }
  if (d.nifNorma !== undefined) set('nif_norma', d.nifNorma);
  if (d.requiereTercero !== undefined) set('requiere_tercero', d.requiereTercero);
  if (d.requiereProducto !== undefined) set('requiere_producto', d.requiereProducto);
  if (d.requiereAlmacen !== undefined) set('requiere_almacen', d.requiereAlmacen);
  if (d.requiereCentro !== undefined) set('requiere_centro', d.requiereCentro);
  if (d.notas !== undefined) set('notas', d.notas);

  if (!campos.length) return actual;

  par.push(companyId, id);
  const r = await query<any>(
    `UPDATE accounting_accounts SET ${campos.join(', ')}, updated_at = NOW()
      WHERE company_id = $${par.length - 1} AND id = $${par.length}
      RETURNING *`,
    par,
  );
  return r.rows[0];
}

/** Los códigos agrupadores del Anexo 24 (referencia), para el desplegable. */
export async function listarAgrupadoresSat(): Promise<Array<{ codigo: string; nombre: string; nivel: number; tipo: string; naturaleza: string }>> {
  const r = await query<any>(
    `SELECT codigo, nombre, nivel, tipo, naturaleza FROM sat_codigos_agrupadores ORDER BY codigo`);
  return r.rows;
}

/**
 * Desactivar, nunca borrar.
 *
 * Una cuenta que tuvo movimientos no puede desaparecer: la póliza que la usó
 * quedaría apuntando al vacío y la balanza del año pasado dejaría de armarse.
 * Es el mismo principio del Kardex y de las pólizas.
 */
export async function desactivarCuenta(companyId: string, id: string) {
  const hijos = await query<any>(
    `SELECT COUNT(*)::int AS n FROM accounting_accounts WHERE parent_id = $1 AND activa`,
    [id],
  );
  if (hijos.rows[0].n > 0) {
    throw new Error(
      `No se puede desactivar: tiene ${hijos.rows[0].n} subcuenta(s) activa(s). ` +
      `Desactiva primero las subcuentas.`,
    );
  }
  const r = await query<any>(
    `UPDATE accounting_accounts SET activa = FALSE, updated_at = NOW()
      WHERE company_id = $1 AND id = $2 RETURNING *`,
    [companyId, id],
  );
  return r.rows[0];
}

/**
 * Borrado REAL — para limpiar el catálogo recién importado, que "trae errores".
 *
 * A diferencia de desactivar, la cuenta desaparece. Sólo cuando es SEGURO: sin
 * subcuentas y sin movimientos en pólizas. Si tiene pólizas se rechaza y se manda
 * a «Cambio de cuenta» para reasignar primero — nunca se borra historia. Los
 * saldos por periodo son derivados (se recalculan de las pólizas), así que esos
 * sí se quitan; las equivalencias caen solas (ON DELETE CASCADE).
 */
export async function eliminarCuenta(companyId: string, id: string) {
  const cta = await obtenerCuenta(companyId, id);
  if (!cta) throw new Error('La cuenta no existe.');

  const hijos = await query<any>(
    `SELECT COUNT(*)::int AS n FROM accounting_accounts WHERE parent_id = $1`, [id]);
  if (hijos.rows[0].n > 0) {
    throw new Error(
      `No se puede borrar «${cta.codigo}»: tiene ${hijos.rows[0].n} subcuenta(s). ` +
      `Bórralas primero — así no se borra un grupo entero por error.`);
  }

  const movs = await query<any>(
    `SELECT COUNT(*)::int AS n FROM journal_lines WHERE account_id = $1`, [id]);
  if (movs.rows[0].n > 0) {
    throw new Error(
      `No se puede borrar «${cta.codigo}»: tiene ${movs.rows[0].n} movimiento(s) en pólizas. ` +
      `Usa «Cambio de cuenta» para reasignarlos y luego bórrala.`);
  }

  await query('DELETE FROM accounting_period_balances WHERE account_id = $1', [id]);
  await query('DELETE FROM accounting_accounts WHERE company_id = $1 AND id = $2', [companyId, id]);
  return { id, codigo: cta.codigo, nombre: cta.nombre };
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. EQUIVALENCIAS CON OTROS CATÁLOGOS
   ═══════════════════════════════════════════════════════════════════════════ */

export async function listarCatalogosExternos(companyId: string) {
  const r = await query<any>(
    `SELECT catalogo, COUNT(*)::int AS cuentas
       FROM accounting_account_equivalences
      WHERE company_id = $1
      GROUP BY catalogo ORDER BY catalogo`,
    [companyId],
  );
  return r.rows;
}

export async function fijarEquivalencia(
  companyId: string,
  accountId: string,
  catalogo: string,
  codigoExterno: string,
  descripcion?: string,
) {
  if (!catalogo?.trim()) throw new Error('Falta el nombre del catálogo externo.');
  if (!codigoExterno?.trim()) throw new Error('Falta el código externo.');

  const cta = await obtenerCuenta(companyId, accountId);
  if (!cta) throw new Error('La cuenta no existe en esta empresa.');

  const r = await query<any>(
    `INSERT INTO accounting_account_equivalences
       (company_id, account_id, catalogo, codigo_externo, descripcion_externa)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (account_id, catalogo) DO UPDATE
       SET codigo_externo = EXCLUDED.codigo_externo,
           descripcion_externa = EXCLUDED.descripcion_externa
     RETURNING *`,
    [companyId, accountId, catalogo.trim().toUpperCase(), codigoExterno.trim(),
     descripcion ?? null],
  );
  return r.rows[0];
}

export async function equivalenciasDeCuenta(companyId: string, accountId: string) {
  const r = await query<any>(
    `SELECT * FROM accounting_account_equivalences
      WHERE company_id = $1 AND account_id = $2 ORDER BY catalogo`,
    [companyId, accountId],
  );
  return r.rows;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. REVISIÓN DEL CATÁLOGO
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Lo que está mal ANTES de que importe.
 *
 * Un catálogo se revisa el día que se arma, no el día del envío al buzón ni el
 * día del cierre anual. Para entonces ya tiene movimientos encima y arreglarlo
 * cuesta diez veces más.
 */
export async function revisarCatalogo(companyId: string) {
  const avisos: Array<{ nivel: 'ERROR' | 'AVISO'; mensaje: string; cuentas?: string[] }> = [];

  const sinAgrupador = await query<any>(
    `SELECT codigo, nombre FROM accounting_accounts
      WHERE company_id=$1 AND activa AND permite_movimientos AND codigo_agrupador IS NULL
      ORDER BY codigo LIMIT 50`,
    [companyId],
  );
  if (sinAgrupador.rows.length) {
    avisos.push({
      nivel: 'AVISO',
      mensaje:
        `${sinAgrupador.rows.length} cuenta(s) de movimiento sin código agrupador. ` +
        `Hoy no estorba —la contabilidad es interna—, pero el día que se envíe ` +
        `el Anexo 24 hay que mapearlas con movimientos encima.`,
      cuentas: sinAgrupador.rows.map((c: any) => `${c.codigo} ${c.nombre}`),
    });
  }

  /* ── Sin clasificar NO es lo mismo que sin NIF ──
   *
   * El aviso viejo contaba como pendiente toda cuenta sin norma, y metía en el
   * mismo saco al IVA acreditable —al que NO le corresponde ninguna NIF de
   * valuación— con las que de verdad faltan por clasificar. Cincuenta cuentas
   * en una lista que no se puede vaciar entrenan a ignorar el aviso.
   *
   * Ahora sólo se reportan las que quedaron en DEPENDE: las genéricas, cuyo
   * tratamiento no se puede saber sin ver qué hay dentro. Ésas sí las tiene
   * que resolver la empresa, y son pocas. */
  const porClasificar = await query<any>(
    `SELECT codigo, nombre FROM accounting_accounts
      WHERE company_id=$1 AND activa AND permite_movimientos
        AND nif_aplica = 'DEPENDE'
      ORDER BY codigo LIMIT 50`,
    [companyId],
  );
  if (porClasificar.rows.length) {
    avisos.push({
      nivel: 'AVISO',
      mensaje:
        `${porClasificar.rows.length} cuenta(s) cuyo tratamiento NIF depende de qué ` +
        `se registre en ellas ("otros activos", "otros pasivos"). Clasifícalas para ` +
        `que el motor NIF pueda opinar; las demás ya están resueltas.`,
      cuentas: porClasificar.rows.map((c: any) => `${c.codigo} ${c.nombre}`),
    });
  }

  /* Una cuenta que dice ESPECIFICA sin norma es una incoherencia real. */
  const incoherentes = await query<any>(
    `SELECT codigo, nombre FROM accounting_accounts
      WHERE company_id=$1 AND activa AND nif_aplica='ESPECIFICA' AND nif_norma IS NULL
      ORDER BY codigo LIMIT 20`,
    [companyId],
  );
  if (incoherentes.rows.length) {
    avisos.push({
      nivel: 'ERROR',
      mensaje:
        `${incoherentes.rows.length} cuenta(s) marcadas como "con NIF específica" ` +
        `pero sin norma asignada.`,
      cuentas: incoherentes.rows.map((c: any) => `${c.codigo} ${c.nombre}`),
    });
  }

  /* Padre que además recibe movimientos: el trigger lo impide al insertar
   * hijos, pero un catálogo importado de fuera puede llegar así. */
  const padresConMov = await query<any>(
    `SELECT c.codigo, c.nombre FROM accounting_accounts c
      WHERE c.company_id=$1 AND c.permite_movimientos
        AND EXISTS (SELECT 1 FROM accounting_accounts h WHERE h.parent_id = c.id)
      ORDER BY c.codigo`,
    [companyId],
  );
  if (padresConMov.rows.length) {
    avisos.push({
      nivel: 'ERROR',
      mensaje:
        `${padresConMov.rows.length} cuenta(s) tienen subcuentas y además admiten ` +
        `movimientos. Su saldo no sería ni el propio ni el consolidado, y no habría ` +
        `forma de saber cuál se está leyendo.`,
      cuentas: padresConMov.rows.map((c: any) => `${c.codigo} ${c.nombre}`),
    });
  }

  const naturalezaRara = await query<any>(
    `SELECT codigo, nombre, tipo, naturaleza FROM accounting_accounts
      WHERE company_id=$1 AND activa AND NOT es_complementaria
        AND ((tipo IN ('ACTIVO','COSTO','GASTO','RIF') AND naturaleza='ACREEDORA')
          OR (tipo IN ('PASIVO','CAPITAL','INGRESO') AND naturaleza='DEUDORA'))
      ORDER BY codigo`,
    [companyId],
  );
  if (naturalezaRara.rows.length) {
    avisos.push({
      nivel: 'AVISO',
      mensaje:
        `${naturalezaRara.rows.length} cuenta(s) con naturaleza contraria a su tipo ` +
        `sin estar marcadas como complementarias. Si de verdad restan de su rubro ` +
        `(depreciación acumulada, estimaciones), márcalas; si no, la naturaleza está mal.`,
      cuentas: naturalezaRara.rows.map((c: any) => `${c.codigo} ${c.nombre} (${c.tipo}/${c.naturaleza})`),
    });
  }

  const total = await query<any>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE permite_movimientos)::int AS movimiento
       FROM accounting_accounts WHERE company_id=$1 AND activa`,
    [companyId],
  );

  return {
    ...total.rows[0],
    avisos,
    errores: avisos.filter((a) => a.nivel === 'ERROR').length,
  };
}

export default {
  sembrarReferencias, faltantesDelAnexo24, activarContabilidad,
  listarCuentas, arbolDeCuentas, obtenerCuenta,
  crearCuenta, actualizarCuenta, desactivarCuenta, eliminarCuenta,
  listarCatalogosExternos, fijarEquivalencia, equivalenciasDeCuenta,
  revisarCatalogo,
};
