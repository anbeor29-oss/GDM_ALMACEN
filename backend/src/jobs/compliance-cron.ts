/**
 * compliance-cron — BARRIDO SEMANAL (lunes 01:50 CDMX): refresca todas las opiniones
 * de las empresas con configuración ACTIVA en automático, vía SatGo, y SUSTITUYE la
 * vigente (no se acumula: solo se conserva la más reciente por tipo, para no ocupar
 * espacio — ver compliance.service).
 *
 * Horario: **lunes 01:50 CDMX** (`50 1 * * 1`), para que las tarjetas del Panel fiscal
 * estén frescas a primera hora del lunes (decisión del usuario, 2026-10-07). Antes fue
 * domingos 04:00 y luego diario 06:00; se volvió a semanal a este horario.
 * Zona horaria fija a CDMX (Render corre en UTC) para que "la 1:50" sea la de México.
 *
 * Trade-off a tener presente: si el servicio está reiniciando justo el lunes 01:50, ese
 * barrido se pierde y la opinión queda una semana vieja. El botón «Actualizar» (ahora en
 * el modal del Panel fiscal) permite refrescar a mano sin esperar al lunes.
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
  logger.info(`[compliance-cron] barrido semanal: ${items.length} opinión(es)…`);
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
  // Lunes 01:50 CDMX. La zona horaria se fija explícita para no depender de que el
  // servidor esté en UTC o cambie de región.
  cron.schedule('50 1 * * 1', () => {
    correrBarrido().catch((e) => logger.error(`[compliance-cron] error: ${e.message}`));
  }, { timezone: 'America/Mexico_City' });
  logger.info('[compliance-cron] Registrado: barrido SEMANAL (lunes 01:50 CDMX).');
}
