/**
 * depreciacion-cron — genera la póliza de depreciación/amortización al cambio de mes.
 *
 * Cron: día 1 de cada mes 03:00 (America/Mexico_City). Cierra el mes que ACABA
 * de terminar: por cada empresa activa arma UNA póliza con la depreciación
 * (cargo 701 / abono 171) y la amortización de intangibles (cargo 702 / abono
 * 183) de ese mes, y enseguida actualiza su balanza para que los saldos ya la
 * reflejen.
 *
 * Idempotente: `generarDepreciacionDelMes` hace "un mes = una póliza"
 * (origen_uuid DEPRE-AAAA-MM), así que aunque el cron corriera dos veces no
 * duplica. Las empresas sin activos que depreciar simplemente no generan nada.
 *
 * Activación: sólo si ENABLE_DEPRECIACION_CRON=true (no corre en dev ni en
 * réplicas). El mismo botón «Generar depreciación» de la tarjeta hace esto a
 * mano para el mes que se elija.
 */

import cron from 'node-cron';
import logger from '../middleware/logger';
import { query } from '../config/database';
import { generarDepreciacionDelMes } from '../modules/accounting/activos-fijos.service';
import { alimentarDesdePolizas } from '../modules/accounting/periodos.service';

const ZONA = 'America/Mexico_City';

/** El (año, mes) del mes que acaba de cerrar, visto desde hoy. */
export function mesQueCerro(hoy = new Date()): { anio: number; mes: number } {
  const y = hoy.getFullYear();
  const m = hoy.getMonth() + 1; // 1..12 = mes en curso
  return m === 1 ? { anio: y - 1, mes: 12 } : { anio: y, mes: m - 1 };
}

/**
 * Genera la depreciación del mes (por defecto, el que cerró) para todas las
 * empresas activas y actualiza sus balanzas. Reutilizable a mano con (anio, mes).
 */
export async function correrDepreciacionMensual(anioArg?: number, mesArg?: number): Promise<void> {
  const { anio, mes } = (anioArg && mesArg) ? { anio: anioArg, mes: mesArg } : mesQueCerro();
  logger.info(`[depre-cron] Depreciación de ${mes}/${anio} para todas las empresas…`);

  const empresas = await query<{ id: string }>(
    `SELECT id FROM companies WHERE deleted_at IS NULL AND is_active ORDER BY business_name`);

  let conPoliza = 0, sinActivos = 0, errores = 0;
  for (const e of empresas.rows) {
    try {
      const r = await generarDepreciacionDelMes(e.id, anio, mes);
      if (r.creada) {
        conPoliza++;
        // Actualiza la balanza del mes para que los saldos ya incluyan la póliza.
        try {
          await alimentarDesdePolizas(e.id, anio, mes, {});
        } catch (be: any) {
          logger.warn(`[depre-cron] ${e.id}: balanza no se actualizó (${be.message})`);
        }
        logger.info(`[depre-cron] ${e.id}: póliza #${r.folio}, ${r.activos} activo(s), total ${r.total}`);
      } else if (r.yaExiste) {
        logger.info(`[depre-cron] ${e.id}: ya existía la póliza #${r.folio} (idempotente)`);
      } else {
        sinActivos++;
      }
    } catch (ce: any) {
      errores++;
      logger.error(`[depre-cron] ${e.id}: ${ce.message}`);
    }
  }
  logger.info(
    `[depre-cron] Listo ${mes}/${anio}: ${conPoliza} con póliza, ` +
    `${sinActivos} sin activos que depreciar, ${errores} error(es).`);
}

export function registerDepreciacionCron(): void {
  if (process.env.ENABLE_DEPRECIACION_CRON !== 'true') {
    logger.info('[depre-cron] Deshabilitado (ENABLE_DEPRECIACION_CRON != true)');
    return;
  }
  // Día 1 de cada mes, 03:00 hora de México: cierra la depreciación del mes anterior.
  cron.schedule('0 3 1 * *', () => {
    correrDepreciacionMensual().catch((e) =>
      logger.error(`[depre-cron] error no capturado: ${e.message}`));
  }, { timezone: ZONA });

  logger.info('[depre-cron] Registrado: día 1 03:00 (America/Mexico_City) — depreciación del mes anterior');
}
