/**
 * close-month.service — lógica del cierre mensual.
 *
 * Referencia: docs/DISENO_FACTURACION_PLANES.md §12 (Fase 4 documentada,
 * versión foundational implementada en Fase 2 sin prorrateo por cambio de
 * plan ni emisión automática del CFDI, que llegan en Fase 4).
 *
 * Reglas por plan:
 *   iguala  → renta base fija + extras (stamps_used − effective_cap) × extra_stamp_mxn
 *             + rollover del sobrante al mes siguiente.
 *   renta   → sin cap, no rollover. Cobra stamps_used × extra_stamp_mxn (renta 0).
 *   FLEX    → NO se factura mensualmente (se paga por adelantado en bloques).
 *             Se registra fila informativa sin cargos.
 *
 * Idempotencia:
 *   Si ya existe `monthly_invoicing (company_id, billing_period)` para el
 *   mes que se está cerrando, no se recalcula ni se sobrescribe. Se puede
 *   correr varias veces sin efectos secundarios.
 */

import { query, transaction, transactionQuery } from '../../config/database';
import logger from '../../middleware/logger';

/* ─────────────── Utilidades de fecha ─────────────── */

/**
 * Devuelve el primer día del mes anterior a `ref` (default = hoy).
 * ej. si ref = 2026-07-15, devuelve 2026-06-01.
 */
export function prevMonthStart(ref: Date = new Date()): Date {
  return new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
}
export function thisMonthStart(ref: Date = new Date()): Date {
  return new Date(ref.getFullYear(), ref.getMonth(), 1);
}
export function nextMonthStart(ref: Date = new Date()): Date {
  return new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
}
function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ─────────────── Cierre por empresa ─────────────── */

interface CompanyRow {
  id: string;
  rfc: string;
  business_name: string;
  stamp_package_code: string;
  carried_over_stamps: number;
  monthly_stamps: number;
  monthly_fee_mxn: number;
  extra_stamp_mxn: number;
}

export interface CloseMonthResult {
  companyId: string;
  rfc: string;
  billing_period: string;         // YYYY-MM-01
  action: 'created' | 'skipped_exists' | 'skipped_flex';
  stamps_used: number;
  stamps_extra: number;
  monthly_fee_mxn: number;
  extra_charge_mxn: number;
  total_mxn: number;
  rolling_to_next: number;
}

/**
 * Cierra el mes especificado (default = mes anterior al actual).
 * Para cada empresa: crea la fila en monthly_invoicing (si aún no existe)
 * y actualiza carried_over_stamps para el siguiente ciclo.
 *
 * Retorna un summary con lo que se hizo para cada empresa.
 */
export async function closeMonth(opts: {
  billingPeriod?: Date;        // primer día del mes a cerrar
  triggeredBy?: string;        // userId del super-admin
} = {}): Promise<CloseMonthResult[]> {
  const period = opts.billingPeriod ? new Date(opts.billingPeriod) : prevMonthStart();
  // Normaliza a día 1
  period.setDate(1); period.setHours(0, 0, 0, 0);
  const periodStr = isoDate(period);

  const companies = await query<CompanyRow>(
    `SELECT c.id, c.rfc, c.business_name, c.stamp_package_code,
            c.carried_over_stamps,
            sp.monthly_stamps, sp.monthly_fee_mxn, sp.extra_stamp_mxn
       FROM companies c
       JOIN stamp_packages sp ON sp.code = c.stamp_package_code
      WHERE c.id NOT IN (
        SELECT company_id FROM monthly_invoicing WHERE billing_period = $1
      )`,
    [periodStr]
  );

  const results: CloseMonthResult[] = [];

  for (const comp of companies.rows) {
    const r = await closeMonthForCompany(comp, periodStr, opts.triggeredBy);
    results.push(r);
  }

  logger.info(
    `closeMonth ${periodStr}: procesadas ${results.length} empresas ` +
    `(${results.filter(r => r.action === 'created').length} nuevas, ` +
    `${results.filter(r => r.action !== 'created').length} skipped)`
  );
  return results;
}

async function closeMonthForCompany(
  comp: CompanyRow,
  periodStr: string,
  triggeredBy?: string,
): Promise<CloseMonthResult> {
  return transaction(async (client) => {
    // FLEX no se factura mensualmente — se cobró en las recargas prepago.
    if (comp.stamp_package_code === 'PKG_FLEX') {
      const usedR = await transactionQuery<{ n: number }>(
        client,
        `SELECT COUNT(*)::int AS n FROM stamp_usage
          WHERE company_id = $1 AND billing_period = $2`,
        [comp.id, periodStr]
      );
      const used = Number(usedR.rows[0].n) || 0;

      // Igual dejamos huella informativa (para reportes) con total 0.
      await transactionQuery(
        client,
        `INSERT INTO monthly_invoicing
           (company_id, billing_period, package_code, stamps_included,
            stamps_used, stamps_extra, stamps_rolled_over_from_prev,
            stamps_rolling_to_next, monthly_fee_mxn, extra_charge_mxn,
            total_mxn, status, generated_by)
         VALUES ($1, $2, 'PKG_FLEX', 0, $3, 0, 0, 0, 0, 0, 0, 'PAID', $4)
         ON CONFLICT (company_id, billing_period) DO NOTHING`,
        [comp.id, periodStr, used, triggeredBy || null]
      );

      return {
        companyId: comp.id, rfc: comp.rfc, billing_period: periodStr,
        action: 'skipped_flex', stamps_used: used, stamps_extra: 0,
        monthly_fee_mxn: 0, extra_charge_mxn: 0, total_mxn: 0, rolling_to_next: 0,
      };
    }

    // Plan iguala / renta: cálculo estándar.
    const usedR = await transactionQuery<{ n: number }>(
      client,
      `SELECT COUNT(*)::int AS n FROM stamp_usage
        WHERE company_id = $1 AND billing_period = $2`,
      [comp.id, periodStr]
    );
    const stampsUsed = Number(usedR.rows[0].n) || 0;
    const included = Number(comp.monthly_stamps) || 0;
    const rollFrom = Number(comp.carried_over_stamps) || 0;
    const effectiveCap = included + rollFrom;

    const stampsExtra = Math.max(0, stampsUsed - effectiveCap);
    const rollingToNext = Math.max(0, effectiveCap - stampsUsed);

    const monthlyFee = Number(comp.monthly_fee_mxn) || 0;
    const extraCharge = Math.round(stampsExtra * Number(comp.extra_stamp_mxn) * 100) / 100;
    const total = Math.round((monthlyFee + extraCharge) * 100) / 100;

    await transactionQuery(
      client,
      `INSERT INTO monthly_invoicing
         (company_id, billing_period, package_code, stamps_included,
          stamps_used, stamps_extra, stamps_rolled_over_from_prev,
          stamps_rolling_to_next, monthly_fee_mxn, extra_charge_mxn,
          total_mxn, status, generated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDING', $12)
       ON CONFLICT (company_id, billing_period) DO NOTHING`,
      [
        comp.id, periodStr, comp.stamp_package_code, included,
        stampsUsed, stampsExtra, rollFrom,
        rollingToNext, monthlyFee, extraCharge,
        total, triggeredBy || null,
      ]
    );

    // Actualiza rollover para el ciclo siguiente (Decisión #3 — se conserva).
    await transactionQuery(
      client,
      `UPDATE companies SET carried_over_stamps = $2, updated_at = NOW()
        WHERE id = $1`,
      [comp.id, rollingToNext]
    );

    return {
      companyId: comp.id, rfc: comp.rfc, billing_period: periodStr,
      action: 'created', stamps_used: stampsUsed, stamps_extra: stampsExtra,
      monthly_fee_mxn: monthlyFee, extra_charge_mxn: extraCharge,
      total_mxn: total, rolling_to_next: rollingToNext,
    };
  });
}
