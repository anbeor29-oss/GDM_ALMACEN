-- ============================================================================
-- SUBCUENTAS POR TERCERO — el número contable de cada cliente y proveedor
--
-- Bajo la cuenta de control (105.01 Clientes nacionales, 201.01 Proveedores
-- nacionales, y sus pares de extranjeros) cuelga una subcuenta por cada tercero,
-- numerada con la máscara 000-00-000: 105-01-001, 105-01-002, … según van
-- apareciendo. `tercero_rfc` es lo que amarra la subcuenta a su cliente/proveedor
-- para que la póliza sepa cuál usar y para no crearla dos veces.
--
-- La cuenta de control deja de recibir movimientos cuando le nace la primera
-- subcuenta: los movimientos van SIEMPRE a la hoja (el tercero), nunca al control.
-- ============================================================================

ALTER TABLE accounting_accounts
  ADD COLUMN IF NOT EXISTS tercero_rfc VARCHAR(13);

CREATE INDEX IF NOT EXISTS ix_ctas_tercero
  ON accounting_accounts (company_id, parent_id, tercero_rfc)
  WHERE tercero_rfc IS NOT NULL;

COMMENT ON COLUMN accounting_accounts.tercero_rfc IS
  'RFC del cliente/proveedor de una subcuenta auxiliar (máscara 000-00-000). '
  'NULL en las cuentas de catálogo normales.';
