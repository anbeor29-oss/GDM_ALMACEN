/**
 * compliance-cron — BARRIDO DIARIO: cada madrugada refresca todas las opiniones de
 * las empresas con configuración ACTIVA en automático, vía SatGo, y SUSTITUYE la
 * vigente (no se acumula: solo se conserva la más reciente por tipo, para no ocupar
 * espacio — ver compliance.service).
 *
 * Antes corría SÓLO los domingos (`0 4 * * 1`). Se pasó a DIARIO porque:
 *   · el domingo podía no ejecutarse (reinicio del servicio, release, etc.) y la
 *     opinión quedaba una semana vieja sin que nadie se enterara;
 *   · el usuario pidió que se actualice todos los días.
 * Además se fija la zona horaria de CDMX explícita (Render corre en UTC) para que
 * "las 6 de la mañana" sean las de México y no se corra el día.
 *
 * Activación: sólo si ENABLE_COMPLIANCE_CRON=true (usa credenciales guardadas, así
 * que se enciende a conciencia; en dev/réplicas queda apagado). Si ayer no se
 * actualizó solo, lo más probable es que esta variable NO esté en 'true' en Render.
 * El botón «Actualizar» de Cumplimiento fiscal permite refrescar a mano sin esperar.
 */
import cron from 'node-cron';
import logger from '../middleware/logger';
import { todasActivas } from '../modules/compliance/programacion';
import { ejecutar } from '../modules/compliance/compliance.service';

/** Barre TODAS las opiniones activas en automático y sustituye la vigente. */
export async function correrBarrido(): Promise<void> {
  const items = await todasActivas();
  if (!items.length) return;
  logger.info(`[compliance-cron] barrido diario: ${items.length} opinión(es)…`);
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
  // Todos los días a las 06:00 CDMX. La zona horaria se fija explícita para no
  // depender de que el servidor esté en UTC o cambie de región.
  cron.schedule('0 6 * * *', () => {
    correrBarrido().catch((e) => logger.error(`[compliance-cron] error: ${e.message}`));
  }, { timezone: 'America/Mexico_City' });
  logger.info('[compliance-cron] Registrado: barrido DIARIO (06:00 CDMX).');
}
