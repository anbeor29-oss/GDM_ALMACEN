/**
 * /pos — punto de venta y cierre del día (Fase 5 ALMACEN).
 *
 *  Vender: cualquier usuario de la empresa (incluye rol USER — cajeros).
 *  Cancelar venta y cerrar el día: ADMIN/MANAGER.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, authorize } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import { createSale, cancelSale, closeDay, todayMx } from './pos.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

/** POST /pos/sales — cobrar una venta (descuenta inventario al momento) */
router.post(
  '/sales',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await createSale(companyId(req), req.body, {
      userId: req.user?.userId,
      email: req.user?.email,
    });
    res.status(201).json({ success: true, data: result });
  })
);

/** GET /pos/sales?date=YYYY-MM-DD — ventas del día con partidas */
router.get(
  '/sales',
  asyncHandler(async (req: Request, res: Response) => {
    // Regla #7: "hoy" en horario México, no UTC del servidor
    const day = String(req.query.date || todayMx());
    const r = await query<any>(
      `SELECT s.id, s.folio, s.status, s.payment_form, s.subtotal, s.tax, s.total,
              s.sold_at, s.user_email, s.global_invoice_id,
              w.code AS warehouse_code,
              COUNT(i.id)::int AS items_count,
              COALESCE(SUM(i.quantity), 0) AS units
         FROM pos_sales s
         JOIN warehouses w ON w.id = s.warehouse_id
         LEFT JOIN pos_sale_items i ON i.pos_sale_id = s.id
        WHERE s.company_id = $1 AND s.sold_at::date = $2::date
        GROUP BY s.id, w.code
        ORDER BY s.folio DESC`,
      [companyId(req), day]
    );

    const summary = {
      date: day,
      sales: r.rows.filter((s: any) => s.status !== 'CANCELLED').length,
      cancelled: r.rows.filter((s: any) => s.status === 'CANCELLED').length,
      open: r.rows.filter((s: any) => s.status === 'OPEN').length,
      total: r.rows
        .filter((s: any) => s.status !== 'CANCELLED')
        .reduce((a: number, s: any) => a + Number(s.total), 0),
    };
    res.json({ success: true, data: { sales: r.rows, summary } });
  })
);

/** POST /pos/sales/:id/cancel — cancelar (devuelve el stock descontado) */
router.post(
  '/sales/:id/cancel',
  authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await cancelSale(companyId(req), req.params.id, {
      userId: req.user?.userId,
      email: req.user?.email,
    });
    res.json({ success: true, data: result });
  })
);

/** POST /pos/close-day — factura global de las ventas OPEN del día (§ conclusión) */
router.post(
  '/close-day',
  authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await closeDay(companyId(req), req.body?.date, {
      userId: req.user?.userId,
      email: req.user?.email,
    });
    res.json({ success: true, data: result });
  })
);

export default router;
