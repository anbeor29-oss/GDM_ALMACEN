/**
 * fx-difference.routes — utilidad y pérdida cambiaria.
 *
 *   GET /fx-difference?desde=&hasta=&moneda=  → detalle + totales
 *   GET /fx-difference/por-factura/:invoiceId → los pagos de una factura
 *
 * De dónde sale el número
 * -----------------------
 * Se factura 1 000 USD el lunes a 17.50 → esos dólares "valían" 17 500 pesos.
 * Cobran 15 días después y el dólar está a 18.00 → entran 18 000 pesos.
 * Llegaron los mismos 1 000 USD, pero 500 pesos más: eso es la utilidad
 * cambiaria.
 *
 * En un pago parcial se compara SOLO la porción cobrada, no la factura
 * completa: si de esos 1 000 USD cobran 400, la diferencia se calcula sobre
 * 400, porque los otros 600 todavía no se han valuado.
 *
 * La cuenta vive en la vista v_diferencia_cambiaria para que el reporte, la
 * pantalla de factura y cualquier consulta futura den el mismo resultado.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import { pool } from '../../config/database';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID requerido');
  return req.user.companyId;
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const cid = companyId(req);
  const desde = String(req.query.desde || '');
  const hasta = String(req.query.hasta || '');
  const moneda = req.query.moneda ? String(req.query.moneda).toUpperCase() : null;

  if (desde && !FECHA_RE.test(desde)) throw new ValidationError('desde debe ser AAAA-MM-DD');
  if (hasta && !FECHA_RE.test(hasta)) throw new ValidationError('hasta debe ser AAAA-MM-DD');

  const params: any[] = [cid];
  let filtro = 'company_id = $1';
  if (desde) { params.push(desde); filtro += ` AND payment_date >= $${params.length}`; }
  if (hasta) { params.push(hasta); filtro += ` AND payment_date < ($${params.length}::date + 1)`; }
  if (moneda) { params.push(moneda); filtro += ` AND moneda = $${params.length}`; }

  const detalle = await pool.query(
    `SELECT * FROM v_diferencia_cambiaria
      WHERE ${filtro}
      ORDER BY payment_date DESC, folio DESC
      LIMIT 1000`,
    params,
  );

  // Los totales se sacan del mismo filtro y no sumando el detalle, para que
  // el LIMIT no altere el resultado del cierre contable.
  const totales = await pool.query(
    `SELECT
       moneda,
       count(*)                                   AS pagos,
       SUM(equivalente_al_facturar)               AS "totalFacturado",
       SUM(equivalente_al_cobrar)                 AS "totalCobrado",
       SUM(diferencia_mxn)                        AS "diferencia",
       SUM(diferencia_mxn) FILTER (WHERE diferencia_mxn > 0) AS "utilidad",
       SUM(diferencia_mxn) FILTER (WHERE diferencia_mxn < 0) AS "perdida"
     FROM v_diferencia_cambiaria
     WHERE ${filtro}
     GROUP BY moneda
     ORDER BY moneda`,
    params,
  );

  const global = totales.rows.reduce(
    (a, r) => ({
      diferencia: a.diferencia + Number(r.diferencia || 0),
      utilidad:   a.utilidad   + Number(r.utilidad   || 0),
      perdida:    a.perdida    + Number(r.perdida    || 0),
    }),
    { diferencia: 0, utilidad: 0, perdida: 0 },
  );

  res.json({
    periodo: { desde: desde || null, hasta: hasta || null, moneda },
    detalle: detalle.rows,
    porMoneda: totales.rows,
    global,
  });
}));

router.get('/por-factura/:invoiceId', asyncHandler(async (req: Request, res: Response) => {
  const r = await pool.query(
    `SELECT * FROM v_diferencia_cambiaria
      WHERE company_id = $1 AND invoice_id = $2
      ORDER BY payment_date`,
    [companyId(req), req.params.invoiceId],
  );
  const diferencia = r.rows.reduce((a, x) => a + Number(x.diferencia_mxn || 0), 0);
  res.json({ items: r.rows, diferenciaAcumulada: Math.round(diferencia * 100) / 100 });
}));

export default router;
