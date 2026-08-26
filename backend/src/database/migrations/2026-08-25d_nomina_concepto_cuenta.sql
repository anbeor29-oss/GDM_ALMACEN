-- ============================================================================
-- MAPEO CONCEPTO DE NÓMINA → CUENTA (para la póliza de pasivo)
--
-- La lista de conceptos vive en código (nomina-conceptos.data.ts, las claves del
-- Anexo 20). Aquí sólo se guarda la CUENTA que el usuario le asigna a cada uno,
-- por empresa. Con este mapeo, la póliza de nómina coloca cada importe —que el
-- motor ya calculó— en su cuenta, y sale exacta.
-- ============================================================================

CREATE TABLE IF NOT EXISTS nomina_concepto_cuenta (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  grupo         VARCHAR(12) NOT NULL,     -- PERCEPCION | DEDUCCION | NETO | PROVISION
  clave         VARCHAR(16) NOT NULL,     -- c_TipoPercepcion/Deduccion, o clave interna
  cuenta_codigo VARCHAR(40),              -- la cuenta del catálogo asignada

  updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE (company_id, grupo, clave)
);

COMMENT ON TABLE nomina_concepto_cuenta IS
  'Cuenta contable asignada a cada concepto de nómina, por empresa. La lista de '
  'conceptos es de código; aquí sólo vive la asignación.';
