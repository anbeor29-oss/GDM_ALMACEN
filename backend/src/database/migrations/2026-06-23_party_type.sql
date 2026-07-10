-- Single-Table Inheritance para customers vs suppliers.
--
--  Decisión: NO crear una tabla 'suppliers' separada — los flujos contables
--  (CFDI tipo I emitido, NC, pagos, balance) se aplican igual a un cliente
--  que paga, y a futuro un proveedor al que pagamos. Compartir el modelo evita
--  duplicar índices, foreign keys, audit_log, etc.
--
--  party_type discrimina:
--    · CUSTOMER → tercero al que YO le facturo (default histórico)
--    · SUPPLIER → tercero que ME factura
--
--  Idempotente: NOT EXISTS + DEFAULT.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS party_type VARCHAR(16) NOT NULL DEFAULT 'CUSTOMER';

-- Constraint blando (no rompe registros viejos) — solo valida nuevos
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_party_type;
ALTER TABLE customers ADD CONSTRAINT chk_party_type
  CHECK (party_type IN ('CUSTOMER', 'SUPPLIER'));

-- Índice para listados rápidos en pantallas separadas
CREATE INDEX IF NOT EXISTS idx_customers_party_type
  ON customers (company_id, party_type)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN customers.party_type IS
  'CUSTOMER = se le emite factura | SUPPLIER = nos emite factura. Discriminador STI.';
