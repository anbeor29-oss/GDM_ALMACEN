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
      };
    }
  }

  const todoBien = polizasDescuadradas.length === 0 && balanza.cuadra
    && (!balance || (balance.cuadra && (balance.difResultado == null || Math.abs(balance.difResultado) < 0.5)
      && balance.cuentasSinRubro.length === 0));

  return { anio, mes, hasta, todoBien, polizasDescuadradas, sumaDescuadres, balanza, balance };
}
