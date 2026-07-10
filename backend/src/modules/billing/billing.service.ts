/**
 * billing.service — reglas de negocio del módulo Facturación y Consumo.
 *
 * Referencia: docs/DISENO_FACTURACION_PLANES.md
 *
 * Funciones foundational (Fase 1):
 *   · getCompanyBillingSnapshot(companyId)
 *       Trae paquete, cap, rollover, uso del mes, saldo prepago.
 *   · getPrepaidBalance(companyId)
 *       Wrapper simple para el balance actual (crea la fila si no existe).
 *   · assertCanStamp(companyId)
 *       Guardrail para llamar antes de invocar al PAC.
 *       Rechaza cuando PKG_FLEX y balance < 1 (Decisión #9 — bloqueo total).
 *   · recordStampUsed(client, companyId, invoiceId?, creditNoteId?, ...)
 *       Registra el timbre en stamp_usage y decrementa el prepago si aplica.
 *       Debe llamarse DESPUÉS de que el PAC haya devuelto success.
 */

import { PoolClient } from 'pg';
import { query, transactionQuery } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

/* ─────────────── Tipos ─────────────── */

export interface BillingSnapshot {
  companyId: string;
  packageCode: string;                 // PKG_100 | PKG_200 | PKG_500 | PKG_FLEX
  isPrepaid: boolean;                  // true para PKG_FLEX
  quotaMonthlyStamps: number;          // stamp_packages.monthly_stamps
  carriedOverStamps: number;           // rollover del previo
  effectiveCap: number;                // quota + carriedOver
  usedCurrentMonth: number;            // stamps consumidos este mes
  remaining: number;                   // max(0, effectiveCap - used)
  extraStampMxn: number;               // precio por timbre extra del plan
  monthlyFeeMxn: number;               // renta del plan
  prepaidBalance: number;              // solo tiene sentido para FLEX
  prepaidLowThreshold: number;         // umbral de aviso prepago
}

/* ─────────────── Constantes ─────────────── */

export const PREPAID_LOW_THRESHOLD = 5;      // Decisión #8 (fijo)
export const PREPAID_UNIT_PRICE_MXN = 4.99;  // Decisión #7 (fijo)

/* ─────────────── API ─────────────── */

/**
 * Trae el snapshot completo de facturación del mes en curso. Un solo SELECT
 * a la vista `v_stamp_usage_current` que ya agrega todo lo que necesitamos.
 */
export async function getCompanyBillingSnapshot(companyId: string): Promise<BillingSnapshot> {
  const r = await query<any>(
    `SELECT company_id, stamp_package_code, quota, carried_over_stamps,
            effective_cap, used_current_month, remaining,
            monthly_fee_mxn, extra_stamp_mxn, is_prepaid,
            prepaid_balance, prepaid_low_threshold
       FROM v_stamp_usage_current
      WHERE company_id = $1`,
    [companyId]
  );
  const row = r.rows[0];
  if (!row) {
    throw new ValidationError(`Empresa ${companyId} no existe en el catálogo de billing`);
  }
  return {
    companyId: row.company_id,
    packageCode: row.stamp_package_code,
    isPrepaid: !!row.is_prepaid,
    quotaMonthlyStamps: Number(row.quota) || 0,
    carriedOverStamps: Number(row.carried_over_stamps) || 0,
    effectiveCap: Number(row.effective_cap) || 0,
    usedCurrentMonth: Number(row.used_current_month) || 0,
    remaining: Number(row.remaining) || 0,
    extraStampMxn: Number(row.extra_stamp_mxn) || 0,
    monthlyFeeMxn: Number(row.monthly_fee_mxn) || 0,
    prepaidBalance: Number(row.prepaid_balance) || 0,
    prepaidLowThreshold: Number(row.prepaid_low_threshold) || PREPAID_LOW_THRESHOLD,
  };
}

/**
 * Saldo prepago de una empresa. Crea la fila con balance=0 si no existe
 * (perezosamente, sin bloquear al llamador). Esto simplifica el resto:
 * el caller nunca tiene que preocuparse por "no hay fila todavía".
 */
export async function getPrepaidBalance(companyId: string): Promise<number> {
  const r = await query<{ balance: number }>(
    `SELECT balance FROM prepaid_stamp_balance WHERE company_id = $1`,
    [companyId]
  );
  if (r.rows.length === 0) {
    await query(
      `INSERT INTO prepaid_stamp_balance (company_id, balance, low_threshold)
         VALUES ($1, 0, $2)
       ON CONFLICT (company_id) DO NOTHING`,
      [companyId, PREPAID_LOW_THRESHOLD]
    );
    return 0;
  }
  return Number(r.rows[0].balance) || 0;
}

/**
 * Guardrail que debe llamarse ANTES de invocar al PAC para timbrar.
 * Reglas:
 *   · PKG_FLEX con balance < 1  →  ValidationError (bloqueo total, Decisión #9).
 *   · Cualquier otro plan       →  pasa (los extras se cobran al cierre).
 *
 * No lanza si el paquete no existe — el flujo de timbrado tiene sus propias
 * validaciones (CSD cargado, factura no cancelada, etc.).
 */
export async function assertCanStamp(companyId: string): Promise<void> {
  const snap = await getCompanyBillingSnapshot(companyId).catch(() => null);
  if (!snap) return;

  if (snap.isPrepaid && snap.prepaidBalance < 1) {
    throw new ValidationError(
      'Sin saldo prepago disponible. Contacta al administrador para recargar ' +
      'tu plan (bloques de 30 timbres). Este bloqueo evita generar timbres ' +
      'que no puedan cobrarse.'
    );
  }
}

/**
 * Registra el consumo de UN timbre después de que el PAC confirmó success.
 *   · Inserta en stamp_usage (fuente de verdad para el reporte mensual).
 *   · Si el plan es FLEX, decrementa prepaid_stamp_balance.
 *   · Loguea; no lanza si la BD falla (el CFDI ya se timbró — no queremos
 *     perder el registro por un error de contabilidad; se puede reconciliar
 *     después con el histórico del PAC).
 *
 * Debe llamarse DENTRO de la misma transacción que actualiza `invoices`
 * (o `credit_notes`) para que si el UPDATE falla se haga rollback de todo.
 */
export async function recordStampUsed(
  client: PoolClient,
  opts: {
    companyId: string;
    invoiceId?: string;
    creditNoteId?: string;
    stampUuid?: string;
  }
): Promise<void> {
  const { companyId, invoiceId, creditNoteId, stampUuid } = opts;
  if (!invoiceId && !creditNoteId) {
    logger.warn('recordStampUsed llamado sin invoiceId ni creditNoteId — skip');
    return;
  }

  // Leer paquete actual dentro de la TX (queda inmortal en package_code_at_stamp
  // aunque después el super-admin cambie el paquete de la empresa).
  const pkgR = await transactionQuery<{ code: string; extra: number; monthly: number }>(
    client,
    `SELECT sp.code, sp.extra_stamp_mxn AS extra, sp.monthly_stamps AS monthly
       FROM companies c JOIN stamp_packages sp ON sp.code = c.stamp_package_code
      WHERE c.id = $1`,
    [companyId]
  );
  const pkg = pkgR.rows[0];
  if (!pkg) {
    logger.warn(`recordStampUsed: empresa ${companyId} sin paquete — skip`);
    return;
  }

  // Contar timbres del mes ya registrados para saber si este entra como extra.
  const usedR = await transactionQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int AS n FROM stamp_usage
      WHERE company_id = $1
        AND billing_period = date_trunc('month', NOW())::date`,
    [companyId]
  );
  const usedBefore = Number(usedR.rows[0].n) || 0;

  // Cap efectivo: quota + rollover. Para FLEX quota=0 → siempre "extra"
  // pero no cobramos extra ($0) porque el prepago ya cubrió.
  const capR = await transactionQuery<{ cap: number }>(
    client,
    `SELECT (monthly_stamps + carried_over_stamps) AS cap
       FROM companies c JOIN stamp_packages sp ON sp.code = c.stamp_package_code
      WHERE c.id = $1`,
    [companyId]
  );
  const cap = Number(capR.rows[0]?.cap) || 0;
  const isExtra = usedBefore + 1 > cap;
  const extraCharge = isExtra && pkg.code !== 'PKG_FLEX' ? Number(pkg.extra) : 0;

  await transactionQuery(
    client,
    `INSERT INTO stamp_usage
       (company_id, invoice_id, credit_note_id, stamp_uuid,
        package_code_at_stamp, was_extra, extra_charge_mxn)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [companyId, invoiceId || null, creditNoteId || null, stampUuid || null,
     pkg.code, isExtra, extraCharge]
  );

  // Si es FLEX, decrementa el prepago.
  if (pkg.code === 'PKG_FLEX') {
    await transactionQuery(
      client,
      `UPDATE prepaid_stamp_balance
          SET balance = GREATEST(0, balance - 1),
              updated_at = NOW()
        WHERE company_id = $1`,
      [companyId]
    );
  }
}

/**
 * Suma timbres a la bolsa prepago (recarga manual del super-admin).
 * Registra la compra en `prepaid_stamp_purchases` para reporte de ingresos.
 * Limpia los flags de "notificado" para que futuras alertas puedan volver a
 * dispararse.
 */
export async function recharge(opts: {
  companyId: string;
  stampsBought: number;
  unitPriceMxn?: number;
  paymentMethod?: string;
  paymentReference?: string;
  notes?: string;
  grantedBy?: string;
}): Promise<{ balanceAfter: number; purchaseId: string }> {
  const unitPrice = opts.unitPriceMxn ?? PREPAID_UNIT_PRICE_MXN;
  const totalMxn = Math.round(opts.stampsBought * unitPrice * 100) / 100;

  // Asegura fila
  await getPrepaidBalance(opts.companyId);

  const purchase = await query<{ id: string }>(
    `INSERT INTO prepaid_stamp_purchases
       (company_id, stamps_bought, unit_price_mxn, total_mxn,
        payment_method, payment_reference, notes, granted_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      opts.companyId, opts.stampsBought, unitPrice, totalMxn,
      opts.paymentMethod || null, opts.paymentReference || null,
      opts.notes || null, opts.grantedBy || null,
    ]
  );

  const balR = await query<{ balance: number }>(
    `UPDATE prepaid_stamp_balance
        SET balance = balance + $2,
            low_notified_at = NULL,
            zero_notified_at = NULL,
            updated_at = NOW()
      WHERE company_id = $1
    RETURNING balance`,
    [opts.companyId, opts.stampsBought]
  );

  logger.info(
    `Prepaid recharge: company=${opts.companyId} +${opts.stampsBought} ` +
    `(unit=${unitPrice}, total=${totalMxn}). New balance=${balR.rows[0].balance}`
  );

  return {
    balanceAfter: Number(balR.rows[0].balance),
    purchaseId: purchase.rows[0].id,
  };
}
