/**
 * Motor NIF — ejecuta las reglas contra saldos reales.
 *
 * ── QUÉ HACE, EN CONCRETO ──
 * Toma un juego de saldos ya ubicados en el catálogo del SAT y le hace a cada
 * regla su pregunta. Devuelve hallazgos con las cifras que los sostienen, no
 * opiniones: cada uno se puede rehacer con una calculadora.
 *
 * ── POR QUÉ NO ESPERA A LAS PÓLIZAS ──
 * Podría diseñarse para correr sobre el mayor cuando exista. Pero la balanza
 * del sistema anterior YA está, y es exactamente el juego de saldos sobre el
 * que un contador haría estas preguntas. Un motor que sólo funciona con datos
 * que todavía no existen no se puede probar — y uno que no se prueba, no
 * sirve el día que sí hay datos.
 */

import { query, transaction, transactionQuery } from '../../config/database';
import type { PoolClient } from 'pg';
import {
  REGLAS_NIF, type ContextoNif, type SaldoAgrupado, type ReglaNif,
} from './nif-reglas.data';
import type { FilaBalanza } from './balanza-lector.service';
import { marcarHojas } from './balanza-lector.service';
import type { PropuestaCuenta } from './mapeador-sat.service';
import logger from '../../middleware/logger';

/* ═══════════════════════════════════════════════════════════════════════════
   1. LAS REGLAS EN LA BASE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Registra las reglas y sus versiones.
 *
 * Nunca actualiza una versión existente: si una regla cambia de fondo, sube de
 * versión. Sobrescribir la v1 dejaría hallazgos viejos apuntando a un texto
 * que ya no es el que los produjo.
 */
export async function sincronizarReglas(): Promise<{ nuevas: number; total: number }> {
  let nuevas = 0;
  for (const r of REGLAS_NIF) {
    const res = await query(
      `INSERT INTO nif_reglas
         (clave, version, norma, ambito, titulo, que_exige, consecuencia,
          fundamento, severidad)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (clave, version) DO NOTHING
       RETURNING clave`,
      [r.clave, r.version, r.norma, r.ambito, r.titulo, r.queExige,
       r.consecuencia, r.fundamento ?? null, r.severidad],
    );
    if (res.rows.length) nuevas++;
  }
  logger.info(`[nif] ${REGLAS_NIF.length} reglas sincronizadas (${nuevas} nuevas)`);
  return { nuevas, total: REGLAS_NIF.length };
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. LA CLASIFICACIÓN DE TRES ESTADOS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Cuentas a las que NO les corresponde una NIF de valuación.
 *
 * No es pereza de clasificación: es la respuesta correcta.
 *
 * · IVA, IEPS y retenciones (118, 119, 207-209, 213, 216, 217) son impuestos
 *   que se cobran y se enteran por cuenta del fisco. No son instrumentos
 *   financieros —esos nacen de un contrato, y el impuesto nace de la ley— ni
 *   impuestos a la utilidad, que es lo único que cubre la D-4.
 *
 * · Estímulos fiscales (111, 112) y facilidades administrativas (606) son
 *   figuras fiscales sin norma contable propia en las NIF mexicanas.
 *
 * · 612 Gastos no deducibles para CUFIN es puramente fiscal.
 *
 * · Las cuentas de orden (800) son memoranda fiscal: no entran a ningún
 *   estado financiero, así que ninguna norma de valuación las alcanza.
 *
 * Marcar el IVA acreditable como C-3 "para que no salga en la lista" sería
 * peor que dejarlo vacío: el motor le empezaría a exigir estimación de pérdida
 * crediticia esperada a un saldo que se compensa contra el propio impuesto.
 */
const SIN_NIF_APLICABLE = [
  '111', '112', '118', '119', '207', '208', '209', '213', '216', '217',
  '606', '612',
];

/**
 * Cuentas que no se pueden clasificar sin ver qué hay dentro.
 *
 * '121 Otros activos a corto plazo' puede ser un depósito, un anticipo o una
 * cuenta por cobrar. Quien lo sabe es la empresa. Elegir una norma por ella
 * es adivinar sobre su contabilidad.
 */
const DEPENDE_DEL_CONTENIDO = [
  '121', '190', '218', '256', '258', '260', '403', '704',
];

/* ── Lo que NO va en esa lista, y por que ──
 * '160 Otros activos fijos' y '169 Otra maquinaria y equipo' se llaman "otros"
 * pero no son ambiguos: son propiedades, planta y equipo, y les toca la C-6.
 * '182 Otros activos diferidos' es intangible, y le toca la C-8.
 *
 * Estuvieron aqui y fue un error con consecuencia: la clasificacion pone en
 * NULL la norma de todo lo que cae en DEPENDE, asi que les BORRABA una
 * clasificacion que ya era correcta. La palabra "otros" en el nombre no vuelve
 * ambigua a una cuenta cuyo rubro es inequivoco. */

export interface ResultadoClasificacion {
  especifica: number;
  noAplica: number;
  depende: number;
}

/** Aplica los tres estados al catálogo del SAT (global, de referencia). */
export async function clasificarCatalogoSat(): Promise<ResultadoClasificacion> {
  /* Todo lo que ya trae norma queda como ESPECIFICA. */
  await query(
    `UPDATE sat_codigos_agrupadores SET nif_aplica='ESPECIFICA' WHERE nif_norma IS NOT NULL`);

  /* Los impuestos indirectos y las figuras fiscales: no les toca ninguna. */
  const patronNoAplica = SIN_NIF_APLICABLE.map((c) => `${c}%`);
  await query(
    `UPDATE sat_codigos_agrupadores SET nif_aplica='NO_APLICA', nif_norma=NULL
      WHERE nif_norma IS NULL AND (codigo LIKE ANY($1) OR tipo='ORDEN')`,
    [patronNoAplica]);

  /* Los gastos ordinarios sin norma propia: se reconocen por devengación y se
   * presentan en el estado de resultado integral, pero ninguna NIF los valúa. */
  await query(
    `UPDATE sat_codigos_agrupadores SET nif_aplica='NO_APLICA'
      WHERE nif_norma IS NULL AND tipo='GASTO'
        AND codigo NOT LIKE ANY($1)`,
    [DEPENDE_DEL_CONTENIDO.map((c) => `${c}%`)]);

  const patronDepende = DEPENDE_DEL_CONTENIDO.map((c) => `${c}%`);
  await query(
    `UPDATE sat_codigos_agrupadores SET nif_aplica='DEPENDE', nif_norma=NULL
      WHERE codigo LIKE ANY($1)`,
    [patronDepende]);

  /* ── Red de seguridad ──
   * Si una cuenta llego aqui con norma asignada y salio sin ella, algo la
   * degrado. Se deja constancia en vez de que pase inadvertido: una cuenta
   * que pierde su clasificacion deja de recibir las reglas que le tocaban, y
   * eso no se nota nunca. */
  const degradadas = await query<any>(
    `SELECT codigo, nombre FROM sat_codigos_agrupadores
      WHERE nif_aplica <> 'ESPECIFICA' AND nif_norma IS NOT NULL`);
  if (degradadas.rows.length) {
    logger.warn(
      `[nif] ${degradadas.rows.length} codigo(s) conservan norma sin estar marcados ` +
      `como ESPECIFICA: ${degradadas.rows.map((x: any) => x.codigo).join(', ')}`);
  }

  const r = await query<any>(
    `SELECT nif_aplica, COUNT(*)::int n FROM sat_codigos_agrupadores GROUP BY nif_aplica`);
  const por = Object.fromEntries(r.rows.map((x: any) => [x.nif_aplica, x.n]));
  logger.info(`[nif] catálogo clasificado: ${JSON.stringify(por)}`);
  return {
    especifica: por.ESPECIFICA ?? 0,
    noAplica: por.NO_APLICA ?? 0,
    depende: por.DEPENDE ?? 0,
  };
}

/** Propaga la clasificación del SAT a las cuentas de una empresa. */
export async function clasificarCuentasEmpresa(companyId: string): Promise<ResultadoClasificacion> {
  await query(
    `UPDATE accounting_accounts c
        SET nif_aplica = s.nif_aplica,
            nif_norma  = COALESCE(c.nif_norma, s.nif_norma),
            updated_at = NOW()
       FROM sat_codigos_agrupadores s
      WHERE c.company_id = $1 AND c.codigo_agrupador = s.codigo`,
    [companyId]);

  /* Una cuenta propia sin agrupador no se puede clasificar desde el SAT. */
  await query(
    `UPDATE accounting_accounts SET nif_aplica='DEPENDE'
      WHERE company_id=$1 AND codigo_agrupador IS NULL AND nif_norma IS NULL`,
    [companyId]);

  const r = await query<any>(
    `SELECT nif_aplica, COUNT(*)::int n FROM accounting_accounts
      WHERE company_id=$1 AND activa GROUP BY nif_aplica`, [companyId]);
  const por = Object.fromEntries(r.rows.map((x: any) => [x.nif_aplica, x.n]));
  return {
    especifica: por.ESPECIFICA ?? 0,
    noAplica: por.NO_APLICA ?? 0,
    depende: por.DEPENDE ?? 0,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. EL CONTEXTO
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Arma el contexto a partir de una balanza y su mapeo.
 *
 * SÓLO se toman las cuentas HOJA. Las sumarias repiten a sus hijas, y sumar
 * las dos cosas cuenta doble: el activo saldría al doble y ninguna regla que
 * compare importes diría algo cierto.
 */
export function contextoDeBalanza(
  filas: FilaBalanza[],
  mapeo: PropuestaCuenta[],
  fechaCorte: string,
): ContextoNif {
  const porCuenta = new Map(mapeo.map((m) => [m.cuenta, m]));
  const marcadas = marcarHojas([...filas]);

  const saldos: SaldoAgrupado[] = marcadas
    .filter((f) => f.hoja)
    .map((f) => {
      const m = porCuenta.get(f.cuenta);
      return {
        agrupador: m?.agrupador ?? '',
        cuenta: f.cuenta,
        nombre: f.nombre,
        naturaleza: f.naturaleza,
        saldo: f.saldoFinal,
        /* Una complementaria tiene naturaleza contraria a la de su tipo: su
         * saldo "al revés" es lo normal y no se debe reportar como raro. */
        esComplementaria: !!m && esComplementariaPorAgrupador(m.agrupador),
      };
    });

  const bajo = (prefijos: string[]) =>
    saldos.filter((s) => s.agrupador && prefijos.some((p) => s.agrupador.startsWith(p)));

  return {
    fechaCorte,
    saldos,
    suma: (...p) => bajo(p).reduce((a, s) => a + s.saldo, 0),
    cuentas: (...p) => bajo(p),
    existe: (...p) => bajo(p).length > 0,
  };
}

const COMPLEMENTARIAS = ['108', '116', '171', '172', '183', '402', '503'];
function esComplementariaPorAgrupador(a: string | null): boolean {
  if (!a) return false;
  return COMPLEMENTARIAS.some((c) => a.startsWith(c));
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. LA CORRIDA
   ═══════════════════════════════════════════════════════════════════════════ */

export interface Hallazgo {
  regla: string;
  version: number;
  norma: string;
  ambito: string;
  titulo: string;
  estado: string;
  severidad: string;
  mensaje: string;
  queExige: string;
  consecuencia: string;
  fundamento?: string;
  cifras: Record<string, any>;
  cuentas: string[];
}

export interface ResultadoEvaluacion {
  evaluacionId?: string;
  fechaCorte: string;
  reglasCorridas: number;
  cumple: number;
  noCumple: number;
  revisar: number;
  noAplica: number;
  hallazgos: Hallazgo[];
}

/**
 * Corre todas las reglas activas.
 *
 * Una regla que revienta NO tumba la corrida: se reporta como hallazgo y las
 * demás siguen. Un motor de doce reglas que se cae por la tercera es un motor
 * que no da ninguna respuesta cuando más falta hace.
 */
export function evaluar(ctx: ContextoNif, reglas: ReglaNif[] = REGLAS_NIF): ResultadoEvaluacion {
  const hallazgos: Hallazgo[] = [];

  for (const r of reglas) {
    let res;
    try {
      res = r.evaluar(ctx);
    } catch (e: any) {
      res = {
        estado: 'REQUIERE_REVISION' as const,
        mensaje: `La regla no se pudo evaluar: ${e.message}. Revísala a mano.`,
      };
    }
    hallazgos.push({
      regla: r.clave, version: r.version, norma: r.norma, ambito: r.ambito,
      titulo: r.titulo, estado: res.estado, severidad: r.severidad,
      mensaje: res.mensaje, queExige: r.queExige, consecuencia: r.consecuencia,
      fundamento: r.fundamento,
      cifras: res.cifras ?? {}, cuentas: res.cuentas ?? [],
    });
  }

  const cuenta = (e: string) => hallazgos.filter((h) => h.estado === e).length;

  /* El orden importa: lo que no cumple va primero, y dentro de eso lo grave.
   * Una lista ordenada por regla obliga a leerla entera para encontrar lo que
   * urge. */
  const pesoEstado: Record<string, number> = {
    NO_CUMPLE: 0, REQUIERE_REVISION: 1, CUMPLE: 2, NO_APLICA: 3,
  };
  const pesoSev: Record<string, number> = { ALTA: 0, MEDIA: 1, INFORMATIVA: 2 };
  hallazgos.sort((a, b) =>
    (pesoEstado[a.estado] - pesoEstado[b.estado])
    || (pesoSev[a.severidad] - pesoSev[b.severidad]));

  return {
    fechaCorte: ctx.fechaCorte,
    reglasCorridas: reglas.length,
    cumple: cuenta('CUMPLE'),
    noCumple: cuenta('NO_CUMPLE'),
    revisar: cuenta('REQUIERE_REVISION'),
    noAplica: cuenta('NO_APLICA'),
    hallazgos,
  };
}

/** Guarda la corrida, para poder comparar contra la del mes pasado. */
export async function guardarEvaluacion(
  companyId: string,
  r: ResultadoEvaluacion,
  origen: 'BALANZA' | 'CATALOGO' | 'POLIZAS' = 'BALANZA',
  userId?: string,
): Promise<string> {
  return transaction(async (client: PoolClient) => {
    const ev = await transactionQuery<any>(
      client,
      `INSERT INTO nif_evaluaciones
         (company_id, fecha_corte, origen, reglas_corridas, cumple, no_cumple,
          revisar, no_aplica, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [companyId, r.fechaCorte, origen, r.reglasCorridas, r.cumple, r.noCumple,
       r.revisar, r.noAplica, userId ?? null],
    );
    const id = ev.rows[0].id;

    for (const h of r.hallazgos) {
      await transactionQuery(
        client,
        `INSERT INTO nif_hallazgos
           (evaluacion_id, regla_clave, regla_version, norma, ambito, estado,
            severidad, mensaje, cifras, cuentas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, h.regla, h.version, h.norma, h.ambito, h.estado, h.severidad,
         h.mensaje, JSON.stringify(h.cifras), h.cuentas],
      );
    }
    return id;
  });
}

export async function evaluacionesDe(companyId: string, limite = 12) {
  const r = await query<any>(
    `SELECT * FROM nif_evaluaciones WHERE company_id=$1
      ORDER BY fecha_corte DESC, created_at DESC LIMIT $2`,
    [companyId, limite]);
  return r.rows;
}

export async function hallazgosDe(evaluacionId: string) {
  const r = await query<any>(
    `SELECT h.*, r.titulo, r.que_exige, r.consecuencia, r.fundamento
       FROM nif_hallazgos h
       JOIN nif_reglas r ON r.clave = h.regla_clave AND r.version = h.regla_version
      WHERE h.evaluacion_id = $1
      ORDER BY CASE h.estado WHEN 'NO_CUMPLE' THEN 0 WHEN 'REQUIERE_REVISION' THEN 1
                             WHEN 'CUMPLE' THEN 2 ELSE 3 END,
               CASE h.severidad WHEN 'ALTA' THEN 0 WHEN 'MEDIA' THEN 1 ELSE 2 END`,
    [evaluacionId]);
  return r.rows;
}

export default {
  sincronizarReglas, clasificarCatalogoSat, clasificarCuentasEmpresa,
  contextoDeBalanza, evaluar, guardarEvaluacion, evaluacionesDe, hallazgosDe,
};
