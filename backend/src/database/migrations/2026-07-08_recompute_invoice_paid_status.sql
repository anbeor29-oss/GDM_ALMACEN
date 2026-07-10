-- ===================================================================
-- Fecha: 2026-07-08
-- Motivo: el service de pagos comparaba pagos vs total sin considerar
-- las NC ya aplicadas, dejando en PARTIAL_PAYMENT facturas cuyo saldo
-- real ya era 0. Esta migración corrige el estado histórico de
-- facturas que quedaron en PARTIAL_PAYMENT/STAMPED/SENT pero cuyo
-- (pagos + NC) ≥ total (tolerancia 1 centavo). Es one-shot: solo
-- baja PARTIAL_PAYMENT → PAID cuando el saldo real es 0. Nunca
-- reabre una PAID ni toca CANCELLED / DRAFT.
-- ===================================================================

UPDATE invoices i
   SET status = 'PAID', updated_at = NOW()
  FROM (
    SELECT
      inv.id,
      inv.total::numeric AS total,
      COALESCE((
        SELECT SUM(payment_amount)::numeric
          FROM payments
         WHERE invoice_id = inv.id AND deleted_at IS NULL
      ), 0) AS paid,
      COALESCE((
        SELECT SUM(total)::numeric
          FROM credit_notes
         WHERE invoice_id = inv.id
           AND deleted_at IS NULL
           AND status != 'CANCELLED'
      ), 0) AS credited
    FROM invoices inv
    WHERE inv.deleted_at IS NULL
      AND inv.status IN ('SENT', 'STAMPED', 'PARTIAL_PAYMENT')
  ) s
 WHERE i.id = s.id
   AND (s.paid + s.credited) >= (s.total - 0.01);
