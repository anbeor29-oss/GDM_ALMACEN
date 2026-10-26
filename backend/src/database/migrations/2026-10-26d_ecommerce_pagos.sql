-- Comercio Electrónico — rebanada 5: pago (pasarela Mercado Pago) + pedido→CFDI.
-- Al aprobarse el pago se consume la reserva y el pedido se factura con el motor
-- de CFDI existente (que ya indexa en la bóveda y genera la póliza).

ALTER TABLE ec_order
  ADD COLUMN IF NOT EXISTS invoice_id   UUID REFERENCES invoices(id),
  ADD COLUMN IF NOT EXISTS pagado_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS facturado_at TIMESTAMPTZ;

-- Operaciones de la pasarela (auditoría + idempotencia por payment_id).
CREATE TABLE IF NOT EXISTS ec_payment_transaction (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id      UUID NOT NULL REFERENCES ec_store(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES ec_order(id) ON DELETE CASCADE,
  proveedor     TEXT NOT NULL DEFAULT 'mercadopago',
  estado        TEXT NOT NULL DEFAULT 'PENDIENTE',   -- PENDIENTE→APROBADO/RECHAZADO/REEMBOLSADO
  monto         NUMERIC(14,2) NOT NULL,
  moneda        TEXT NOT NULL DEFAULT 'MXN',
  preference_id TEXT,                                -- id de la preferencia de checkout
  payment_id    TEXT,                                -- id del pago (del webhook)
  raw           JSONB,                               -- payload crudo (auditoría)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ec_paytx_order ON ec_payment_transaction (order_id);
-- Un pago de la pasarela se procesa UNA vez (idempotencia del webhook).
CREATE UNIQUE INDEX IF NOT EXISTS ux_ec_paytx_payment ON ec_payment_transaction (payment_id) WHERE payment_id IS NOT NULL;
