-- ============================================================================
-- OPINIÓN DE CUMPLIMIENTO — SAT (32-D), IMSS y INFONAVIT
--
-- La «opinión del cumplimiento de obligaciones» (Art. 32-D CFF para el SAT, y sus
-- equivalentes de IMSS e INFONAVIT) dice si la empresa está al corriente. Aquí se
-- REGISTRA y da SEGUIMIENTO a las tres: su sentido (Positiva/Negativa/etc.), la
-- fecha, el folio y el PDF obtenido. La descarga automática (Buzón/e.firma) es una
-- fase posterior; por ahora se captura lo que se obtiene del portal de cada quien.
--
-- Se conserva el HISTÓRICO (una empresa saca la opinión seguido); la más reciente
-- por tipo es la vigente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS opinion_cumplimiento (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- SAT (32-D) | IMSS | INFONAVIT
  tipo          VARCHAR(10) NOT NULL CHECK (tipo IN ('SAT','IMSS','INFONAVIT')),
  -- Sentido de la opinión. POSITIVA = al corriente; NEGATIVA = con adeudos;
  -- SIN_ADEUDOS lo usan IMSS/INFONAVIT; OTRO para casos raros.
  sentido       VARCHAR(12) NOT NULL DEFAULT 'POSITIVA'
                  CHECK (sentido IN ('POSITIVA','NEGATIVA','SIN_ADEUDOS','SUSPENDIDA','OTRO')),
  fecha_opinion DATE NOT NULL,
  folio         VARCHAR(80),
  observaciones TEXT,
  -- PDF de la opinión, como data-URL base64 (documento chico). Opcional.
  pdf           TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_opinion_cumpl_empresa
  ON opinion_cumplimiento(company_id, tipo, fecha_opinion DESC);
