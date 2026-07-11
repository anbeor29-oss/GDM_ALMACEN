/**
 * Purchasing Service — órdenes de cotización/compra (Fase 4, §2 §3 ALMACEN.MD).
 *
 *  · runReorderCheck(): el análisis — detecta productos bajo mínimo o que
 *    llegarán al mínimo en ≤15 días (vista v_projected_stockout_15d) y genera
 *    UNA orden de cotización por almacén con cantidad y proveedor sugeridos.
 *    Anti-duplicado: un producto con orden ABIERTA no se vuelve a proponer.
 *  · receiveOrder(): recepción parcial o total → PURCHASE_IN vía
 *    applyMovementTx (regla de oro #4) referenciando la orden.
 *  · Transiciones de estado validadas; aprobar exige ADMIN/MANAGER (la ruta).
 */

import { PoolClient } from 'pg';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError, ConflictError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import { applyMovementTx } from '../inventory/inventory.service';

export type OrderStatus =
  | 'PENDING' | 'QUOTED' | 'APPROVED' | 'PURCHASED'
  | 'RECEIVED_PARTIAL' | 'RECEIVED' | 'CANCELLED';

/** Estados que cuentan como "orden abierta" para el anti-duplicado. */
const OPEN_STATUSES = ['PENDING', 'QUOTED', 'APPROVED', 'PURCHASED', 'RECEIVED_PARTIAL'];

/** Transiciones válidas del ciclo (§3). */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING:          ['QUOTED', 'APPROVED', 'CANCELLED'],
  QUOTED:           ['APPROVED', 'CANCELLED'],
  APPROVED:         ['PURCHASED', 'CANCELLED'],
  PURCHASED:        ['RECEIVED_PARTIAL', 'RECEIVED', 'CANCELLED'],
  RECEIVED_PARTIAL: ['RECEIVED', 'CANCELLED'],
  RECEIVED:         [],
  CANCELLED:        [],
};

async function nextFolio(client: PoolClient, companyId: string): Promise<number> {
  const r = await transactionQuery<{ next: number }>(
    client,
    `SELECT COALESCE(MAX(folio), 0) + 1 AS next FROM purchase_orders WHERE company_id = $1`,
    [companyId]
  );
  return Number(r.rows[0].next);
}

/* ─────────────────────  ANÁLISIS AUTOMÁTICO (§2)  ───────────────────── */

export interface ReorderResult {
  ordersCreated: Array<{
    orderId: string; folio: number; warehouseCode: string; items: number;
  }>;
  candidates: number;
  skippedWithOpenOrder: number;
}

/**
 * Analiza el inventario de UNA empresa y genera órdenes de cotización AUTO.
 * Una orden por almacén, con todos sus productos candidatos.
 */
export async function runReorderCheck(
  companyId: string,
  user?: { userId?: string; email?: string }
): Promise<ReorderResult> {
  return transaction(async (client) => {
    const candR = await transactionQuery<any>(
      client,
      `SELECT v.*, sp.supplier_id AS suggested_supplier_id, sp.last_price
         FROM v_projected_stockout_15d v
         LEFT JOIN LATERAL (
           SELECT supplier_id, last_price
             FROM supplier_products sp
            WHERE sp.product_id = v.product_id
            ORDER BY sp.is_primary DESC, sp.last_purchase_date DESC NULLS LAST
            LIMIT 1
         ) sp ON true
        WHERE v.company_id = $1 AND v.reorder_needed = true AND v.suggested_qty > 0`,
      [companyId]
    );

    let skipped = 0;
    const byWarehouse = new Map<string, any[]>();

    for (const c of candR.rows) {
      // Anti-duplicado: ¿ya hay una orden abierta con este producto en este almacén?
      const open = await transactionQuery(
        client,
        `SELECT 1
           FROM purchase_order_items poi
           JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE po.company_id = $1 AND po.warehouse_id = $2
            AND poi.product_id = $3 AND po.status = ANY($4)
          LIMIT 1`,
        [companyId, c.warehouse_id, c.product_id, OPEN_STATUSES]
      );
      if (open.rows.length > 0) { skipped++; continue; }

      if (!byWarehouse.has(c.warehouse_id)) byWarehouse.set(c.warehouse_id, []);
      byWarehouse.get(c.warehouse_id)!.push(c);
    }

    const ordersCreated: ReorderResult['ordersCreated'] = [];
    for (const [warehouseId, items] of byWarehouse) {
      const folio = await nextFolio(client, companyId);
      // Proveedor de la orden: el sugerido más frecuente entre los items
      const supplierCounts = new Map<string, number>();
      for (const it of items) {
        if (it.suggested_supplier_id) {
          supplierCounts.set(it.suggested_supplier_id,
            (supplierCounts.get(it.suggested_supplier_id) || 0) + 1);
        }
      }
      const topSupplier = [...supplierCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      const po = await transactionQuery<{ id: string }>(
        client,
        `INSERT INTO purchase_orders
           (company_id, folio, order_type, status, source, supplier_id, warehouse_id,
            needed_by_date, notes, created_by, created_by_email)
         VALUES ($1, $2, 'QUOTATION', 'PENDING', 'AUTO', $3, $4,
                 (NOW() + INTERVAL '15 days')::date,
                 'Generada por análisis de mínimos y proyección a 15 días', $5, $6)
         RETURNING id`,
        [companyId, folio, topSupplier, warehouseId,
         user?.userId || null, user?.email || 'reorder@system']
      );
      const orderId = po.rows[0].id;

      for (const it of items) {
        await transactionQuery(
          client,
          `INSERT INTO purchase_order_items
             (purchase_order_id, product_id, quantity_suggested, quantity_ordered,
              last_purchase_price, supplier_suggested_id)
           VALUES ($1, $2, $3, $3, $4, $5)`,
          [orderId, it.product_id, it.suggested_qty,
           it.last_price ?? null, it.suggested_supplier_id ?? null]
        );
      }

      ordersCreated.push({
        orderId, folio,
        warehouseCode: items[0].warehouse_code,
        items: items.length,
      });
    }

    return { ordersCreated, candidates: candR.rows.length, skippedWithOpenOrder: skipped };
  });
}

/** Análisis de TODAS las empresas activas + alerta por correo (cron diario). */
export async function runReorderCheckAllCompanies(): Promise<void> {
  const companies = await query<{ id: string; business_name: string; contact_email: string | null; email: string | null }>(
    `SELECT id, business_name, contact_email, email FROM companies
      WHERE deleted_at IS NULL AND is_active = true`
  );
  for (const c of companies.rows) {
    try {
      const r = await runReorderCheck(c.id);
      if (r.ordersCreated.length > 0) {
        logger.info(
          `[reorder] ${c.business_name}: ${r.ordersCreated.length} orden(es) de cotización generadas ` +
          `(${r.candidates} candidatos, ${r.skippedWithOpenOrder} ya con orden abierta)`
        );
        // Alerta por correo — best effort (§2: alerta preventiva)
        const to = c.contact_email || c.email;
        if (to) {
          try {
            const { sendPlainMail } = await import('../mailer/mailer.service');
            const lines = r.ordersCreated
              .map((o) => `· Orden de cotización #${o.folio} — almacén ${o.warehouseCode} — ${o.items} producto(s)`)
              .join('\n');
            await sendPlainMail({
              companyId: c.id,
              to,
              subject: `GDM ALMACÉN · ${r.ordersCreated.length} orden(es) de cotización por inventario bajo`,
              message:
                `El análisis diario detectó productos en o por debajo del mínimo ` +
                `(o que llegarán al mínimo en 15 días) y generó:\n\n${lines}\n\n` +
                `Revísalas en el módulo Órdenes de compra para cotizar y aprobar.`,
            });
          } catch (e) {
            logger.warn(`[reorder] Alerta email a ${to} falló: ${(e as Error).message}`);
          }
        }
      }
    } catch (e) {
      logger.error(`[reorder] Empresa ${c.id} falló: ${(e as Error).message}`);
    }
  }
}

/* ─────────────────────  CICLO DE ESTADOS (§3)  ───────────────────── */

export async function changeStatus(
  companyId: string,
  orderId: string,
  newStatus: OrderStatus,
  user: { userId?: string; email?: string }
): Promise<any> {
  return transaction(async (client) => {
    const r = await transactionQuery<any>(
      client,
      `SELECT id, status FROM purchase_orders
        WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [orderId, companyId]
    );
    if (r.rows.length === 0) throw new NotFoundError('Orden no encontrada');
    const current = r.rows[0].status as OrderStatus;

    if (!TRANSITIONS[current]?.includes(newStatus)) {
      throw new ConflictError(`Transición inválida: ${current} → ${newStatus}`);
    }
    // La recepción va por receiveOrder(), no por cambio de estado directo
    if (newStatus === 'RECEIVED' || newStatus === 'RECEIVED_PARTIAL') {
      throw new ValidationError('Usa el endpoint de recepción para registrar mercancía recibida');
    }

    const upd = await transactionQuery<any>(
      client,
      `UPDATE purchase_orders SET
          status = $1::varchar,
          order_type = CASE WHEN $1::varchar = 'APPROVED' THEN 'PURCHASE' ELSE order_type END,
          approved_by = CASE WHEN $1::varchar = 'APPROVED' THEN $2::uuid ELSE approved_by END,
          approved_at = CASE WHEN $1::varchar = 'APPROVED' THEN NOW() ELSE approved_at END
        WHERE id = $3
        RETURNING id, folio, status, order_type`,
      [newStatus, user.userId || null, orderId]
    );
    return upd.rows[0];
  });
}

/* ─────────────────────  RECEPCIÓN (§14 parcial)  ───────────────────── */

export async function receiveOrder(
  companyId: string,
  orderId: string,
  receipts: Array<{ itemId: string; quantity: number; unitCost?: number }>,
  user: { userId?: string; email?: string },
  /** Política de costos para esta recepción (pregunta al operador). */
  costingMethod?: 'PROMEDIO' | 'ULTIMO' | 'CAPAS'
): Promise<any> {
  if (!receipts?.length) throw new ValidationError('Indica qué items y cantidades recibes');

  return transaction(async (client) => {
    const poR = await transactionQuery<any>(
      client,
      `SELECT id, folio, status, warehouse_id FROM purchase_orders
        WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [orderId, companyId]
    );
    if (poR.rows.length === 0) throw new NotFoundError('Orden no encontrada');
    const po = poR.rows[0];
    if (!['PURCHASED', 'RECEIVED_PARTIAL', 'APPROVED'].includes(po.status)) {
      throw new ConflictError(
        `Solo se recibe mercancía de órdenes aprobadas/compradas (estado actual: ${po.status})`
      );
    }

    let received = 0;
    for (const rec of receipts) {
      const qty = Number(rec.quantity);
      if (!qty || qty <= 0) continue;

      const itR = await transactionQuery<any>(
        client,
        `SELECT id, product_id, quantity_ordered, quantity_received, last_purchase_price
           FROM purchase_order_items
          WHERE id = $1 AND purchase_order_id = $2 FOR UPDATE`,
        [rec.itemId, orderId]
      );
      if (itR.rows.length === 0) throw new NotFoundError(`Item ${rec.itemId} no es de esta orden`);
      const it = itR.rows[0];

      const pending = Number(it.quantity_ordered) - Number(it.quantity_received);
      if (qty > pending) {
        throw new ConflictError(
          `Recepción excede lo pendiente (pendiente ${pending}, recibiendo ${qty})`
        );
      }

      const unitCost = rec.unitCost != null ? Number(rec.unitCost)
                     : (it.last_purchase_price != null ? Number(it.last_purchase_price) : 0);

      await applyMovementTx(client, {
        companyId,
        productId: it.product_id,
        movementType: 'PURCHASE_IN',
        quantity: qty,
        unitCost,
        warehouseToId: po.warehouse_id,
        referenceType: 'purchase_order',
        referenceId: orderId,
        reason: `Recepción orden de compra #${po.folio}`,
        userId: user.userId,
        userEmail: user.email,
        costingMethod,
      });

      await transactionQuery(
        client,
        `UPDATE purchase_order_items SET quantity_received = quantity_received + $1 WHERE id = $2`,
        [qty, rec.itemId]
      );
      received++;
    }
    if (received === 0) throw new ValidationError('Ninguna cantidad válida para recibir');

    // ¿Quedó completa?
    const pendR = await transactionQuery<{ pending: number }>(
      client,
      `SELECT COALESCE(SUM(quantity_ordered - quantity_received), 0) AS pending
         FROM purchase_order_items WHERE purchase_order_id = $1`,
      [orderId]
    );
    const stillPending = Number(pendR.rows[0].pending) > 0.000001;
    const newStatus = stillPending ? 'RECEIVED_PARTIAL' : 'RECEIVED';

    const upd = await transactionQuery<any>(
      client,
      `UPDATE purchase_orders SET status = $1 WHERE id = $2 RETURNING id, folio, status`,
      [newStatus, orderId]
    );
    return { ...upd.rows[0], itemsReceived: received, stillPending };
  });
}
