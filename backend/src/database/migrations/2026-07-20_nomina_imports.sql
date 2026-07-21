-- ============================================================================
-- Migración: metadata de XMLs de Nómina 1.2 detectados por el super-importer.
--
-- El complemento Nómina tiene MUCHA información (percepciones, deducciones,
-- otros pagos, incapacidades, subsidios, horas extra, tipo de contrato, etc.)
-- que HCGM todavía NO va a procesar como facturas de nómina reales.
--
-- Por ahora guardamos SOLO metadata clave para poder:
--   · Filtrar duplicados por (rfc_emisor, uuid) — el UUID del timbre.
--   · Reportar volumen de recibos de nómina recibidos en el mes.
--   · Cuando llegue el momento, se agrega otra tabla para el detalle.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS nomina_imports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  uuid               VARCHAR(36) NOT NULL,                 -- TFD UUID
  rfc_emisor         VARCHAR(13) NOT NULL,
  nombre_emisor      VARCHAR(300),
  rfc_receptor       VARCHAR(13) NOT NULL,
  nombre_receptor    VARCHAR(300),
  fecha_pago         DATE,
  fecha_inicial_pago DATE,
  fecha_final_pago   DATE,
  num_dias_pagados   NUMERIC(6,3),
  tipo_nomina        VARCHAR(2),                           -- 'O' Ordinaria | 'E' Extraordinaria
  total_percepciones NUMERIC(14,2),
  total_deducciones  NUMERIC(14,2),
  total_otros_pagos  NUMERIC(14,2),
  total_neto         NUMERIC(14,2),
  xml_blob           TEXT NOT NULL,                        -- XML íntegro para futuro procesamiento
  xml_sha256         VARCHAR(64) NOT NULL,                 -- dedup exact
  imported_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (company_id, uuid)
);
CREATE INDEX IF NOT EXISTS ix_nomina_imports_company ON nomina_imports(company_id, fecha_pago DESC);
CREATE INDEX IF NOT EXISTS ix_nomina_imports_receptor ON nomina_imports(company_id, rfc_receptor);

COMMENT ON TABLE nomina_imports IS
  'Metadata de XMLs de Nómina 1.2 detectados; el detalle se procesará en fase posterior.';

COMMIT;
