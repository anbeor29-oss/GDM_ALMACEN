/**
 * compliance-cron — BARRIDO DOMINICAL: cada domingo en la noche refresca todas las
 * opiniones de las empresas con configuración ACTIVA en automático, vía SatGo, y
 * SUSTITUYE la vigente (no se acumula: solo se conserva la más reciente por tipo,
 * para no ocupar espacio — ver compliance.service).
 *
 * Activación: sólo si ENABLE_COMPLIANCE_CRON=true (usa credenciales guardadas, así
 * que se enciende a conciencia; en dev/réplicas queda apagado).
 */
import cron from 'node-cron';
import logger from '../middleware/logger';
import { todasActivas } from '../modules/compliance/programacion';
import { ejecutar } from '../modules/compliance/compliance.service';

/** Barre TODAS las opiniones activas en automático y sustituye la vigente. */
export async function correrDominical(): Promise<void> {
  const items = await todasActivas();
  if (!items.length) return;
  logger.info(`[compliance-cron] barrido dominical: ${items.length} opinión(es)…`);
  for (const it of items) {
    try {
      const r = await ejecutar(it.company_id, it.tipo, 'SCHEDULER');
      logger.info(`[compliance-cron] ${it.tipo}/${it.company_id.slice(0, 8)}: ${r.estado}`);
    } catch (e) {
      logger.error(`[compliance-cron] ${it.tipo}/${it.company_id.slice(0, 8)}: ${(e as Error).message}`);
    }
  }
}

export function registerComplianceCron(): void {
  if (process.env.ENABLE_COMPLIANCE_CRON !== 'true') {
    logger.info('[compliance-cron] Deshabilitado (ENABLE_COMPLIANCE_CRON != true)');
    return;
  }
  // Domingo en la noche (CDMX). Render corre en UTC: lunes 04:00 UTC = domingo 22:00 CDMX.
  cron.schedule('0 4 * * 1', () => {
    correrDominical().catch((e) => logger.error(`[compliance-cron] error: ${e.message}`));
  });
  logger.info('[compliance-cron] Registrado: barrido dominical (domingo ~22:00 CDMX).');
}
