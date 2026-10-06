-- ============================================================================
-- PLD / antilavado (LFPIORPI) — configuración por empresa + expediente de cliente.
--
-- Sólo aplica a empresas que realizan una Actividad Vulnerable del Art. 17. El
-- módulo jala las operaciones de NEXO (facturas) y las cruza contra el umbral
-- (monto en UMA × UMA vigente) para alertar qué exige identificación y qué exige
-- Aviso a la UIF (día 17 del mes siguiente). Ver docs/PLD_LFPIORPI_ANALISIS.md.
-- ============================================================================

CREATE TABLE IF NOT EXISTS pld_config (
  company_id            UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  activo                BOOLEAN NOT NULL DEFAULT FALSE,   -- ¿realiza actividad vulnerable?
  fraccion              VARCHAR(10),                      -- fracción Art. 17 (I..XVI, 'V Bis')
  representante_nombre  VARCHAR(160),                     -- Representante Encargado de Cumplimiento (Art. 20)
  representante_rfc     VARCHAR(13),
  padron_folio          VARCHAR(60),                      -- folio/alta en el padrón SPPLD (informativo)
  padron_alta           DATE,
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Expediente Único de Identificación por cliente (Reglas Art. 12, Anexos 2/3).
CREATE TABLE IF NOT EXISTS pld_expediente (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id                UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id               UUID REFERENCES customers(id) ON DELETE SET NULL,
  rfc                       VARCHAR(13) NOT NULL,
  nombre                    VARCHAR(200),
  tipo_persona              VARCHAR(10),                  -- FISICA | MORAL
  completo                  BOOLEAN NOT NULL DEFAULT FALSE,
  beneficiario_controlador  VARCHAR(200),
  datos                     JSONB,                        -- campos del Anexo 2/3
  actualizado_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, rfc)
);
CREATE INDEX IF NOT EXISTS idx_pld_expediente_company ON pld_expediente(company_id);
