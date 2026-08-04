-- ============================================================================
-- UN PAGO PUEDE LIQUIDAR VARIAS FACTURAS
--
-- POR QUÉ
-- `payments.invoice_id` es una sola columna, así que un depósito que cubre tres
-- facturas obligaba a registrar tres pagos y a consumir TRES timbres — cuando el
-- SAT admite un solo CFDI tipo P con varios DoctoRelacionado. Además cada uno
-- llevaba su propio folio, de modo que el cliente recibía tres comprobantes por
-- un movimiento bancario que fue uno.
--
-- Esta tabla guarda el desglose: qué facturas cubre un pago y cuánto abona a
-- cada una.
--
-- `payments.invoice_id` NO SE BORRA
-- Se conserva apuntando a la PRIMERA factura del pago. Dos razones:
--
--   · Los pagos ya registrados —todos, hasta hoy— sólo existen ahí. Migrarlos y
--     quitar la columna en el mismo paso dejaría sin respaldo si algo sale mal.
--   · Media docena de consultas la usan para resolver "de qué factura es este
--     pago". Cambiarlas todas de golpe, en el código que mueve saldos fiscales,
--     es exactamente el tipo de cambio que conviene hacer por partes.
--
-- Mientras tanto la regla es: si hay filas en payment_invoices, ésas mandan; si
-- no las hay, el pago es de una sola factura y vale invoice_id.
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_invoices (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id   UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,

  -- Cuánto abona ESTE pago a ESTA factura.
  monto        DECIMAL(15,2) NOT NULL CHECK (monto > 0),

  /* Los tres datos que el complemento declara por documento. Se guardan tal
   * como se enviaron al SAT, no se recalculan al consultarlos: el comprobante
   * ya se timbró con estos valores y volver a calcularlos con los saldos de hoy
   * mostraría cifras distintas a las del CFDI. */
  parcialidad      INTEGER       NOT NULL DEFAULT 1,
  saldo_anterior   DECIMAL(15,2) NOT NULL DEFAULT 0,
  saldo_insoluto   DECIMAL(15,2) NOT NULL DEFAULT 0,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Una factura no puede aparecer dos veces en el mismo pago: serían dos
  -- DoctoRelacionado con el mismo IdDocumento, que el SAT rechaza.
  UNIQUE (payment_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_invoices_payment ON payment_invoices(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_invoices_invoice ON payment_invoices(invoice_id);

COMMENT ON TABLE payment_invoices IS
  'Facturas que cubre un complemento de pago. Un CFDI tipo P admite varios '
  'DoctoRelacionado; esta tabla es su equivalente en la base.';
COMMENT ON COLUMN payment_invoices.parcialidad IS
  'NumParcialidad del complemento. Es POR FACTURA, no por pago: el mismo '
  'depósito puede ser la parcialidad 2 de una y la 1 de otra.';

-- ── Migración de los pagos existentes ────────────────────────────────────────
-- Cada pago actual es de una factura, así que le corresponde una fila. Se hace
-- aquí y no en un script aparte para que ninguna consulta nueva encuentre pagos
-- sin desglose.
INSERT INTO payment_invoices (payment_id, invoice_id, monto, parcialidad, saldo_anterior, saldo_insoluto)
SELECT p.id, p.invoice_id, p.payment_amount, 1, 0, 0
  FROM payments p
 WHERE p.invoice_id IS NOT NULL
   AND p.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM payment_invoices pi WHERE pi.payment_id = p.id)
   AND p.payment_amount > 0;
