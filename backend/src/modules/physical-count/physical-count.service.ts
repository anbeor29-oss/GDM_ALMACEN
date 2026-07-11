/**
 * Physical Count Service — inventario físico y conciliación (Fase 6, §11).
 *
 *  Flujo:
 *   1. openCount(): congela la existencia del sistema (system_qty) de los
 *      productos del almacén (o de una categoría) en un conteo ABIERTO.
 *   2. captureItems(): captura la existencia física contada (counted_qty).
 *   3. closeCount(): con autorización, ajusta el stock ACTUAL para que quede
 *      igual a lo contado — vía applyMovementTx (ADJUSTMENT_IN/OUT, referencia
 *      physical_count), registrando el movimiento en cada item. El reporte de
 *      diferencias usa system_qty (congelado al abrir) vs counted_qty.
 *
 *  Nota: el ajuste se calcula contra el stock ACTUAL al cerrar (no contra el
 *  congelado), porque entre abrir y cerrar pudo haber ventas/compras. Así el
 *  resultado final SIEMPRE queda en lo que se contó físicamente.
 */

import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError, ConflictError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import { applyMovementTx } from '../inventory/inventory.service';

/** Abre un conteo para un almacén; congela system_qty. */
export async function openCount(
  companyId: string,
  data: { warehouseId: string; category?: string; notes?: string },
  user: { userId?: string; email?: string }
): Promise<any> {
  if (!data.warehouseId) throw new ValidationError('warehouseId es obligatorio');

  return transaction(async (client) => {
    const wh = await transactionQuery(
      client,
      `SELECT id FROM warehouses WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [data.warehouseId, companyId]
    );
    if (wh.rows.length === 0) throw new NotFoundError('Almacén no encontrado');

    const folioR = await transactionQuery<{ next: number }>(
      client,
      `SELECT COALESCE(MAX(folio), 0) + 1 AS next FROM physical_counts WHERE company_id = $1`,
      [companyId]
    );

    let count;
    try {
      count = await transactionQuery<any>(
        client,
        `INSERT INTO physical_counts
           (company_id, warehouse_id, folio, category, notes, created_by, created_by_email)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, folio, status, category, started_at`,
        [companyId, data.warehouseId, Number(folioR.rows[0].next),
         data.category || null, data.notes || null, user.userId || null, user.email || null]
      );
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new ConflictError('Ya hay un conteo abierto para este almacén — ciérralo o cancélalo primero');
      }
      throw e;
    }
    const countId = count.rows[0].id;

    // Congelar la existencia del sistema para los productos con renglón de stock
    const params: any[] = [countId, data.warehouseId];
    let catFilter = '';
    if (data.category) {
      params.push(data.category);
      catFilter = `AND p.category = $3`;
    }
    const inserted = await transactionQuery<{ n: string }>(
      client,
      `WITH ins AS (
         INSERT INTO physical_count_items (physical_count_id, product_id, system_qty, avg_cost)
         SELECT $1, ws.product_id, ws.quantity, ws.avg_cost
           FROM warehouse_stock ws
           JOIN products p ON p.id = ws.product_id AND p.deleted_at IS NULL
          WHERE ws.warehouse_id = $2 ${catFilter}
         RETURNING id
       )
       SELECT COUNT(*)::text AS n FROM ins`,
      params
    );

    return { ...count.rows[0], products: Number(inserted.rows[0].n) };
  });
}

/** Captura cantidades físicas contadas. */
export async function captureItems(
  companyId: string,
  countId: string,
  items: Array<{ itemId: string; countedQty: number }>
): Promise<{ updated: number }> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError('Envía al menos un item con su cantidad contada');
  }
  return transaction(async (client) => {
    const c = await transactionQuery<any>(
      client,
      `SELECT id, status FROM physical_counts WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [countId, companyId]
    );
    if (c.rows.length === 0) throw new NotFoundError('Conteo no encontrado');
    if (c.rows[0].status !== 'OPEN') throw new ConflictError('El conteo ya no está abierto');

    let updated = 0;
    for (const it of items) {
      const qty = Number(it.countedQty);
      if (qty < 0) throw new ValidationError('La cantidad contada no puede ser negativa');
      const r = await transactionQuery(
        client,
        `UPDATE physical_count_items SET counted_qty = $1
          WHERE id = $2 AND physical_count_id = $3`,
        [qty, it.itemId, countId]
      );
      updated += r.rowCount;
    }
    return { updated };
  });
}

/**
 * Cierra el conteo con autorización → ajusta el stock actual a lo contado.
 * Los items no contados (counted_qty NULL) se ignoran (no se tocan).
 */
export async function closeCount(
  companyId: string,
  countId: string,
  user: { userId?: string; email?: string }
): Promise<any> {
  return transaction(async (client) => {
    const c = await transactionQuery<any>(
      client,
      `SELECT id, folio, warehouse_id, status FROM physical_counts
        WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [countId, companyId]
    );
    if (c.rows.length === 0) throw new NotFoundError('Conteo no encontrado');
    const count = c.rows[0];
    if (count.status !== 'OPEN') throw new ConflictError(`El conteo ya está ${count.status}`);

    const items = await transactionQuery<any>(
      client,
      `SELECT id, product_id, system_qty, counted_qty
         FROM physical_count_items
        WHERE physical_count_id = $1 AND counted_qty IS NOT NULL`,
      [countId]
    );

    let adjustments = 0, surplus = 0, shortage = 0;
    for (const it of items.rows) {
      // Ajustar contra el stock ACTUAL para que quede en lo contado
      const stR = await transactionQuery<{ quantity: number }>(
        client,
        `SELECT quantity FROM warehouse_stock
          WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE`,
        [count.warehouse_id, it.product_id]
      );
      const current = Number(stR.rows[0]?.quantity ?? 0);
      const target = Number(it.counted_qty);
      const delta = Math.round((target - current) * 1_000_000) / 1_000_000;
      if (delta === 0) continue;

      const mv = await applyMovementTx(client, {
        companyId,
        productId: it.product_id,
        movementType: delta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
        quantity: Math.abs(delta),
        warehouseFromId: delta > 0 ? undefined : count.warehouse_id,
        warehouseToId:   delta > 0 ? count.warehouse_id : undefined,
        referenceType: 'physical_count',
        referenceId: countId,
        reason: `Ajuste por inventario físico #${count.folio} (contado ${target}, sistema ${current})`,
        userId: user.userId,
        userEmail: user.email,
      });
      await transactionQuery(
        client,
        `UPDATE physical_count_items SET adjustment_movement_id = $1 WHERE id = $2`,
        [mv.movementId, it.id]
      );
      adjustments++;
      if (delta > 0) surplus++; else shortage++;
    }

    const upd = await transactionQuery<any>(
      client,
      `UPDATE physical_counts
          SET status = 'CLOSED', closed_at = NOW(),
              authorized_by = $1, authorized_by_email = $2
        WHERE id = $3
        RETURNING id, folio, status, closed_at`,
      [user.userId || null, user.email || null, countId]
    );

    logger.info(
      `[physical-count] Conteo #${count.folio} cerrado: ${adjustments} ajustes ` +
      `(${surplus} sobrantes, ${shortage} faltantes)`
    );
    return { ...upd.rows[0], adjustments, surplus, shortage };
  });
}

/** Cancela un conteo abierto sin ajustar nada. */
export async function cancelCount(companyId: string, countId: string): Promise<any> {
  const r = await query<any>(
    `UPDATE physical_counts SET status = 'CANCELLED'
      WHERE id = $1 AND company_id = $2 AND status = 'OPEN'
      RETURNING id, folio, status`,
    [countId, companyId]
  );
  if (r.rows.length === 0) throw new NotFoundError('Conteo abierto no encontrado');
  return r.rows[0];
}

/** Lista de conteos. */
export async function listCounts(companyId: string) {
  const r = await query<any>(
    `SELECT pc.id, pc.folio, pc.status, pc.category, pc.notes,
            pc.started_at, pc.closed_at, pc.created_by_email, pc.authorized_by_email,
            w.code AS warehouse_code, w.name AS warehouse_name,
            COUNT(i.id)::int AS products,
            COUNT(i.counted_qty)::int AS counted,
            COUNT(*) FILTER (WHERE i.difference <> 0 AND i.counted_qty IS NOT NULL)::int AS differences,
            COALESCE(SUM(i.difference * i.avg_cost) FILTER (WHERE i.counted_qty IS NOT NULL), 0) AS value_difference
       FROM physical_counts pc
       JOIN warehouses w ON w.id = pc.warehouse_id
       LEFT JOIN physical_count_items i ON i.physical_count_id = pc.id
      WHERE pc.company_id = $1
      GROUP BY pc.id, w.code, w.name
      ORDER BY pc.started_at DESC`,
    [companyId]
  );
  return r.rows;
}

/** Detalle de un conteo con sus items. */
export async function getCount(companyId: string, countId: string) {
  const c = await query<any>(
    `SELECT pc.*, w.code AS warehouse_code, w.name AS warehouse_name
       FROM physical_counts pc
       JOIN warehouses w ON w.id = pc.warehouse_id
      WHERE pc.id = $1 AND pc.company_id = $2`,
    [countId, companyId]
  );
  if (c.rows.length === 0) throw new NotFoundError('Conteo no encontrado');

  const items = await query<any>(
    `SELECT i.id, i.product_id, i.system_qty, i.counted_qty, i.difference, i.avg_cost,
            i.difference * i.avg_cost AS value_difference,
            i.adjustment_movement_id,
            p.sku, p.name AS product_name, p.unit_code, p.category
       FROM physical_count_items i
       JOIN products p ON p.id = i.product_id
      WHERE i.physical_count_id = $1
      ORDER BY p.name`,
    [countId]
  );
  return { count: c.rows[0], items: items.rows };
}
