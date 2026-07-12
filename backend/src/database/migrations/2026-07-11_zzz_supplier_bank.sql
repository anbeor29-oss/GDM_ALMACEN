-- ================================================================
-- PROVEEDORES — Datos bancarios para depósito (compra EXPRESS)
--
-- Los proveedores viven en `customers` (party_type='SUPPLIER', STI). Estos
-- campos guardan la cuenta a la que se le DEPOSITA al proveedor, para tener
-- todo listo al pagar una compra express. Aplican también a clientes que
-- reciban devoluciones, pero su uso principal es proveedor.
-- ================================================================
-- Idempotente y autosuficiente en BD virgen (regla 26).

ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_code           VARCHAR(3);   -- clave CNBV/ABM de 3 dígitos
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_name           VARCHAR(100); -- nombre del banco
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_account        VARCHAR(20);  -- número de cuenta
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_clabe          VARCHAR(18);  -- CLABE interbancaria (18 dígitos)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_account_holder VARCHAR(255); -- beneficiario / titular

COMMENT ON COLUMN customers.bank_clabe IS
  'CLABE interbancaria de 18 dígitos — para transferencias SPEI al proveedor';
COMMENT ON COLUMN customers.bank_code IS
  'Clave de 3 dígitos del banco según CNBV/ABM (los 3 primeros de la CLABE)';
