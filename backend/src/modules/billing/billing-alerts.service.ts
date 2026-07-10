/**
 * billing-alerts.service — correos automáticos del módulo de facturación.
 *
 * Referencia: docs/DISENO_FACTURACION_PLANES.md §6 (Jobs 2 y 3) y §7 (templates)
 *
 * Tres tipos de aviso:
 *   · prepaid_low   — saldo FLEX ≤ umbral (default 5). Una vez por ciclo
 *                     (flag low_notified_at; se limpia al recargar).
 *   · prepaid_zero  — saldo FLEX = 0, timbrado bloqueado. Una vez por ciclo
 *                     (flag zero_notified_at; se limpia al recargar).
 *   · payment_reminder — día 10: cargos INVOICED sin pagar del período previo.
 *
 * Los correos salen "desde" la empresa plataforma (PLATFORM_COMPANY_RFC) si
 * está configurada — así el cliente ve el remitente de HCGM. Fallback a
 * MAIL_FROM del sistema.
 *
 * Todos los sends son best-effort: un fallo de SMTP no debe romper el flujo
 * de timbrado ni el cron. Se loguea y se reintenta en el siguiente ciclo
 * (el flag solo se marca cuando el correo SÍ salió).
 */

import { query } from '../../config/database';
import logger from '../../middleware/logger';
import { sendPlainMail } from '../mailer/mailer.service';

/** Empresa plataforma (remitente de las alertas) — misma env que issue-invoice. */
async function platformCompanyId(): Promise<string | undefined> {
  const rfc = process.env.PLATFORM_COMPANY_RFC?.trim().toUpperCase();
  if (!rfc) return undefined;
  const r = await query<{ id: string }>(
    `SELECT id FROM companies WHERE rfc = $1`, [rfc]
  );
  return r.rows[0]?.id;
}

/* ─────────────── Alertas de prepago (low / zero) ─────────────── */

interface PrepaidAlertRow {
  company_id: string;
  rfc: string;
  business_name: string;
  contact_email: string | null;
  balance: number;
  low_threshold: number;
  low_notified_at: string | null;
  zero_notified_at: string | null;
}

/**
 * Revisa los saldos prepago y envía las alertas que falten.
 * Si `companyId` viene, revisa solo esa empresa (trigger post-timbrado);
 * sin argumento revisa todas las FLEX (cron horario, safety net).
 */
export async function checkPrepaidAlerts(companyId?: string): Promise<void> {
  const rows = await query<PrepaidAlertRow>(
    `SELECT c.id AS company_id, c.rfc, c.business_name, c.contact_email,
            pb.balance, pb.low_threshold, pb.low_notified_at, pb.zero_notified_at
       FROM companies c
       JOIN prepaid_stamp_balance pb ON pb.company_id = c.id
      WHERE c.stamp_package_code = 'PKG_FLEX'
        AND ($1::uuid IS NULL OR c.id = $1)`,
    [companyId || null]
  );

  const fromId = await platformCompanyId();

  for (const row of rows.rows) {
    try {
      if (!row.contact_email) {
        // Sin correo del cliente no hay a quién avisar — log una sola vez
        // por corrida; el super-admin lo ve en Compras Prepago de todas formas.
        if (row.balance <= row.low_threshold) {
          logger.warn(
            `Prepago bajo en ${row.rfc} (${row.balance}) pero la empresa no tiene contact_email`
          );
        }
        continue;
      }

      // ZERO — bloqueo total
      if (row.balance === 0 && !row.zero_notified_at) {
        await sendPlainMail({
          companyId: fromId,
          to: row.contact_email,
          subject: `URGENTE — Timbrado detenido, sin saldo prepago (${row.rfc})`,
          message:
            `El saldo de timbres prepago de ${row.business_name} llegó a CERO y ` +
            `el timbrado quedó BLOQUEADO.\n\n` +
            `Para reactivar la emisión de facturas, contáctanos para recargar tu ` +
            `plan (bloques de 30 timbres a $4.99 + IVA c/u).\n\n` +
            `Una vez aplicada la recarga, el bloqueo se libera automáticamente.`,
        });
        await query(
          `UPDATE prepaid_stamp_balance SET zero_notified_at = NOW() WHERE company_id = $1`,
          [row.company_id]
        );
        logger.info(`Alerta prepaid_zero enviada a ${row.contact_email} (${row.rfc})`);
        continue; // el zero ya implica el low; no mandamos ambos
      }

      // LOW — por agotarse
      if (row.balance > 0 && row.balance <= row.low_threshold && !row.low_notified_at) {
        await sendPlainMail({
          companyId: fromId,
          to: row.contact_email,
          subject: `Timbres prepago casi agotados — quedan ${row.balance} (${row.rfc})`,
          message:
            `A ${row.business_name} le quedan ${row.balance} timbre(s) prepago.\n\n` +
            `Para no interrumpir tu facturación, recomendamos recargar antes de ` +
            `que el saldo llegue a cero — al agotarse, el timbrado se bloquea ` +
            `automáticamente.\n\n` +
            `Bloques de 30 timbres a $4.99 + IVA c/u. Contáctanos para aplicar tu recarga.`,
        });
        await query(
          `UPDATE prepaid_stamp_balance SET low_notified_at = NOW() WHERE company_id = $1`,
          [row.company_id]
        );
        logger.info(`Alerta prepaid_low enviada a ${row.contact_email} (${row.rfc})`);
      }
    } catch (e) {
      // No marca el flag → se reintenta en el próximo ciclo del cron.
      logger.warn(
        `Alerta prepago a ${row.rfc} falló: ${(e as Error).message} — se reintentará`
      );
    }
  }
}

/* ─────────────── Recordatorio de pago (día 10) ─────────────── */

interface ReminderRow {
  company_id: string;
  rfc: string;
  business_name: string;
  contact_email: string | null;
  charges: Array<{
    billing_period: string;
    package_code: string;
    total_mxn: number;
    invoice_folio: string | null;
  }>;
}

/**
 * Envía UN correo por empresa listando todos sus cargos INVOICED sin pagar.
 * Pensado para correr el día 10 de cada mes (cron), pero es seguro correrlo
 * manualmente — no persiste flags: si se corre dos veces, avisa dos veces
 * (aceptable para un recordatorio de cobranza).
 */
export async function sendPaymentReminders(): Promise<{ sent: number; skipped: number }> {
  const r = await query<any>(
    `SELECT mi.company_id, c.rfc, c.business_name, c.contact_email,
            json_agg(json_build_object(
              'billing_period', mi.billing_period,
              'package_code',   mi.package_code,
              'total_mxn',      mi.total_mxn,
              'invoice_folio',  mi.invoice_folio
            ) ORDER BY mi.billing_period) AS charges
       FROM monthly_invoicing mi
       JOIN companies c ON c.id = mi.company_id
      WHERE mi.status = 'INVOICED'
        AND mi.paid_at IS NULL
        AND mi.total_mxn > 0
      GROUP BY mi.company_id, c.rfc, c.business_name, c.contact_email`
  );

  const fromId = await platformCompanyId();
  let sent = 0;
  let skipped = 0;

  for (const row of r.rows as ReminderRow[]) {
    if (!row.contact_email) {
      logger.warn(`Recordatorio de pago: ${row.rfc} sin contact_email — skip`);
      skipped++;
      continue;
    }
    try {
      const lines = row.charges.map((ch) => {
        const period = String(ch.billing_period).slice(0, 7);
        const folio = ch.invoice_folio ? ` · CFDI ${ch.invoice_folio}` : '';
        return `  · ${period} — plan ${ch.package_code}${folio} — $${Number(ch.total_mxn).toFixed(2)} + IVA`;
      });
      const total = row.charges.reduce((s, ch) => s + Number(ch.total_mxn), 0);

      await sendPlainMail({
        companyId: fromId,
        to: row.contact_email,
        subject: `Recordatorio de pago — ${row.charges.length} cargo(s) pendiente(s)`,
        message:
          `${row.business_name}:\n\n` +
          `Tienes los siguientes cargos del servicio de facturación pendientes de pago:\n\n` +
          lines.join('\n') + `\n\n` +
          `Total pendiente: $${total.toFixed(2)} + IVA.\n\n` +
          `Si ya realizaste el pago, por favor compártenos el comprobante para ` +
          `aplicarlo. Gracias.`,
      });
      sent++;
      logger.info(`Recordatorio de pago enviado a ${row.contact_email} (${row.rfc})`);
    } catch (e) {
      logger.warn(`Recordatorio a ${row.rfc} falló: ${(e as Error).message}`);
      skipped++;
    }
  }

  logger.info(`sendPaymentReminders: ${sent} enviados, ${skipped} skipped`);
  return { sent, skipped };
}
