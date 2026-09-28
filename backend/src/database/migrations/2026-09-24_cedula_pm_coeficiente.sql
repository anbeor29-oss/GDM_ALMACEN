-- ============================================================================
-- CÉDULA PM (601) — COEFICIENTE DE UTILIDAD por empresa y año
--
-- El pago provisional de ISR de una persona MORAL (Régimen General, 601) se
-- calcula con el COEFICIENTE DE UTILIDAD (utilidad fiscal / ingresos nominales del
-- último ejercicio con coeficiente): ingresos nominales acumulados × coeficiente =
-- utilidad estimada; × 30 % = ISR. El coeficiente NO se puede inferir de los CFDI:
-- sale de la declaración ANUAL anterior, así que se CAPTURA por empresa y año.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cedula_pm_coeficiente (
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  anio        INTEGER NOT NULL,
  -- Coeficiente de utilidad a 4 decimales (p. ej. 0.1234). Del ejercicio anterior.
  coeficiente NUMERIC(6,4) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, anio)
);
