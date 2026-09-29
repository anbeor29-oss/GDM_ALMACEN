/**
 * compliance-cron — corre el motor de cumplimiento para las empresas con
 * configuración ACTIVA y en modo automático, cuando su próxima ejecución vence.
 *
 * La frecuencia efectiva la define cada config (SAT/CSF día 1, IMSS día 17). El
 * cron sólo "despierta" cada hora y ejecuta lo VENCIDO; el motor recalcula la
 * próxima. Es idempotente: si nada vence, no hace nada.
 *
 * Activación: sólo si ENABLE_COMPLIANCE_CRON=true (usa credenciales guardadas,
 * así que se enciende a conciencia; en dev/réplicas queda apagado).
 */
import cron from 'node-cron';
import logger from '../middleware/logger';
import { pendientes } from '../modules/compliance/programacion';
import { ejecutar } from '../modules/compliance/compliance.service';

export async function correrPendientes(): Promise<void> {
  const items = await pendientes();
  if (!items.length) return;
  logger.info(`[compliance-cron] ${items.length} consulta(s) por correr…`);
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
  // Cada hora en punto: ejecuta lo vencido.
  cron.schedule('0 * * * *', () => {
    correrPendientes().catch((e) => logger.error(`[compliance-cron] error: ${e.message}`));
  });
  logger.info('[compliance-cron] Registrado: revisa cada hora las consultas vencidas.');
}
