/**
 * /inventory — existencias, kardex, ajustes y traspasos (Fase 1 ALMACEN).
 *
 *  Seguridad: authenticateToken + filtro estricto por company_id del JWT.
 *  Escrituras (ajustes, traspasos, mín/máx): solo ADMIN y MANAGER (§8).
 *  Toda mutación de stock pasa por inventory.service.applyMovement().
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, authorize } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import { applyMovement, transferStock, MovementType } from './inventory.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

/**
 * GET /inventory/stock — existencias por almacén con semáforo.
 * Filtros: warehouseId, search (sku/nombre/código de barras), semaforo, belowMin.
 */
router.get(
  '/stock',
  asyncHandler(async (req: Request, res: Response) => {
    const params: any[] = [companyId(req)];
    const filters = ['w.company_id = $1', 'w.deleted_at IS NULL', 'p.deleted_at IS NULL'];

    if (req.query.warehouseId) {
      params.push(String(req.query.warehouseId));
      filters.push(`w.id = $${params.length}`);
    }
    const search = String(req.query.search || '').trim();
    if (search) {
      params.push(`%${search}%`);
      filters.push(`(p.sku ILIKE $${params.length} OR p.name ILIKE $${params.length} OR p.barcode ILIKE $${params.length})`);
    }
    if (req.query.belowMin === 'true') {
      filters.push('ws.quantity <= ws.stock_minimum AND ws.stock_minimum > 0');
    }

    const limit  = Math.min(500, Math.max(1, parseInt(String(req.query.limit  || '100'), 10)));
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10));
    params.push(limit, offset);

    const r = await query<any>(
      `SELECT ws.id, ws.quantity, ws.stock_minimum, ws.stock_maximum, ws.avg_cost,
              ws.quantity * ws.avg_cost AS stock_value,
              ws.updated_at,
              p.id  AS product_id, p.sku, p.name AS product_name, p.category,
              p.unit_code, p.barcode,
              w.id  AS warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
              CASE
                WHEN ws.quantity <= 0                      THEN 'AGOTADO'
                WHEN ws.stock_minimum > 0 AND ws.quantity <= ws.stock_minimum       THEN 'CRITICO'
                WHEN ws.stock_minimum > 0 AND ws.quantity <= ws.stock_minimum * 1.2 THEN 'PREVENTIVO'
                ELSE 'SUFICIENTE'
              END AS semaforo
         FROM warehouse_stock ws
         JOIN warehouses w ON w.id = ws.warehouse_id
         JOIN products  p ON p.id = ws.product_id
        WHERE ${filters.join(' AND ')}
        ORDER BY p.name ASC, w.code ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const totalR = await query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM warehouse_stock ws
         JOIN warehouses w ON w.id = ws.warehouse_id
         JOIN products  p ON p.id = ws.product_id
        WHERE ${filters.join(' AND ')}`,
      params.slice(0, -2)
    );

    res.json({
      success: true,
      data: { stock: r.rows, total: Number(totalR.rows[0].total) },
    });
  })
);

/**
 * GET /inventory/kardex — bitácora de movimientos (§10).
 * Filtros: productId, warehouseId, type, from, to.
 */
router.get(
  '/kardex',
  asyncHandler(async (req: Request, res: Response) => {
    const params: any[] = [companyId(req)];
    const filters = ['m.company_id = $1'];

    if (req.query.productId) {
      params.push(String(req.query.productId));
      filters.push(`m.product_id = $${params.length}`);
    }
    if (req.query.warehouseId) {
      params.push(String(req.query.warehouseId));
      filters.push(`(m.warehouse_from_id = $${params.length} OR m.warehouse_to_id = $${params.length})`);
    }
    if (req.query.type) {
      params.push(String(req.query.type));
      filters.push(`m.movement_type = $${params.length}`);
    }
    if (req.query.from) {
      params.push(String(req.query.from));
      filters.push(`m.created_at >= $${params.length}::timestamp`);
    }
    if (req.query.to) {
      params.push(String(req.query.to));
      filters.push(`m.created_at < ($${params.length}::timestamp + INTERVAL '1 day')`);
    }

    const limit  = Math.min(500, Math.max(1, parseInt(String(req.query.limit  || '100'), 10)));
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10));
    params.push(limit, offset);

    const r = await query<any>(
      `SELECT m.id, m.movement_type, m.quantity, m.unit_cost, m.reference_type,
              m.reference_id, m.transfer_group, m.reason, m.user_email, m.created_at,
              p.sku, p.name AS product_name,
              wf.code AS warehouse_from_code, wf.name AS warehouse_from_name,
              wt.code AS warehouse_to_code,   wt.name AS warehouse_to_name
         FROM inventory_movements m
         JOIN products p ON p.id = m.product_id
         LEFT JOIN warehouses wf ON wf.id = m.warehouse_from_id
         LEFT JOIN warehouses wt ON wt.id = m.warehouse_to_id
        WHERE ${filters.join(' AND ')}
        ORDER BY m.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const totalR = await query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM inventory_movements m
        WHERE ${filters.join(' AND ')}`,
      params.slice(0, -2)
    );

    res.json({
      success: true,
      data: { movements: r.rows, total: Number(totalR.rows[0].total) },
    });
  })
);

/**
 * POST /inventory/adjust — ajuste manual autorizado (§7, §10).
 * Solo ADMIN/MANAGER. Motivo obligatorio.
 * body: { productId, warehouseId, direction: 'IN'|'OUT', quantity,
 *         unitCost?, reason, movementType? (SHRINKAGE|THEFT|DAMAGED para bajas tipificadas) }
 */
router.post(
  '/adjust',
  authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const { productId, warehouseId, direction, quantity, unitCost, reason } = req.body || {};
    if (!productId || !warehouseId) throw new ValidationError('productId y warehouseId son obligatorios');
    if (!reason?.trim()) throw new ValidationError('El motivo del ajuste es obligatorio');

    let movementType: MovementType;
    const typed = String(req.body.movementType || '').toUpperCase();
    if (['SHRINKAGE', 'THEFT', 'DAMAGED'].includes(typed)) {
      movementType = typed as MovementType;         // bajas tipificadas (§10)
    } else if (direction === 'IN') {
      movementType = 'ADJUSTMENT_IN';
    } else if (direction === 'OUT') {
      movementType = 'ADJUSTMENT_OUT';
    } else {
      throw new ValidationError("direction debe ser 'IN' u 'OUT' (o movementType tipificado)");
    }

    const result = await applyMovement({
      companyId: companyId(req),
      productId,
      movementType,
      quantity: Number(quantity),
      unitCost: unitCost != null ? Number(unitCost) : undefined,
      warehouseFromId: movementType === 'ADJUSTMENT_IN' ? undefined : warehouseId,
      warehouseToId:   movementType === 'ADJUSTMENT_IN' ? warehouseId : undefined,
      referenceType: 'manual_adjustment',
      reason: String(reason).trim(),
      userId: req.user?.userId,
      userEmail: req.user?.email,
    });

    res.json({ success: true, data: result });
  })
);

/**
 * POST /inventory/transfer — traspaso atómico entre almacenes (§7).
 * body: { productId, warehouseFromId, warehouseToId, quantity, reason? }
 */
router.post(
  '/transfer',
  authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const { productId, warehouseFromId, warehouseToId, quantity, reason } = req.body || {};
    if (!productId || !warehouseFromId || !warehouseToId) {
      throw new ValidationError('productId, warehouseFromId y warehouseToId son obligatorios');
    }

    const result = await transferStock({
      companyId: companyId(req),
      productId,
      warehouseFromId,
      warehouseToId,
      quantity: Number(quantity),
      reason: reason ? String(reason).trim() : undefined,
      userId: req.user?.userId,
      userEmail: req.user?.email,
    });

    res.json({ success: true, data: result });
  })
);

/**
 * PUT /inventory/stock-limits — mín/máx por producto y almacén (§2).
 * body: { productId, warehouseId, stockMinimum, stockMaximum }
 */
router.put(
  '/stock-limits',
  authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const { productId, warehouseId } = req.body || {};
    const stockMinimum = Number(req.body?.stockMinimum ?? 0);
    const stockMaximum = Number(req.body?.stockMaximum ?? 0);
    if (!productId || !warehouseId) throw new ValidationError('productId y warehouseId son obligatorios');
    if (stockMinimum < 0 || stockMaximum < 0) throw new ValidationError('Mínimo y máximo no pueden ser negativos');
    if (stockMaximum > 0 && stockMaximum < stockMinimum) {
      throw new ValidationError('El máximo no puede ser menor que el mínimo');
    }

    // Verifica pertenencia multi-tenant vía JOIN con warehouses
    const r = await query(
      `INSERT INTO warehouse_stock (warehouse_id, product_id, stock_minimum, stock_maximum)
       SELECT w.id, p.id, $3, $4
         FROM warehouses w
         JOIN products p ON p.company_id = w.company_id
        WHERE w.id = $1 AND p.id = $2 AND w.company_id = $5
          AND w.deleted_at IS NULL AND p.deleted_at IS NULL
       ON CONFLICT (warehouse_id, product_id)
       DO UPDATE SET stock_minimum = $3, stock_maximum = $4, updated_at = NOW()
       RETURNING id`,
      [warehouseId, productId, stockMinimum, stockMaximum, companyId(req)]
    );
    if (r.rowCount === 0) throw new ValidationError('Producto o almacén no encontrado en esta empresa');

    res.json({ success: true, data: { stockMinimum, stockMaximum } });
  })
);

export default router;
