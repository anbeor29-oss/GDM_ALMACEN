/**
 * Treasury Service — programación de pagos a proveedores (Fase 6 ALMACEN).
 *
 *  Opera sobre `supplier_payments_schedule` (creada en Fase 2, poblada por el
 *  import de compras XML). El módulo permite ver los pagos por semana,
 *  marcarlos pagados (liberando la línea de crédito del proveedor),
 *  reprogramarlos, cancelarlos y dar de alta pagos manuales.
 *
 *  Regla de dinero (lección GDM_FAC): credit_used nunca queda negativo —
 *  se libera con GREATEST(credit_used - amount, 0) dentro de la misma TX.
 */

import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError, ConflictError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

export interface PaymentFilters {
  status?: 'PENDING' | 'PAID' | 'CANCELLED';
  supplierId?: string;
  from?: string;
  to?: string;
}

/** Lista de pagos con datos del proveedor y "bucket" temporal para la UI. */
export async function listPayments(companyId: string, filters: PaymentFilters = {}) {
  const params: any[] = [companyId];
  const where = ['sp.company_id = $1'];
  if (filters.status) {
    params.push(filters.status);
    where.push(`sp.status = $${params.length}`);
  } else {
    where.push(`sp.status = 'PENDING'`);   // default: lo que falta pagar
  }
  if (filters.supplierId) {
    params.push(filters.supplierId);
    where.push(`sp.supplier_id = $${params.length}`);
  }
  if (filters.from) { params.push(filters.from); where.push(`sp.due_date >= $${params.length}::date`); }
  if (filters.to)   { params.push(filters.to);   where.push(`sp.due_date <= $${params.length}::date`); }

  const r = await query<any>(
    `SELECT sp.id, sp.amount, sp.due_date, sp.status, sp.paid_at, sp.notes,
            sp.created_at, sp.xml_import_id,
            c.id AS supplier_id, c.business_name AS supplier_name, c.rfc AS supplier_rfc,
            c.credit_days, c.credit_line, c.credit_used,
            -- Semáforo temporal: vencido / esta semana / próximo
            CASE
              WHEN sp.status != 'PENDING'                       THEN 'DONE'
              WHEN sp.due_date < CURRENT_DATE                   THEN 'OVERDUE'
              WHEN sp.due_date <= CURRENT_DATE + 7              THEN 'THIS_WEEK'
              ELSE 'UPCOMING'
            END AS bucket,
            (sp.due_date - CURRENT_DATE) AS days_to_due
       FROM supplier_payments_schedule sp
       JOIN customers c ON c.id = sp.supplier_id
      WHERE ${where.join(' AND ')}
      ORDER BY sp.due_date ASC, sp.created_at ASC`,
    params
  );
  return r.rows;
}

/** Resumen para el dashboard de tesorería. */
export async function getSummary(companyId: string) {
  const r = await query<any>(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE status='PENDING' AND due_date < CURRENT_DATE), 0)        AS overdue_amount,
       COUNT(*)      FILTER (WHERE status='PENDING' AND due_date < CURRENT_DATE)                    AS overdue_count,
       COALESCE(SUM(amount) FILTER (WHERE status='PENDING' AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7), 0) AS week_amount,
       COUNT(*)      FILTER (WHERE status='PENDING' AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)            AS week_count,
       COALESCE(SUM(amount) FILTER (WHERE status='PENDING'), 0)                                     AS pending_total,
       COUNT(*)      FILTER (WHERE status='PENDING')                                                AS pending_count
     FROM supplier_payments_schedule
     WHERE company_id = $1`,
    [companyId]
  );
  return r.rows[0];
}

/** Marca un pago como PAGADO y libera la línea de crédito del proveedor. */
export async function markPaid(
  companyId: string,
  paymentId: string,
  opts: { paidAt?: string; notes?: string }
): Promise<any> {
  return transaction(async (client) => {
    const r = await transactionQuery<any>(
      client,
      `SELECT id, supplier_id, amount, status FROM supplier_payments_schedule
        WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [paymentId, companyId]
    );
    if (r.rows.length === 0) throw new NotFoundError('Pago no encontrado');
    const p = r.rows[0];
    if (p.status !== 'PENDING') throw new ConflictError(`El pago ya está ${p.status}`);

    const upd = await transactionQuery<any>(
      client,
      `UPDATE supplier_payments_schedule
          SET status = 'PAID',
              paid_at = COALESCE($1::timestamp, NOW()),
              notes = COALESCE($2, notes)
        WHERE id = $3
        RETURNING id, amount, due_date, status, paid_at`,
      [opts.paidAt || null, opts.notes || null, paymentId]
    );

    // Liberar crédito usado (nunca negativo)
    await transactionQuery(
      client,
      `UPDATE customers
          SET credit_used = GREATEST(COALESCE(credit_used, 0) - $1, 0), updated_at = NOW()
        WHERE id = $2`,
      [p.amount, p.supplier_id]
    );

    logger.info(`[treasury] Pago ${paymentId} marcado PAID ($${p.amount}) — crédito liberado`);
    return upd.rows[0];
  });
}

/** Reprograma la fecha de vencimiento de un pago pendiente. */
export async function reschedule(companyId: string, paymentId: string, newDueDate: string): Promise<any> {
  if (!newDueDate) throw new ValidationError('Nueva fecha de vencimiento requerida');
  const r = await query<any>(
    `UPDATE supplier_payments_schedule
        SET due_date = $1::date
      WHERE id = $2 AND company_id = $3 AND status = 'PENDING'
      RETURNING id, amount, due_date, status`,
    [newDueDate, paymentId, companyId]
  );
  if (r.rows.length === 0) {
    throw new NotFoundError('Pago pendiente no encontrado (¿ya pagado o cancelado?)');
  }
  return r.rows[0];
}

/** Cancela un pago programado y libera el crédito. */
export async function cancelPayment(companyId: string, paymentId: string, motivo?: string): Promise<any> {
  return transaction(async (client) => {
    const r = await transactionQuery<any>(
      client,
      `SELECT id, supplier_id, amount, status FROM supplier_payments_schedule
        WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [paymentId, companyId]
    );
    if (r.rows.length === 0) throw new NotFoundError('Pago no encontrado');
    const p = r.rows[0];
    if (p.status !== 'PENDING') throw new ConflictError(`El pago ya está ${p.status}`);

    const upd = await transactionQuery<any>(
      client,
      `UPDATE supplier_payments_schedule
          SET status = 'CANCELLED',
              notes = COALESCE(notes, '') || $1
        WHERE id = $2
        RETURNING id, status`,
      [`\n[Cancelado ${new Date().toISOString().slice(0, 10)}]${motivo ? ' — ' + motivo : ''}`, paymentId]
    );
    await transactionQuery(
      client,
      `UPDATE customers SET credit_used = GREATEST(COALESCE(credit_used, 0) - $1, 0) WHERE id = $2`,
      [p.amount, p.supplier_id]
    );
    return upd.rows[0];
  });
}

/** Alta manual de un pago programado (compra sin XML, anticipo, etc.). */
export async function createManual(
  companyId: string,
  data: { supplierId: string; amount: number; dueDate: string; notes?: string }
): Promise<any> {
  const amount = Number(data.amount);
  if (!data.supplierId) throw new ValidationError('supplierId requerido');
  if (!amount || amount <= 0) throw new ValidationError('El monto debe ser mayor a cero');
  if (!data.dueDate) throw new ValidationError('Fecha de vencimiento requerida');

  return transaction(async (client) => {
    const sup = await transactionQuery(
      client,
      `SELECT id FROM customers
        WHERE id = $1 AND company_id = $2 AND party_type = 'SUPPLIER' AND deleted_at IS NULL`,
      [data.supplierId, companyId]
    );
    if (sup.rows.length === 0) throw new NotFoundError('Proveedor no encontrado');

    const ins = await transactionQuery<any>(
      client,
      `INSERT INTO supplier_payments_schedule
         (company_id, supplier_id, amount, due_date, notes)
       VALUES ($1, $2, $3, $4::date, $5)
       RETURNING id, amount, due_date, status`,
      [companyId, data.supplierId, amount, data.dueDate, data.notes || 'Alta manual']
    );
    // Suma a la línea de crédito usada
    await transactionQuery(
      client,
      `UPDATE customers SET credit_used = COALESCE(credit_used, 0) + $1 WHERE id = $2`,
      [amount, data.supplierId]
    );
    return ins.rows[0];
  });
}
