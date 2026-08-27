/**
 * Periodos contables: el acumulador que alimenta a todos los estados.
 *
 * ── LA IDEA ──
 * Un estado financiero no lee un archivo: lee un PERIODO. El periodo se
 * alimenta de varias fuentes, en momentos distintos, y cada estado sale de
 * los mismos saldos.
 *
 *     balanza de otro sistema ─┐
 *     CFDI emitidos           ─┤
 *     CFDI recibidos          ─┼──►  saldos del periodo  ──►  Balanza
 *     nómina timbrada         ─┤                              Situación financiera
 *     pólizas capturadas      ─┘                              Resultados
 *                                                             Flujo de efectivo
 *                                                             Cambios en capital
 *
 * Por eso los estados no cambian cuando cambie la fuente: el día que los XML
 * generen pólizas, las pólizas escriben aquí y las mismas pantallas se llenan
 * solas.
 *
 * ── EL ENLACE ENTRE MESES ──
 * El saldo final de un mes tiene que ser el inicial del siguiente. Es la misma
 * comprobación que ya se hace con los estados de cuenta bancarios, y por la
 * misma razón: un mes faltante descuadra todos los posteriores, y cada uno por
 * separado se ve perfecto.
 */

import { query, transaction, transactionQuery } from '../../config/database';
import type { PoolClient } from 'pg';
import type { FilaBalanza } from './balanza-lector.service';
import { marcarHojas } from './balanza-lector.service';
import type { PropuestaCuenta } from './mapeador-sat.service';
import type { ContextoNif, SaldoAgrupado } from './nif-reglas.data';
import logger from '../../middleware/logger';

export type Fuente =
  | 'BALANZA_EXTERNA' | 'CFDI_EMITIDOS' | 'CFDI_RECIBIDOS'
  | 'NOMINA' | 'POLIZAS' | 'MANUAL';

export interface EstadoPeriodo {
  periodoId: string | null;
  anio: number;
  mes: number;
  estado: 'ABIERTO' | 'CERRADO' | 'SIN_EJERCICIO';
  cuentasConSaldo: number;
  totalCargos: number;
  totalAbonos: number;
  cuadra: boolean;
  fuentes: Array<{
    fuente: Fuente; descripcion: string | null; cuentas: number;
    totalCargos: number; totalAbonos: number; archivo: string | null; fecha: string;
  }>;
  enviadoSatAt: string | null;
  tieneDatos: boolean;
}

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export const nombreMes = (m: number) => MESES[m] ?? String(m);

/* ═══════════════════════════════════════════════════════════════════════════
   1. CONSULTA
   ═══════════════════════════════════════════════════════════════════════════ */

async function periodoDe(companyId: string, anio: number, mes: number) {
  const r = await query<any>(
    `SELECT * FROM accounting_periods WHERE company_id=$1 AND anio=$2 AND mes=$3`,
    [companyId, anio, mes]);
  return r.rows[0] ?? null;
}

export async function estadoDelPeriodo(
  companyId: string, anio: number, mes: number,
): Promise<EstadoPeriodo> {
  const p = await periodoDe(companyId, anio, mes);
  if (!p) {
    return {
      periodoId: null, anio, mes, estado: 'SIN_EJERCICIO',
      cuentasConSaldo: 0, totalCargos: 0, totalAbonos: 0, cuadra: false,
      fuentes: [], enviadoSatAt: null, tieneDatos: false,
    };
  }

  const s = await query<any>(
    `SELECT COUNT(*)::int cuentas,
            COALESCE(SUM(cargos),0)::float cargos,
            COALESCE(SUM(abonos),0)::float abonos
       FROM accounting_period_balances WHERE periodo_id=$1`, [p.id]);

  const f = await query<any>(
    `SELECT fuente, descripcion, cuentas, total_cargos::float, total_abonos::float,
            archivo, created_at
       FROM accounting_period_sources WHERE periodo_id=$1 ORDER BY created_at DESC`, [p.id]);

  const cargos = s.rows[0].cargos;
  const abonos = s.rows[0].abonos;

  return {
    periodoId: p.id, anio, mes, estado: p.estado,
    cuentasConSaldo: s.rows[0].cuentas,
    totalCargos: cargos, totalAbonos: abonos,
    cuadra: Math.abs(cargos - abonos) <= 0.02,
    fuentes: f.rows.map((x: any) => ({
      fuente: x.fuente, descripcion: x.descripcion, cuentas: x.cuentas,
      totalCargos: x.total_cargos, totalAbonos: x.total_abonos,
      archivo: x.archivo, fecha: x.created_at,
    })),
    enviadoSatAt: p.enviado_sat_at,
    tieneDatos: s.rows[0].cuentas > 0,
  };
}

/** Los doce meses del año, con su estado. El hueco es el dato. */
export async function anioCompleto(companyId: string, anio: number) {
  const meses: EstadoPeriodo[] = [];
  for (let m = 1; m <= 12; m++) meses.push(await estadoDelPeriodo(companyId, anio, m));

  /* ── El enlace entre meses ──
   * El saldo final de uno tiene que ser el inicial del siguiente. Un mes que
   * falta descuadra a todos los que vienen después, y cada uno por separado
   * se ve perfecto. */
  const saltos: string[] = [];
  for (let m = 2; m <= 12; m++) {
    const ant = meses[m - 2];
    const act = meses[m - 1];
    if (!ant.tieneDatos || !act.tieneDatos) continue;
    const r = await query<any>(
      `SELECT COALESCE(SUM(a.saldo_final),0)::float fin,
              COALESCE(SUM(b.saldo_inicial),0)::float ini
         FROM accounting_period_balances a
         FULL JOIN accounting_period_balances b
           ON b.account_id = a.account_id AND b.periodo_id = $2
        WHERE a.periodo_id = $1`, [ant.periodoId, act.periodoId]);
    const dif = r.rows[0].fin - r.rows[0].ini;
    if (Math.abs(dif) > 0.02) {
      saltos.push(
        `${nombreMes(m - 1)} cierra en ${r.rows[0].fin.toFixed(2)} y ${nombreMes(m)} ` +
        `abre en ${r.rows[0].ini.toFixed(2)}: hay ${Math.abs(dif).toFixed(2)} de diferencia.`);
    }
  }

  const conDatos = meses.filter((m) => m.tieneDatos).length;

  /* ── Un hueco es un mes vacio ENTRE dos meses con datos ──
   * Los meses anteriores al primero cargado no son huecos: son el tiempo antes
   * de empezar. Marcarlos llena el aviso de meses que nadie pensaba cargar, y
   * un aviso con cinco falsos positivos deja de leerse — que es como se pierde
   * el sexto, que si era real. */
  const primero = meses.findIndex((m) => m.tieneDatos);
  const ultimo = meses.map((m) => m.tieneDatos).lastIndexOf(true);
  const huecos = primero < 0 ? [] : meses
    .filter((m, i) => i > primero && i < ultimo && !m.tieneDatos)
    .map((m) => nombreMes(m.mes));

  return { anio, meses, conDatos, cerrados: meses.filter((m) => m.estado === 'CERRADO').length, saltos, huecos };
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. EL CONTEXTO QUE CONSUMEN LOS ESTADOS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Los saldos de un periodo, listos para cualquier estado o para el motor NIF.
 *
 * Devuelve null cuando el periodo no tiene datos. Devolver un contexto vacío
 * haría que los estados salieran en ceros —con toda la apariencia de una
 * empresa sin movimiento— en vez de decir que no se ha cargado nada.
 */
export async function contextoDelPeriodo(
  companyId: string, anio: number, mes: number,
): Promise<ContextoNif | null> {
  const p = await periodoDe(companyId, anio, mes);
  if (!p) return null;

  const r = await query<any>(
    `SELECT c.codigo, c.nombre, c.codigo_agrupador, c.naturaleza,
            c.es_complementaria, b.saldo_final::float, b.cargos::float, b.abonos::float
       FROM accounting_period_balances b
       JOIN accounting_accounts c ON c.id = b.account_id
      WHERE b.periodo_id = $1
      ORDER BY c.codigo`, [p.id]);

  if (!r.rows.length) return null;

  const saldos: SaldoAgrupado[] = r.rows.map((x: any) => ({
    agrupador: x.codigo_agrupador ?? '',
    cuenta: x.codigo,
    nombre: x.nombre,
    naturaleza: x.naturaleza === 'ACREEDORA' ? 'A' : 'D',
    saldo: x.saldo_final,
    esComplementaria: x.es_complementaria,
  }));

  const bajo = (pref: string[]) =>
    saldos.filter((s) => s.agrupador && pref.some((x) => s.agrupador.startsWith(x)));

  return {
    fechaCorte: p.fecha_fin instanceof Date
      ? p.fecha_fin.toISOString().slice(0, 10) : String(p.fecha_fin).slice(0, 10),
    saldos,
    suma: (...pr) => bajo(pr).reduce((a, s) => a + s.saldo, 0),
    cuentas: (...pr) => bajo(pr),
    existe: (...pr) => bajo(pr).length > 0,
  };
}

/** La balanza de comprobación del periodo, en el formato del Anexo 24. */
export async function balanzaDelPeriodo(companyId: string, anio: number, mes: number) {
  const p = await periodoDe(companyId, anio, mes);
  if (!p) return null;
  const r = await query<any>(
    `SELECT c.codigo, c.nombre, c.naturaleza, c.codigo_agrupador, c.nivel,
            b.saldo_inicial::float, b.cargos::float, b.abonos::float, b.saldo_final::float
       FROM accounting_period_balances b
       JOIN accounting_accounts c ON c.id = b.account_id
      WHERE b.periodo_id = $1
      ORDER BY c.codigo`, [p.id]);
  if (!r.rows.length) return null;

  const filas = r.rows;
  const sumaCargos = filas.reduce((a: number, x: any) => a + x.cargos, 0);
  const sumaAbonos = filas.reduce((a: number, x: any) => a + x.abonos, 0);
  return {
    anio, mes, periodoId: p.id, estado: p.estado,
    fechaInicio: p.fecha_inicio, fechaFin: p.fecha_fin,
    filas,
    sumaCargos, sumaAbonos,
    diferencia: sumaCargos - sumaAbonos,
    cuadra: Math.abs(sumaCargos - sumaAbonos) <= 0.02,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. ALIMENTAR
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ResultadoCarga {
  periodoId: string;
  cuentas: number;
  cuentasNuevas: number;
  totalCargos: number;
  totalAbonos: number;
  cuadra: boolean;
  sinMapear: string[];
}

/**
 * Vuelca una balanza externa en el periodo.
 *
 * ── SE CREAN LAS CUENTAS QUE FALTEN ──
 * La balanza de otro sistema trae su propia numeración. Las cuentas que no
 * existan en el catálogo se dan de alta con su código agrupador propuesto —si
 * no, la mitad de los saldos no tendría dónde caer y el balance no cuadraría
 * por razones que no son contables.
 *
 * ── REEMPLAZA, NO ACUMULA ──
 * Volver a cargar la balanza de un mes sustituye lo que esa fuente había
 * dejado. Sumar convertiría la segunda carga en el doble del mes, y es lo que
 * pasa siempre: se carga, se detecta un error en el origen, se vuelve a
 * cargar.
 */
export async function alimentarDesdeBalanza(
  companyId: string,
  anio: number,
  mes: number,
  filas: FilaBalanza[],
  mapeo: PropuestaCuenta[],
  opciones: { archivo?: string; userId?: string; descripcion?: string } = {},
): Promise<ResultadoCarga> {
  const p = await periodoDe(companyId, anio, mes);
  if (!p) {
    throw new Error(
      `No existe el periodo ${nombreMes(mes)} ${anio}. Activa la contabilidad de ` +
      `ese ejercicio antes de cargarle saldos.`);
  }
  if (p.estado === 'CERRADO') {
    throw new Error(
      `${nombreMes(mes)} ${anio} está cerrado. Reábrelo si de verdad hay que corregirlo.`);
  }

  const porCuenta = new Map(mapeo.map((m) => [m.cuenta, m]));
  const hojas = marcarHojas([...filas]).filter((f) => f.hoja);
  const sinMapear: string[] = [];

  return transaction(async (client: PoolClient) => {
    /* Lo que esta fuente había dejado se va: se reemplaza, no se acumula. */
    await transactionQuery(
      client,
      `DELETE FROM accounting_period_balances WHERE periodo_id = $1`, [p.id]);

    let cuentasNuevas = 0;
    let totalCargos = 0;
    let totalAbonos = 0;

    for (const f of hojas) {
      const m = porCuenta.get(f.cuenta);
      const naturaleza = f.naturaleza === 'A' ? 'ACREEDORA' : 'DEUDORA';

      /* La cuenta en el catálogo propio. */
      let cta = await transactionQuery<any>(
        client,
        `SELECT id FROM accounting_accounts WHERE company_id=$1 AND codigo=$2`,
        [companyId, f.cuenta]);

      if (!cta.rows.length) {
        if (!m?.agrupador) sinMapear.push(`${f.cuenta} ${f.nombre}`);
        const tipo = m?.tipoPorCodigo ?? 'ACTIVO';
        const ins = await transactionQuery<any>(
          client,
          `INSERT INTO accounting_accounts
             (company_id, codigo, nombre, codigo_agrupador, tipo, naturaleza,
              nivel, permite_movimientos, notas)
           VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8)
           ON CONFLICT (company_id, codigo) DO UPDATE SET updated_at = NOW()
           RETURNING id`,
          [companyId, f.cuenta, f.nombre || f.cuenta, m?.agrupador ?? null,
           tipo, naturaleza, f.cuenta.split('-').length,
           `Creada al cargar la balanza de ${nombreMes(mes)} ${anio}.`]);
        cta = ins;
        cuentasNuevas++;
      }

      await transactionQuery(
        client,
        `INSERT INTO accounting_period_balances
           (company_id, periodo_id, account_id, saldo_inicial, cargos, abonos, saldo_final)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (periodo_id, account_id) DO UPDATE
           SET saldo_inicial = EXCLUDED.saldo_inicial,
               cargos = EXCLUDED.cargos, abonos = EXCLUDED.abonos,
               saldo_final = EXCLUDED.saldo_final, updated_at = NOW()`,
        [companyId, p.id, cta.rows[0].id,
         f.saldoInicial, f.debe, f.haber, f.saldoFinal]);

      totalCargos += f.debe;
      totalAbonos += f.haber;
    }

    await transactionQuery(
      client,
      `DELETE FROM accounting_period_sources
        WHERE periodo_id=$1 AND fuente='BALANZA_EXTERNA'`, [p.id]);
    await transactionQuery(
      client,
      `INSERT INTO accounting_period_sources
         (company_id, periodo_id, fuente, descripcion, cuentas, total_cargos,
          total_abonos, modo, archivo, created_by)
       VALUES ($1,$2,'BALANZA_EXTERNA',$3,$4,$5,$6,'REEMPLAZA',$7,$8)`,
      [companyId, p.id,
       opciones.descripcion ?? `Balanza externa de ${nombreMes(mes)} ${anio}`,
       hojas.length, totalCargos, totalAbonos,
       opciones.archivo ?? null, opciones.userId ?? null]);

    logger.info(
      `[contabilidad] ${nombreMes(mes)} ${anio}: ${hojas.length} cuentas cargadas ` +
      `(${cuentasNuevas} nuevas) desde balanza externa`);

    return {
      periodoId: p.id,
      cuentas: hojas.length,
      cuentasNuevas,
      totalCargos,
      totalAbonos,
      cuadra: Math.abs(totalCargos - totalAbonos) <= 0.02,
      sinMapear: sinMapear.slice(0, 20),
    };
  });
}

/**
 * Deriva la balanza del mes de las PÓLIZAS (journal_lines). Es el puente que hace
 * que lo contabilizado —ventas, compras, cobros/pagos, nómina, manuales— se vea
 * en la balanza de comprobación y en los estados. El botón «Actualizar» la vuelve
 * a calcular mes a mes.
 *
 *   cargos/abonos = Σ de las partidas de las pólizas del mes, por cuenta.
 *   saldo_inicial = saldo_final del mes anterior (la cadena de saldos).
 *   saldo_final   = por naturaleza (deudora: +cargos−abonos; acreedora: al revés).
 *
 * REEMPLAZA la balanza del periodo (como la carga de una balanza externa): al
 * re-generar pólizas y volver a actualizar, no se duplica. Ojo: si el mes tenía
 * una balanza EXTERNA cargada, ésta la sustituye —son dos formas de armar el
 * mismo mes; la de apertura vive en el saldo inicial del primer periodo—.
 */
export async function alimentarDesdePolizas(
  companyId: string, anio: number, mes: number, opciones: { userId?: string } = {}
): Promise<{ periodoId: string; cuentas: number; totalCargos: number; totalAbonos: number; cuadra: boolean }> {
  const p = await periodoDe(companyId, anio, mes);
  if (!p) throw new Error(`No existe el periodo ${nombreMes(mes)} ${anio}. Activa la contabilidad de ese ejercicio.`);
  if (p.estado === 'CERRADO') throw new Error(`${nombreMes(mes)} ${anio} está cerrado. Reábrelo para actualizarlo.`);

  const mov = await query<any>(
    `SELECT l.account_id, a.naturaleza,
            COALESCE(SUM(l.cargo),0)::float AS cargos,
            COALESCE(SUM(l.abono),0)::float AS abonos
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounting_accounts a ON a.id = l.account_id
      WHERE e.company_id=$1 AND e.fecha >= $2::date AND e.fecha <= $3::date
      GROUP BY l.account_id, a.naturaleza
      HAVING COALESCE(SUM(l.cargo),0) <> 0 OR COALESCE(SUM(l.abono),0) <> 0`,
    [companyId, p.fecha_inicio, p.fecha_fin]);

  // Saldo inicial = saldo_final del mes anterior (si ya tiene balanza).
  const mesPrev = mes === 1 ? 12 : mes - 1;
  const anioPrev = mes === 1 ? anio - 1 : anio;
  const prev = await periodoDe(companyId, anioPrev, mesPrev);
  const ini = new Map<string, number>();
  if (prev) {
    const pb = await query<any>(
      `SELECT account_id, saldo_final::float AS sf FROM accounting_period_balances WHERE periodo_id=$1`, [prev.id]);
    for (const r of pb.rows) ini.set(r.account_id, r.sf);
  }

  return transaction(async (client: PoolClient) => {
    await transactionQuery(client, `DELETE FROM accounting_period_balances WHERE periodo_id=$1`, [p.id]);
    let totalCargos = 0, totalAbonos = 0;
    for (const m of mov.rows) {
      const si = ini.get(m.account_id) || 0;
      const sf = m.naturaleza === 'ACREEDORA' ? si - m.cargos + m.abonos : si + m.cargos - m.abonos;
      await transactionQuery(client,
        `INSERT INTO accounting_period_balances
           (company_id, periodo_id, account_id, saldo_inicial, cargos, abonos, saldo_final)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (periodo_id, account_id) DO UPDATE
           SET saldo_inicial=EXCLUDED.saldo_inicial, cargos=EXCLUDED.cargos,
               abonos=EXCLUDED.abonos, saldo_final=EXCLUDED.saldo_final, updated_at=NOW()`,
        [companyId, p.id, m.account_id, si, m.cargos, m.abonos, Math.round(sf * 100) / 100]);
      totalCargos += m.cargos; totalAbonos += m.abonos;
    }
    await transactionQuery(client,
      `DELETE FROM accounting_period_sources WHERE periodo_id=$1 AND fuente='POLIZAS'`, [p.id]);
    await transactionQuery(client,
      `INSERT INTO accounting_period_sources
         (company_id, periodo_id, fuente, descripcion, cuentas, total_cargos, total_abonos, modo, created_by)
       VALUES ($1,$2,'POLIZAS',$3,$4,$5,$6,'REEMPLAZA',$7)`,
      [companyId, p.id, `Pólizas de ${nombreMes(mes)} ${anio}`, mov.rows.length, totalCargos, totalAbonos, opciones.userId ?? null]);
    logger.info(`[contabilidad] ${nombreMes(mes)} ${anio}: balanza derivada de ${mov.rows.length} cuenta(s) con póliza`);
    return {
      periodoId: p.id, cuentas: mov.rows.length,
      totalCargos: Math.round(totalCargos * 100) / 100,
      totalAbonos: Math.round(totalAbonos * 100) / 100,
      cuadra: Math.abs(totalCargos - totalAbonos) <= 0.02,
    };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. CIERRE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Cierra el mes.
 *
 * No se cierra un mes que no cuadra. Cerrar congela los saldos, y congelar un
 * descuadre lo vuelve permanente: todos los meses siguientes lo arrastran y ya
 * nadie sabe de dónde salió.
 */
export async function cerrarPeriodo(companyId: string, anio: number, mes: number, userId?: string) {
  const est = await estadoDelPeriodo(companyId, anio, mes);
  if (!est.periodoId) throw new Error(`No existe el periodo ${nombreMes(mes)} ${anio}.`);
  if (est.estado === 'CERRADO') throw new Error(`${nombreMes(mes)} ${anio} ya está cerrado.`);
  if (!est.tieneDatos) {
    throw new Error(
      `${nombreMes(mes)} ${anio} no tiene saldos. Cerrar un mes vacío lo deja en ceros ` +
      `para siempre, y el mes siguiente arranca de ahí.`);
  }
  if (!est.cuadra) {
    throw new Error(
      `${nombreMes(mes)} ${anio} no cuadra: cargos ${est.totalCargos.toFixed(2)} contra ` +
      `abonos ${est.totalAbonos.toFixed(2)}. Cerrarlo congelaría el descuadre y todos ` +
      `los meses siguientes lo arrastrarían.`);
  }

  /* Los meses anteriores del mismo año tienen que estar cerrados: cerrar
   * marzo con febrero abierto permite que febrero cambie después y deje a
   * marzo apoyado en un saldo inicial que ya no existe. */
  const abiertosAntes = await query<any>(
    `SELECT mes FROM accounting_periods p
      WHERE p.company_id=$1 AND p.anio=$2 AND p.mes<$3 AND p.estado='ABIERTO'
        AND EXISTS (SELECT 1 FROM accounting_period_balances b WHERE b.periodo_id=p.id)
      ORDER BY mes`, [companyId, anio, mes]);
  if (abiertosAntes.rows.length) {
    throw new Error(
      `Antes de cerrar ${nombreMes(mes)} hay que cerrar ` +
      `${abiertosAntes.rows.map((x: any) => nombreMes(x.mes)).join(', ')}: si un mes ` +
      `anterior cambia después, éste queda apoyado en un saldo inicial que ya no existe.`);
  }

  await query(
    `UPDATE accounting_periods SET estado='CERRADO', cerrado_por=$1, cerrado_at=NOW()
      WHERE company_id=$2 AND anio=$3 AND mes=$4`,
    [userId ?? null, companyId, anio, mes]);

  logger.info(`[contabilidad] ${nombreMes(mes)} ${anio} cerrado`);
  return estadoDelPeriodo(companyId, anio, mes);
}

export async function reabrirPeriodo(companyId: string, anio: number, mes: number) {
  /* Reabrir un mes con meses posteriores cerrados dejaría a esos apoyados en
   * un saldo que puede cambiar bajo sus pies. */
  const posterioresCerrados = await query<any>(
    `SELECT mes FROM accounting_periods
      WHERE company_id=$1 AND anio=$2 AND mes>$3 AND estado='CERRADO' ORDER BY mes`,
    [companyId, anio, mes]);
  if (posterioresCerrados.rows.length) {
    throw new Error(
      `No se puede reabrir ${nombreMes(mes)}: ` +
      `${posterioresCerrados.rows.map((x: any) => nombreMes(x.mes)).join(', ')} ya ` +
      `está(n) cerrado(s) y se apoyan en su saldo final. Reábrelos primero, del ` +
      `más reciente al más antiguo.`);
  }
  await query(
    `UPDATE accounting_periods SET estado='ABIERTO', cerrado_por=NULL, cerrado_at=NULL
      WHERE company_id=$1 AND anio=$2 AND mes=$3`, [companyId, anio, mes]);
  return estadoDelPeriodo(companyId, anio, mes);
}

export default {
  estadoDelPeriodo, anioCompleto, contextoDelPeriodo, balanzaDelPeriodo,
  alimentarDesdeBalanza, cerrarPeriodo, reabrirPeriodo, nombreMes,
};
