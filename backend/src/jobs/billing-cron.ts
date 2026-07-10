/**
 * billing-cron — job automático de cierre mensual.
 *
 * Cron: 00:15 del día 1 de cada mes (hora del servidor — Render corre en UTC,
 * así que 00:15 UTC = 18:15 del día anterior en CDMX invierno / 19:15 verano.
 * Para el negocio es irrelevante: lo que importa es que corra una vez por mes
 * después del corte; si se prefiere hora México exacta, ajustar a '15 6 1 * *').
 *
 * Flujo:
 *   1. closeMonth() — genera monthly_invoicing del mes anterior + rollover.
 *   2. issueAllForPeriod() — emite el CFDI de cobro HCGM → cliente por cada
 *      cargo PENDING con total > 0 y lo envía por correo.
 *
 * Activación:
 *   Solo si ENABLE_BILLING_CRON=true (evita que corra en dev o en réplicas).
 *   El cierre es idempotente, así que aunque corriera doble no duplica.
 */

import cron from 'node-cron';
import logger from '../middleware/logger';
import { closeMonth, prevMonthStart } from '../modules/billing/close-month.service';
import { issueAllForPeriod } from '../modules/billing/issue-invoice.service';
import { checkPrepaidAlerts, sendPaymentReminders } from '../modules/billing/billing-alerts.service';

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function runMonthlyClose(): Promise<void> {
  const period = prevMonthStart();
  const periodStr = isoDate(period);
  logger.info(`[billing-cron] Iniciando cierre mensual de ${periodStr}…`);

  try {
    const closed = await closeMonth({ billingPeriod: period });
    logger.info(
      `[billing-cron] Cierre: ${closed.filter(r => r.action === 'created').length} cargos creados ` +
      `de ${closed.length} empresas.`
    );

    const issued = await issueAllForPeriod(periodStr);
    logger.info(
      `[billing-cron] Emisión: ${issued.filter(r => r.status === 'INVOICED').length} CFDIs timbrados, ` +
      `${issued.filter(r => r.status === 'ERROR').length} errores (reintentar desde la UI).`
    );
  } catch (e) {
    logger.error(`[billing-cron] Cierre mensual falló: ${(e as Error).message}`);
  }
}

export function registerBillingCron(): void {
  if (process.env.ENABLE_BILLING_CRON !== 'true') {
    logger.info('[billing-cron] Deshabilitado (ENABLE_BILLING_CRON != true)');
    return;
  }

  // '15 0 1 * *' → minuto 15, hora 0, día 1 de cada mes
  cron.schedule('15 0 1 * *', () => {
    runMonthlyClose().catch((e) =>
      logger.error(`[billing-cron] error no capturado: ${e.message}`)
    );
  });

  // Cada hora en punto: alertas de prepago (low/zero) para todas las FLEX.
  // Safety net del trigger post-timbrado — cubre recargas manuales en BD,
  // fallos de SMTP previos (el flag no se marcó) y decrementos concurrentes.
  cron.schedule('0 * * * *', () => {
    checkPrepaidAlerts().catch((e) =>
      logger.error(`[billing-cron] prepaid alerts: ${e.message}`)
    );
  });

  // Día 10 a las 09:00 (hora servidor): recordatorio de pago a cargos
  // INVOICED sin pagar. Un correo por empresa con la lista de sus cargos.
  cron.schedule('0 9 10 * *', () => {
    sendPaymentReminders().catch((e) =>
      logger.error(`[billing-cron] payment reminders: ${e.message}`)
    );
  });

  logger.info(
    '[billing-cron] Registrado: cierre mensual (día 1 00:15) · ' +
    'alertas prepago (cada hora) · recordatorio de pago (día 10 09:00)'
  );
}
