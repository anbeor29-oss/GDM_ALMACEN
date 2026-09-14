-- ============================================================================
-- Cuentas fijas configurables de Cobros y pagos (provisiones de IVA + banco).
--
-- El motor de cobros/pagos resolvía estas cuentas SOLO por su código agrupador
-- del Anexo 24 (208.01, 209.01, 118.01, 119.01, 102.01). En un catálogo que no
-- usa la numeración del SAT, ninguna cuenta calzaba y la póliza se omitía.
--
-- Aquí el usuario ASIGNA, por rol (agrupador), qué cuenta de SU catálogo se usa.
-- `cuentaPorAgrupador` (polizas.service) consulta primero este override y sólo
-- si no hay, cae al agrupador. Así funciona con cualquier catálogo.
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounting_cuentas_fijas (
  company_id UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agrupador  VARCHAR(10) NOT NULL,   -- el rol: 208.01 / 209.01 / 118.01 / 119.01 / 102.01…
  account_id UUID        NOT NULL REFERENCES accounting_accounts(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, agrupador)
);
