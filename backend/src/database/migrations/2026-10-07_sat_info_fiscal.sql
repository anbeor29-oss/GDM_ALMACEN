-- ============================================================================
-- Información fiscal (JSON de la CIEC) GUARDADA por empresa.
--
-- Antes se consultaba en vivo cada vez. Ahora se guarda al consultar, se PRESENTA
-- de ahí en adelante sin volver a pedirla, y se ACTUALIZA sólo a clic (igual que
-- "lo que ya bajaste queda" de las declaraciones). Una fila por empresa.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sat_info_fiscal (
  company_id      UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  data            JSONB NOT NULL,
  actualizado_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
