/**
 * inventory-cron — snapshot mensual del valor del inventario.
 *
 * Cron: 00:30 del día 1 de cada mes (después del cierre de billing 00:15).
 * Congela la valuación de TODAS las empresas activas en
 * inventory_value_snapshots (consolidado + por almacén).
 *
 * Idempotente: repetir el snapshot del mismo mes solo lo actualiza
 * (ON CONFLICT en company+warehouse+mes), así que un doble disparo es inocuo.
 *
 * Activación: ENABLE_INVENTORY_CRON=true (mismo patrón que billing-cron).
 */

import cron from 'node-cron';
import logger from '../middleware/logger';
import { takeSnapshotAllCompanies } from '../modules/inventory/inventory-reports.service';

export function registerInventoryCron(): void {
  if (process.env.ENABLE_INVENTORY_CRON !== 'true') {
    logger.info('[inventory-cron] Deshabilitado (ENABLE_INVENTORY_CRON != true)');
    return;
  }

  // '30 0 1 * *' → minuto 30, hora 0, día 1 de cada mes
  cron.schedule('30 0 1 * *', () => {
    takeSnapshotAllCompanies().catch((e) =>
      logger.error(`[inventory-cron] snapshot mensual falló: ${e.message}`)
    );
  });

  logger.info('[inventory-cron] Registrado: snapshot de valuación (día 1 00:30)');
}
