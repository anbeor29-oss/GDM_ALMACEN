-- ═══════════════════════════════════════════════════════════════════════════
-- CONCILIACIÓN BANCO → CONTABILIDAD
--
-- La contabilidad se arma CUADRANDO el estado de cuenta del banco contra los XML
-- y la cuenta que corresponda. Para eso el movimiento del banco necesita recordar
-- con qué XML casó, contra qué cuenta va y qué póliza generó; la cuenta bancaria
-- necesita saber su cuenta contable (102-xx); y la empresa, a qué cuentas mandar
-- las comisiones y su IVA (se eligen una vez y se aplican a todas).
--
-- Idempotente y autosuficiente en BD virgen (regla 26).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. La cuenta contable (102-xx) de cada cuenta bancaria.
ALTER TABLE bancos_cuentas
  ADD COLUMN IF NOT EXISTS cuenta_contable_id UUID REFERENCES accounting_accounts(id);

COMMENT ON COLUMN bancos_cuentas.cuenta_contable_id IS
  'Cuenta de mayor del banco (102-xx). Es el cargo/abono del lado banco en cada póliza de conciliación.';

-- 2. El resultado de conciliar cada movimiento del banco.
ALTER TABLE bancos_movimientos
  ADD COLUMN IF NOT EXISTS clasificacion   VARCHAR(16),   -- cobro | pago | comision | iva_comision | traspaso | otro
  ADD COLUMN IF NOT EXISTS cfdi_uuid       VARCHAR(40),   -- el XML con que casó (si aplica)
  ADD COLUMN IF NOT EXISTS contra_cuenta_id UUID REFERENCES accounting_accounts(id), -- la contraparte contable
  ADD COLUMN IF NOT EXISTS poliza_id       UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS concil_estado   VARCHAR(16) NOT NULL DEFAULT 'pendiente', -- pendiente | sugerido | confirmado | contabilizado | omitido
  ADD COLUMN IF NOT EXISTS concil_diff     NUMERIC(16,2); -- diferencia importe banco vs XML (para el ±10¢)

CREATE INDEX IF NOT EXISTS bancos_movimientos_concil_ix
  ON bancos_movimientos (estado_id, concil_estado);

COMMENT ON COLUMN bancos_movimientos.concil_estado IS
  'pendiente (sin analizar) · sugerido (match dudoso ±10¢, confirmar) · confirmado '
  '(match exacto, listo) · contabilizado (ya tiene póliza) · omitido (el usuario dijo que no).';

-- 3. Las cuentas de comisiones e IVA de comisiones de la empresa (una vez).
CREATE TABLE IF NOT EXISTS bancos_config (
  company_id            UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  cuenta_comisiones_id  UUID REFERENCES accounting_accounts(id),
  cuenta_iva_comisiones_id UUID REFERENCES accounting_accounts(id),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE bancos_config IS
  'Cuentas fijas de la empresa para conciliación: comisiones bancarias y su IVA '
  'acreditable. Se eligen una vez y se aplican a todas las comisiones detectadas.';
