/**
 * /purchase-orders — órdenes de cotización y compra (Fase 4, §3 ALMACEN.MD).
 *
 *  Lectura: cualquier usuario de la empresa.
 *  Crear orden manual / analizar / recibir: ADMIN, MANAGER.
 *  Aprobar: ADMIN, MANAGER (la transición APPROVED registra approved_by).
 *  Multi-tenant estricto por company_id del JWT.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, requireCapability } from '../../middleware/authentication';
import { asyncHandler, ValidationError, NotFoundError } from '../../middleware/errorHandler';
import { query, transaction, transactionQuery } from '../../config/database';
import {
  runReorderCheck, changeStatus, receiveOrder, OrderStatus,
} from './purchasing.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

/** GET /purchase-orders — lista con filtros (status, warehouseId) */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const params: any[] = [companyId(req)];
    const filters = ['po.company_id = $1'];
    if (req.query.status) {
      params.push(String(req.query.status));
      filters.push(`po.status = $${params.length}`);
    }
    if (req.query.warehouseId) {
      params.push(String(req.query.warehouseId));
      filters.push(`po.warehouse_id = $${params.length}`);
    }
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '100'), 10)));
    params.push(limit);

    const r = await query<any>(
      `SELECT po.id, po.folio, po.order_type, po.status, po.source,
              po.needed_by_date, po.notes, po.created_by_email, po.approved_at,
              po.created_at,
              w.code AS warehouse_code, w.name AS warehouse_name,
              s.business_name AS supplier_name, s.rfc AS supplier_rfc,
              COUNT(poi.id)::int AS items_count,
              COALESCE(SUM(poi.quantity_ordered * COALESCE(poi.last_purchase_price, 0)), 0) AS estimated_total,
              COALESCE(SUM(poi.quantity_ordered), 0)  AS total_ordered,
              COALESCE(SUM(poi.quantity_received), 0) AS total_received
         FROM purchase_orders po
         JOIN warehouses w ON w.id = po.warehouse_id
         LEFT JOIN customers s ON s.id = po.supplier_id
         LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
        WHERE ${filters.join(' AND ')}
        GROUP BY po.id, w.code, w.name, s.business_name, s.rfc
        ORDER BY po.created_at DESC
        LIMIT $${params.length}`,
      params
    );
    res.json({ success: true, data: { orders: r.rows } });
  })
);

/** GET /purchase-orders/:id — detalle con items */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const po = await query<any>(
      `SELECT po.*, w.code AS warehouse_code, w.name AS warehouse_name,
              s.business_name AS supplier_name, s.rfc AS supplier_rfc
         FROM purchase_orders po
         JOIN warehouses w ON w.id = po.warehouse_id
         LEFT JOIN customers s ON s.id = po.supplier_id
        WHERE po.id = $1 AND po.company_id = $2`,
      [req.params.id, companyId(req)]
    );
    if (po.rows.length === 0) throw new NotFoundError('Orden no encontrada');

    const items = await query<any>(
      `SELECT poi.id, poi.product_id, poi.quantity_suggested, poi.quantity_ordered,
              poi.quantity_received, poi.last_purchase_price,
              p.sku, p.name AS product_name, p.unit_code,
              sp.business_name AS supplier_suggested_name
         FROM purchase_order_items poi
         JOIN products p ON p.id = poi.product_id
         LEFT JOIN customers sp ON sp.id = poi.supplier_suggested_id
        WHERE poi.purchase_order_id = $1
        ORDER BY p.name`,
      [req.params.id]
    );
    res.json({ success: true, data: { order: po.rows[0], items: items.rows } });
  })
);

/** POST /purchase-orders/reorder-check — ejecutar el análisis ahora (§2) */
router.post(
  '/reorder-check',
  requireCapability('purchasing:capture'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await runReorderCheck(companyId(req), {
      userId: req.user?.userId,
      email: req.user?.email,
    });
    res.json({ success: true, data: result });
  })
);

/** POST /purchase-orders — orden manual (§3: "solicitados manualmente") */
router.post(
  '/',
  requireCapability('purchasing:capture'),
  asyncHandler(async (req: Request, res: Response) => {
    const { warehouseId, supplierId, items, notes, neededByDate } = req.body || {};
    if (!warehouseId) throw new ValidationError('warehouseId es obligatorio');
    if (!Array.isArray(items) || items.length === 0) {
      throw new ValidationError('La orden necesita al menos un item {productId, quantity}');
    }

    const result = await transaction(async (client) => {
      const whR = await transactionQuery(
        client,
        `SELECT id FROM warehouses WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [warehouseId, companyId(req)]
      );
      if (whR.rows.length === 0) throw new NotFoundError('Almacén no encontrado');

      const folioR = await transactionQuery<{ next: number }>(
        client,
        `SELECT COALESCE(MAX(folio), 0) + 1 AS next FROM purchase_orders WHERE company_id = $1`,
        [companyId(req)]
      );
      const po = await transactionQuery<any>(
        client,
        `INSERT INTO purchase_orders
           (company_id, folio, order_type, status, source, supplier_id, warehouse_id,
            needed_by_date, notes, created_by, created_by_email)
         VALUES ($1, $2, 'QUOTATION', 'PENDING', 'MANUAL', $3, $4, $5, $6, $7, $8)
         RETURNING id, folio, status`,
        [companyId(req), Number(folioR.rows[0].next), supplierId || null, warehouseId,
         neededByDate || null, notes || null, req.user?.userId, req.user?.email]
      );

      for (const it of items) {
        const qty = Number(it.quantity);
        if (!it.productId || !qty || qty <= 0) {
          throw new ValidationError('Cada item requiere productId y quantity > 0');
        }
        const prodR = await transactionQuery<any>(
          client,
          `SELECT p.id, p.last_cost,
                  (SELECT sp.last_price FROM supplier_products sp
                    WHERE sp.product_id = p.id
                    ORDER BY sp.is_primary DESC, sp.last_purchase_date DESC NULLS LAST
                    LIMIT 1) AS supplier_price
             FROM products p
            WHERE p.id = $1 AND p.company_id = $2 AND p.deleted_at IS NULL`,
          [it.productId, companyId(req)]
        );
        if (prodR.rows.length === 0) throw new NotFoundError(`Producto ${it.productId} no encontrado`);
        const price = prodR.rows[0].supplier_price ?? prodR.rows[0].last_cost ?? null;

        await transactionQuery(
          client,
          `INSERT INTO purchase_order_items
             (purchase_order_id, product_id, quantity_suggested, quantity_ordered, last_purchase_price)
           VALUES ($1, $2, $3, $3, $4)`,
          [po.rows[0].id, it.productId, qty, price]
        );
      }
      return po.rows[0];
    });

    res.status(201).json({ success: true, data: result });
  })
);

/** PUT /purchase-orders/:id/status — transición del ciclo (aprobar, comprar, cancelar) */
router.put(
  '/:id/status',
  requireCapability('purchasing:approve'),
  asyncHandler(async (req: Request, res: Response) => {
    const newStatus = String(req.body?.status || '').toUpperCase() as OrderStatus;
    if (!newStatus) throw new ValidationError('status es obligatorio');
    const result = await changeStatus(companyId(req), req.params.id, newStatus, {
      userId: req.user?.userId,
      email: req.user?.email,
    });
    res.json({ success: true, data: result });
  })
);

/** POST /purchase-orders/:id/receive — recepción parcial o total (§14) */
router.post(
  '/:id/receive',
  requireCapability('purchasing:capture'),
  asyncHandler(async (req: Request, res: Response) => {
    const receipts = req.body?.receipts;
    const costingMethod = req.body?.costingMethod;
    const result = await receiveOrder(companyId(req), req.params.id, receipts, {
      userId: req.user?.userId,
      email: req.user?.email,
    }, costingMethod);
    res.json({ success: true, data: result });
  })
);

export default router;
