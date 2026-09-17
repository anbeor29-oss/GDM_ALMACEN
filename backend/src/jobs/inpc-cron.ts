/**
 * inpc-cron — baja el INPC del INEGI automáticamente.
 *
 * El INEGI publica el INPC mensual alrededor del día 9 y el quincenal cerca del
 * día 24. Este cron corre el 10/11 y el 24/25 de cada mes a las 04:00 (hora de
 * México) y le pide al INEGI la serie, que se guarda en `fiscal_inpc`. Se corre
 * varios días por si la publicación se retrasa; como el guardado es un UPSERT,
 * repetirlo no duplica ni hace daño.
 *
 * Activación: sólo si ENABLE_INPC_CRON=true Y hay INEGI_TOKEN (sin token no hay
 * de dónde bajar). El botón «Actualizar desde INEGI» de la pantalla de
 * Indicadores hace lo mismo a mano.
 */

import cron from 'node-cron';
import logger from '../middleware/logger';
import { actualizarInpc } from '../modules/accounting/indicadores.service';

const ZONA = 'America/Mexico_City';

/** Baja el INPC del INEGI (reutilizable a mano). No truena el proceso si falla. */
export async function correrActualizacionInpc(): Promise<void> {
  try {
    const r = await actualizarInpc();
    logger.info(`[inpc-cron] INPC actualizado: ${r.actualizados} periodo(s) (${r.desde} → ${r.hasta}).`);
  } catch (e: any) {
    logger.warn(`[inpc-cron] No se pudo actualizar el INPC: ${e?.message || e}`);
  }
}

export function registerInpcCron(): void {
  if (process.env.ENABLE_INPC_CRON !== 'true') {
    logger.info('[inpc-cron] Deshabilitado (ENABLE_INPC_CRON != true)');
    return;
  }
  if (!process.env.INEGI_TOKEN && !process.env.INEGI_INPC_URL) {
    logger.warn('[inpc-cron] Habilitado pero SIN INEGI_TOKEN ni INEGI_INPC_URL: no hay de dónde bajar el INPC. Pon uno de los dos en Render.');
    return;
  }
  // 10 y 11 (INPC mensual, ~día 9) y 24 y 25 (quincenal, ~día 24), 04:00 México.
  cron.schedule('0 4 10,11,24,25 * *', () => {
    correrActualizacionInpc().catch((e) => logger.error(`[inpc-cron] error no capturado: ${e.message}`));
  }, { timezone: ZONA });

  logger.info('[inpc-cron] Registrado: días 10,11,24,25 a las 04:00 (America/Mexico_City) — baja el INPC del INEGI');
}
