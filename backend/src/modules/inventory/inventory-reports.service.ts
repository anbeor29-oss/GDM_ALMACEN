/**
 * Inventory Reports Service — valuación, snapshots mensuales, rotación y
 * exigencias de conteo físico (§12 + requerimiento de dashboard).
 *
 *  · El snapshot congela el valor del inventario (consolidado + por almacén)
 *    con el mes como llave — idempotente: repetirlo actualiza el mismo mes.
 *  · Lo consumen el cron mensual (día 1) y el endpoint manual.
 */

import { query, transaction, transactionQuery } from '../../config/database';
import logger from '../../middleware/logger';

export interface SnapshotResult {
  companyId: string;
  month: string;
  consolidated: { totalUnits: number; totalValue: number; productsCount: number };
  warehouses: number;
}

/** Primer día del mes de una fecha (default: hoy). */
export function monthStart(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

/**
 * Toma el snapshot de UNA empresa para el mes dado (default: mes en curso).
 * Guarda un renglón consolidado (warehouse_id NULL) + uno por almacén activo.
 */
export async function takeSnapshot(
  companyId: string,
  opts?: { month?: string; source?: 'CRON' | 'MANUAL' }
): Promise<SnapshotResult> {
  const month = opts?.month || monthStart();
  const source = opts?.source || 'MANUAL';

  return transaction(async (client) => {
    // Por almacén
    const perWh = await transactionQuery<any>(
      client,
      `SELECT w.id AS warehouse_id,
              COALESCE(SUM(ws.quantity), 0)                       AS total_units,
              COALESCE(SUM(ws.quantity * ws.avg_cost), 0)         AS total_value,
              COUNT(ws.id) FILTER (WHERE ws.quantity > 0)         AS products_count
         FROM warehouses w
         LEFT JOIN warehouse_stock ws ON ws.warehouse_id = w.id
        WHERE w.company_id = $1 AND w.deleted_at IS NULL
        GROUP BY w.id`,
      [companyId]
    );

    let totUnits = 0; let totValue = 0; let totProducts = 0;
    for (const row of perWh.rows) {
      totUnits += Number(row.total_units);
      totValue += Number(row.total_value);
      totProducts += Number(row.products_count);
      await transactionQuery(
        client,
        `INSERT INTO inventory_value_snapshots
           (company_id, warehouse_id, snapshot_month, total_units, total_value, products_count, source, taken_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (company_id, warehouse_id, snapshot_month)
         DO UPDATE SET total_units = $4, total_value = $5, products_count = $6,
                       source = $7, taken_at = NOW()`,
        [companyId, row.warehouse_id, month,
         row.total_units, row.total_value, row.products_count, source]
      );
    }

    // Consolidado (warehouse_id NULL)
    await transactionQuery(
      client,
      `INSERT INTO inventory_value_snapshots
         (company_id, warehouse_id, snapshot_month, total_units, total_value, products_count, source, taken_at)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (company_id, warehouse_id, snapshot_month)
       DO UPDATE SET total_units = $3, total_value = $4, products_count = $5,
                     source = $6, taken_at = NOW()`,
      [companyId, month, totUnits, totValue, totProducts, source]
    );

    return {
      companyId,
      month,
      consolidated: { totalUnits: totUnits, totalValue: totValue, productsCount: totProducts },
      warehouses: perWh.rows.length,
    };
  });
}

/** Snapshot de TODAS las empresas activas — lo usa el cron mensual. */
export async function takeSnapshotAllCompanies(): Promise<number> {
  const companies = await query<{ id: string }>(
    `SELECT id FROM companies WHERE deleted_at IS NULL AND is_active = true`
  );
  let ok = 0;
  for (const c of companies.rows) {
    try {
      await takeSnapshot(c.id, { source: 'CRON' });
      ok++;
    } catch (e) {
      logger.error(`[inventory-snapshot] Empresa ${c.id} falló: ${(e as Error).message}`);
    }
  }
  logger.info(`[inventory-snapshot] ${ok}/${companies.rows.length} empresas congeladas`);
  return ok;
}

/** Valuación ACTUAL (en vivo): consolidado + desglose por almacén. */
export async function getCurrentValue(companyId: string) {
  const r = await query<any>(
    `SELECT w.id AS warehouse_id, w.code, w.name,
            COALESCE(SUM(ws.quantity), 0)               AS total_units,
            COALESCE(SUM(ws.quantity * ws.avg_cost), 0) AS total_value,
            COUNT(ws.id) FILTER (WHERE ws.quantity > 0) AS products_count
       FROM warehouses w
       LEFT JOIN warehouse_stock ws ON ws.warehouse_id = w.id
      WHERE w.company_id = $1 AND w.deleted_at IS NULL AND w.is_active = true
      GROUP BY w.id, w.code, w.name
      ORDER BY total_value DESC`,
    [companyId]
  );
  const consolidated = r.rows.reduce(
    (acc, w) => ({
      totalUnits: acc.totalUnits + Number(w.total_units),
      totalValue: acc.totalValue + Number(w.total_value),
      productsCount: acc.productsCount + Number(w.products_count),
    }),
    { totalUnits: 0, totalValue: 0, productsCount: 0 }
  );
  return { consolidated, warehouses: r.rows };
}

/** Histórico mensual (consolidado o por almacén). */
export async function getValueHistory(companyId: string, months = 12, warehouseId?: string) {
  const params: any[] = [companyId, months];
  let whFilter = 'warehouse_id IS NULL';
  if (warehouseId) {
    params.push(warehouseId);
    whFilter = `warehouse_id = $3`;
  }
  const r = await query<any>(
    `SELECT snapshot_month, total_units, total_value, products_count, source, taken_at
       FROM inventory_value_snapshots
      WHERE company_id = $1 AND ${whFilter}
      ORDER BY snapshot_month DESC
      LIMIT $2`,
    params
  );
  return r.rows.reverse(); // ascendente para graficar
}
