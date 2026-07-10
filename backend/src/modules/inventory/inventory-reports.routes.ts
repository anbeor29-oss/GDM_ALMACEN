/**
 * /inventory/reports — valuación, histórico mensual, rotación y exigencias
 * de conteo físico (§12 + dashboard).
 *
 *  Lectura para cualquier usuario de la empresa; snapshot manual solo
 *  ADMIN/MANAGER. Multi-tenant estricto por company_id del JWT.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, authorize } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import {
  takeSnapshot, getCurrentValue, getValueHistory,
} from './inventory-reports.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

/** GET /inventory/reports/value — valuación actual (consolidado + por almacén) */
router.get(
  '/value',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await getCurrentValue(companyId(req));
    res.json({ success: true, data });
  })
);

/** GET /inventory/reports/value-history?months=12&warehouseId= — snapshots mes a mes */
router.get(
  '/value-history',
  asyncHandler(async (req: Request, res: Response) => {
    const months = Math.min(60, Math.max(1, parseInt(String(req.query.months || '12'), 10)));
    const warehouseId = req.query.warehouseId ? String(req.query.warehouseId) : undefined;
    const history = await getValueHistory(companyId(req), months, warehouseId);
    res.json({ success: true, data: { history } });
  })
);

/** POST /inventory/reports/snapshot — congelar el mes en curso manualmente */
router.post(
  '/snapshot',
  authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await takeSnapshot(companyId(req), { source: 'MANUAL' });
    res.json({ success: true, data: result });
  })
);

/** GET /inventory/reports/rotation?order=rotation|no-movement — rotación de productos */
router.get(
  '/rotation',
  asyncHandler(async (req: Request, res: Response) => {
    const order = String(req.query.order || 'rotation');
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '100'), 10)));

    const orderBy = order === 'no-movement'
      ? 'days_without_movement DESC NULLS FIRST, total_value DESC'
      : 'rotation_30d DESC NULLS LAST, qty_out_30 DESC';

    const r = await query<any>(
      `SELECT product_id, sku, name, category, total_qty, total_value,
              qty_out_30, qty_out_90, rotation_30d, days_of_stock,
              last_movement_at, days_without_movement
         FROM v_inventory_rotation
        WHERE company_id = $1
        ORDER BY ${orderBy}
        LIMIT $2`,
      [companyId(req), limit]
    );
    res.json({ success: true, data: { rotation: r.rows } });
  })
);

/** GET /inventory/reports/count-due — exigencias de inventario físico */
router.get(
  '/count-due',
  asyncHandler(async (req: Request, res: Response) => {
    const onlyDue = req.query.all !== 'true';
    const r = await query<any>(
      `SELECT warehouse_id, warehouse_code, warehouse_name,
              product_id, sku, product_name, quantity, stock_value,
              last_verified_at, days_since_verification, count_status
         FROM v_count_required
        WHERE company_id = $1
          ${onlyDue ? `AND count_status != 'AL_DIA'` : ''}
        ORDER BY CASE count_status
                   WHEN 'NUNCA_VERIFICADO' THEN 0
                   WHEN 'CONTEO_URGENTE'   THEN 1
                   WHEN 'CONTEO_SUGERIDO'  THEN 2
                   ELSE 3
                 END,
                 stock_value DESC
        LIMIT 500`,
      [companyId(req)]
    );

    const summary = { urgente: 0, sugerido: 0, nunca: 0, alDia: 0 };
    const allR = await query<any>(
      `SELECT count_status, COUNT(*)::int AS n FROM v_count_required
        WHERE company_id = $1 GROUP BY count_status`,
      [companyId(req)]
    );
    for (const row of allR.rows) {
      if (row.count_status === 'CONTEO_URGENTE') summary.urgente = row.n;
      else if (row.count_status === 'CONTEO_SUGERIDO') summary.sugerido = row.n;
      else if (row.count_status === 'NUNCA_VERIFICADO') summary.nunca = row.n;
      else summary.alDia = row.n;
    }

    res.json({ success: true, data: { items: r.rows, summary } });
  })
);

export default router;
