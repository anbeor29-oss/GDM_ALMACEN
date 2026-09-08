/**
 * Validación contable — revisa la partida doble de punta a punta y dice DÓNDE está
 * el descuadre, en vez de sólo avisar que el balance no cuadra.
 *
 * Tres pruebas, de lo micro a lo macro:
 *   1. Póliza por póliza: cada asiento debe tener sus cargos = sus abonos, y al
 *      menos dos renglones. Una póliza descuadrada es la causa más común de que la
 *      balanza y el balance no cierren.
 *   2. Balanza: la suma de TODOS los cargos = la suma de TODOS los abonos.
 *   3. Balance vs estado de resultados: activo = pasivo + capital, y la utilidad
 *      del estado de resultados = la que quedó en el capital (cuenta de resultado).
 */
import { query } from '../../config/database';
import { contextoDelPeriodo } from './periodos.service';
import { situacionFinanciera, resultadoIntegral } from './estados-financieros.service';

const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

/* Rangos de agrupador (mayor) que los estados financieros SÍ colocan en un rubro.
 * Van a la par de estados-financieros.service.ts (situacionFinanciera /
 * resultadoIntegral). Un saldo cuyo mayor cae FUERA de estos rangos tiene agrupador
 * pero no llega a ningún rubro: descuadra el balance sin descuadrar ninguna póliza
 * ni la balanza. Es el error que caza el "localizador". OJO con los huecos a
 * propósito: 305 (es el resultado, ya representado por la utilidad), y 605/606
 * (que hoy el estado de resultados no suma). */
const RANGOS_EN_RUBRO: Array<[number, number]> = [
  [101, 121], [151, 190],   // Activo
  [201, 218], [251, 260],   // Pasivo
  [301, 304], [306, 306],   // Capital (305 aparte)
  [401, 403],               // Ingresos
  [501, 505],               // Costo
  [601, 604], [607, 611],   // Gastos e impuestos (605 y 606 quedan fuera)
  [701, 704],               // Depreciación, RIF, otros
];
const mayorDe = (agr: string) => parseInt(String(agr || '').split('.')[0], 10);
const enRubro = (agr: string) => {
  const n = mayorDe(agr);
  return Number.isFinite(n) && RANGOS_EN_RUBRO.some(([a, b]) => n >= a && n <= b);
};
const seccionDe = (agr: string): string => {
  const d = String(agr || '').charAt(0);
  return d === '1' ? 'Activo' : d === '2' ? 'Pasivo' : d === '3' ? 'Capital'
    : (d >= '4' && d <= '7') ? 'Resultado' : 'Otro';
};

/**
 * Localiza un descuadre del balance cuando las pólizas y la balanza SÍ cuadran.
 * En ese caso el hueco viene de saldos que no llegan a ningún rubro del estado:
 *   - por SECCIÓN: la verdad de fondo (suma completa del grupo, como la regla
 *     A5-ECUACION) menos lo que el estado presentó → dice si el hueco está en
 *     activo, pasivo, capital o resultado.
 *   - por CUENTA: las cuentas con agrupador cuyo mayor cae fuera de los rangos que
 *     el estado coloca. Ésas son la causa concreta (p.ej. un 605 o un 305).
 */
function localizarDescuadre(ctx: any, bal: any, res: any) {
  const resultados = ctx.cuentas('4', '5', '6', '7');
  const ingresosReal = resultados.filter((x: any) => x.naturaleza === 'A').reduce((a: number, x: any) => a + x.saldo, 0);
  const egresosReal = resultados.filter((x: any) => x.naturaleza === 'D').reduce((a: number, x: any) => a + x.saldo, 0);
  const secciones = [
    { seccion: 'Activo',    dif: r2(ctx.suma('1') - bal.activoTotal) },
    { seccion: 'Pasivo',    dif: r2(ctx.suma('2') - bal.pasivoTotal) },
    { seccion: 'Capital',   dif: r2(ctx.suma('3') - (bal.capitalTotal - res.utilidadNeta)) },
    { seccion: 'Resultado', dif: r2((ingresosReal - egresosReal) - res.utilidadNeta) },
  ].filter((s) => Math.abs(s.dif) >= 0.5);

  const cuentasFuera = (ctx.saldos || [])
    .filter((s: any) => s.agrupador && !enRubro(s.agrupador) && Math.abs(Number(s.saldo)) >= 0.5)
    .map((s: any) => ({
      codigo: s.cuenta, nombre: s.nombre, agrupador: s.agrupador,
      naturaleza: s.naturaleza, saldo: r2(s.saldo), seccion: seccionDe(s.agrupador),
    }))
    .sort((a: any, b: any) => Math.abs(b.saldo) - Math.abs(a.saldo))
    .slice(0, 100);

  return { secciones, cuentasFuera, sumaFuera: r2(cuentasFuera.reduce((a: number, c: any) => a + Math.abs(c.saldo), 0)) };
}

export async function validarContabilidad(companyId: string, anio: number, mes: number) {
  const anioValido = mes >= 1 && mes <= 12;
  const desde = anioValido ? `${anio}-${String(mes).padStart(2, '0')}-01` : `${anio}-01-01`;
  const ultimoDia = anioValido ? new Date(anio, mes, 0).getDate() : 31;
  const hasta = anioValido ? `${anio}-${String(mes).padStart(2, '0')}-${ultimoDia}` : `${anio}-12-31`;

  /* ── 1. Pólizas descuadradas (en TODA la contabilidad hasta el corte) ──
   * No se filtra por el mes: una póliza descuadrada de marzo rompe el balance de
   * diciembre. Se revisan todas las de la empresa hasta la fecha de corte. */
  const desc = (await query<any>(
    `SELECT e.id, e.folio, TO_CHAR(e.fecha,'YYYY-MM-DD') AS fecha, e.tipo, e.origen, e.estado,
            LEFT(COALESCE(e.concepto,''),80) AS concepto,
            COALESCE(SUM(l.cargo),0)::float AS cargos,
            COALESCE(SUM(l.abono),0)::float AS abonos,
            COUNT(l.id)::int AS lineas
       FROM journal_entries e
       LEFT JOIN journal_lines l ON l.entry_id = e.id
      WHERE e.company_id=$1 AND e.fecha <= $2 AND e.estado <> 'REVERSADA'
      GROUP BY e.id
     HAVING ROUND((COALESCE(SUM(l.cargo),0) - COALESCE(SUM(l.abono),0))::numeric, 2) <> 0
         OR COUNT(l.id) < 2
      ORDER BY e.fecha, e.folio
      LIMIT 500`, [companyId, hasta])).rows;
  const polizasDescuadradas = desc.map((d: any) => ({
    id: d.id, folio: d.folio, fecha: d.fecha, tipo: d.tipo, origen: d.origen, estado: d.estado,
    concepto: d.concepto, cargos: r2(d.cargos), abonos: r2(d.abonos), lineas: d.lineas,
    diferencia: r2(d.cargos - d.abonos),
    motivo: d.lineas < 2 ? `sólo ${d.lineas} renglón(es)` : `descuadre ${r2(d.cargos - d.abonos)}`,
  }));
  const sumaDescuadres = r2(polizasDescuadradas.reduce((a, p) => a + Math.abs(p.diferencia), 0));

  /* ── 2. Balanza: todos los cargos vs todos los abonos hasta el corte ── */
  const tot = (await query<any>(
    `SELECT COALESCE(SUM(l.cargo),0)::float AS c, COALESCE(SUM(l.abono),0)::float AS a
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.company_id=$1 AND e.fecha <= $2`, [companyId, hasta])).rows[0];
  const balanza = {
    cargos: r2(tot.c), abonos: r2(tot.a), diferencia: r2(tot.c - tot.a),
    cuadra: Math.abs(tot.c - tot.a) < 0.005,
  };

  /* ── 3. Balance vs estado de resultados (del periodo elegido) ── */
  let balance: any = null;
  if (anioValido) {
    const ctx = await contextoDelPeriodo(companyId, anio, mes);
    if (ctx) {
      const bal = situacionFinanciera(ctx);
      const res = resultadoIntegral(ctx);
      // Cuentas con saldo que NO llegaron a ningún rubro del balance (sin agrupador):
      // se quedan fuera del estado y descuadran el balance sin descuadrar ninguna póliza.
      // SaldoAgrupado guarda el código en `cuenta` (no `codigo`); el agrupador vacío
      // ('') es lo que marca una cuenta que no llegó a ningún rubro del estado.
      const sinRubro = (ctx.saldos || [])
        .filter((s) => !s.agrupador && Math.abs(Number(s.saldo)) >= 0.5)
        .map((s) => ({ codigo: s.cuenta, nombre: s.nombre, saldo: r2(s.saldo) }))
        .slice(0, 100);
      balance = {
        activo: r2(bal.activoTotal),
        pasivoMasCapital: r2(bal.pasivoTotal + bal.capitalTotal),
        diferencia: r2(bal.diferencia),
        cuadra: bal.cuadra,
        utilidadEstadoResultados: r2(res.utilidadNeta),
        resultadoEnCapital: res.resultadoSegun305 == null ? null : r2(res.resultadoSegun305),
        difResultado: res.diferenciaCon305 == null ? null : r2(res.diferenciaCon305),
        cuentasSinRubro: sinRubro,
        // Localizador: sólo tiene sentido calcularlo cuando el balance NO cuadra.
        localizador: bal.cuadra ? null : localizarDescuadre(ctx, bal, res),
      };
    }
  }

  const localizadorLimpio = !balance?.localizador
    || (balance.localizador.secciones.length === 0 && balance.localizador.cuentasFuera.length === 0);
  const todoBien = polizasDescuadradas.length === 0 && balanza.cuadra
    && (!balance || (balance.cuadra && (balance.difResultado == null || Math.abs(balance.difResultado) < 0.5)
      && balance.cuentasSinRubro.length === 0 && localizadorLimpio));

  return { anio, mes, hasta, todoBien, polizasDescuadradas, sumaDescuadres, balanza, balance };
}
