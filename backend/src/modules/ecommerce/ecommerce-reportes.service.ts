/**
 * ecommerce-reportes.service — REPORTES DE VENTAS WEB (rebanada 11).
 *
 * Agrega los pedidos (`ec_order`) de la empresa en un rango de fechas: KPIs, serie
 * por día/mes, top productos y desglose por tienda. «Ventas» = pedidos confirmados
 * (estado distinto de PENDIENTE_PAGO y CANCELADO). Los pendientes se reportan aparte.
 * Sólo consulta; no toca nada. Todo acotado por `company_id`.
 */
import { query } from '../../config/database';

const hoyYmd = () => new Date().toISOString().slice(0, 10);
const primerDiaMes = () => `${new Date().toISOString().slice(0, 7)}-01`;

/** Normaliza una fecha YYYY-MM-DD; si viene mal, usa el fallback. */
function ymd(v: any, fallback: string): string {
  const s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

export async function reporteVentas(
  companyId: string, opts: { desde?: string; hasta?: string; storeId?: string } = {},
) {
  const desde = ymd(opts.desde, primerDiaMes());
  const hasta = ymd(opts.hasta, hoyYmd());
  const storeId = opts.storeId && String(opts.storeId).trim() ? String(opts.storeId).trim() : null;

  // Filtro común (rango por fecha del pedido + tienda opcional). $1 company, $2 desde, $3 hasta, $4 store.
  const params: any[] = [companyId, desde, hasta, storeId];
  const filtroStore = 'AND ($4::uuid IS NULL OR o.store_id = $4)';
  const enRango = `o.company_id=$1 AND o.created_at::date BETWEEN $2 AND $3 ${filtroStore}`;
  const CONFIRMADO = `o.estado NOT IN ('PENDIENTE_PAGO','CANCELADO')`;

  // ── KPIs ──
  const kpiR = await query<any>(
    `SELECT
       COUNT(*) FILTER (WHERE ${CONFIRMADO})::int                                       AS pedidos,
       COUNT(*) FILTER (WHERE o.estado='PENDIENTE_PAGO')::int                            AS pendientes,
       COUNT(*) FILTER (WHERE o.estado='CANCELADO')::int                                 AS cancelados,
       COUNT(*) FILTER (WHERE ${CONFIRMADO} AND o.facturado_at IS NOT NULL)::int         AS facturados,
       COALESCE(SUM(o.total)    FILTER (WHERE ${CONFIRMADO}),0)::float                   AS ventas,
       COALESCE(SUM(o.total)    FILTER (WHERE o.estado='PENDIENTE_PAGO'),0)::float       AS ventas_pendientes,
       COALESCE(SUM(o.descuento) FILTER (WHERE ${CONFIRMADO}),0)::float                  AS descuentos,
       COALESCE(SUM(o.envio_base + o.envio_iva) FILTER (WHERE ${CONFIRMADO}),0)::float   AS envios
     FROM ec_order o WHERE ${enRango}`, params);
  const k = kpiR.rows[0] || {};
  const ventas = Number(k.ventas) || 0;
  const pedidos = Number(k.pedidos) || 0;

  // ── Serie: por DÍA si el rango es corto (≤ 45 días), por MES si es largo ──
  const dias = Math.round((new Date(hasta).getTime() - new Date(desde).getTime()) / 86400000) + 1;
  const periodicidad: 'dia' | 'mes' = dias <= 45 ? 'dia' : 'mes';
  const unidad = periodicidad === 'dia' ? 'day' : 'month';
  const fmt = periodicidad === 'dia' ? 'YYYY-MM-DD' : 'YYYY-MM';
  const serieR = await query<any>(
    `SELECT TO_CHAR(date_trunc('${unidad}', o.created_at), '${fmt}') AS periodo,
            COUNT(*)::int AS pedidos,
            COALESCE(SUM(o.total),0)::float AS ventas
       FROM ec_order o
      WHERE ${enRango} AND ${CONFIRMADO}
      GROUP BY 1 ORDER BY 1`, params);

  // ── Top productos (por importe vendido, con IVA) ──
  const topR = await query<any>(
    `SELECT it.product_id, MAX(it.nombre) AS nombre,
            SUM(it.cantidad)::float AS unidades,
            SUM(it.importe + it.iva)::float AS importe
       FROM ec_order_item it
       JOIN ec_order o ON o.id = it.order_id
      WHERE ${enRango} AND ${CONFIRMADO}
      GROUP BY it.product_id
      ORDER BY importe DESC
      LIMIT 10`, params);

  // ── Por tienda ──
  const tiendaR = await query<any>(
    `SELECT s.id, s.nombre,
            COUNT(o.id) FILTER (WHERE ${CONFIRMADO})::int AS pedidos,
            COALESCE(SUM(o.total) FILTER (WHERE ${CONFIRMADO}),0)::float AS ventas
       FROM ec_store s
       LEFT JOIN ec_order o ON o.store_id = s.id AND o.created_at::date BETWEEN $2 AND $3
      WHERE s.company_id=$1 AND s.deleted_at IS NULL AND ($4::uuid IS NULL OR s.id = $4)
      GROUP BY s.id
      ORDER BY ventas DESC NULLS LAST, s.nombre`, params);

  return {
    rango: { desde, hasta },
    periodicidad,
    kpis: {
      ventas,
      pedidos,
      ticketPromedio: pedidos > 0 ? Math.round((ventas / pedidos) * 100) / 100 : 0,
      facturados: Number(k.facturados) || 0,
      pendientes: Number(k.pendientes) || 0,
      ventasPendientes: Number(k.ventas_pendientes) || 0,
      cancelados: Number(k.cancelados) || 0,
      descuentos: Number(k.descuentos) || 0,
      envios: Number(k.envios) || 0,
    },
    serie: serieR.rows.map((r: any) => ({ periodo: r.periodo, pedidos: Number(r.pedidos), ventas: Number(r.ventas) })),
    topProductos: topR.rows.map((r: any) => ({ productId: r.product_id, nombre: r.nombre, unidades: Number(r.unidades), importe: Number(r.importe) })),
    porTienda: tiendaR.rows.map((r: any) => ({ id: r.id, nombre: r.nombre, pedidos: Number(r.pedidos), ventas: Number(r.ventas) })),
  };
}
