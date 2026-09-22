-- ============================================================================
-- RECUPERACIÓN CPQ — bóveda de XML desde un respaldo .zip de CPQ
--
-- El motor recupera los XML/CFDI de un respaldo (sueltos y los embebidos en
-- binarios) y los INGRESA a la bóveda existente `cfdi_recibidos` con `indexarCfdi`,
-- así aparecen SOLOS en el calendario y en todo lo que lee esa tabla. Aquí sólo se
-- guarda la BITÁCORA de cada corrida (trazabilidad: de qué archivo salieron, cuántos).
-- No se toca el respaldo original; la ingesta es idempotente por UUID.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cpq_recuperacion_corridas (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  archivo        TEXT NOT NULL,          -- nombre del .zip procesado
  sha256         TEXT,                   -- huella del .zip (evidencia de origen)
  bytes          BIGINT,
  xml_encontrados INT NOT NULL DEFAULT 0,
  cfdi_validos   INT NOT NULL DEFAULT 0,
  nuevos         INT NOT NULL DEFAULT 0, -- CFDI que NO estaban ya en la bóveda
  duplicados     INT NOT NULL DEFAULT 0,
  emitidos       INT NOT NULL DEFAULT 0,
  recibidos      INT NOT NULL DEFAULT 0,
  nomina         INT NOT NULL DEFAULT 0,
  contab_electronica INT NOT NULL DEFAULT 0,  -- Balanza/Pólizas/Catálogo detectados (no CFDI)
  no_cfdi        INT NOT NULL DEFAULT 0, -- XML que no eran CFDI
  resumen        JSONB,                  -- desglose por tipo, errores, etc.
  usuario_id     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cpq_recuperacion_empresa ON cpq_recuperacion_corridas(company_id, created_at DESC);
