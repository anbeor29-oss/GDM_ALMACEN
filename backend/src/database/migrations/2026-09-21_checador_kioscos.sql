-- ============================================================================
-- CHECADOR — KIOSKOS con NOMBRE y UBICACIÓN FIJA (centros de trabajo)
--
-- Antes había un solo `radio_kiosco_m` por empresa y ningún punto central: la
-- ubicación del kiosco no se guardaba en ningún lado. Esto permite dar de alta
-- VARIOS kioscos (Kiosko 1, Recepción, Planta Norte…), cada uno con su NOMBRE y
-- sus COORDENADAS fijas (el centro de trabajo donde está la tableta). Cada
-- tableta se amarra a uno (en su localStorage) y cada checada queda ligada a ese
-- kiosco, así el registro dice EN QUÉ CENTRO se marcó.
--
-- No se RECHAZA por lejanía (política del checador): se ACEPTA y se CLASIFICA.
-- El radio queda como metadato (para el modo campo / futuros geocercas).
-- ============================================================================

CREATE TABLE IF NOT EXISTS checador_kioscos (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  nombre      VARCHAR(80) NOT NULL,
  -- Ubicación FIJA del kiosco (el centro de trabajo). NULL hasta que se capture.
  lat         NUMERIC(10,7),
  lng         NUMERIC(10,7),
  -- Radio permitido en metros. NULL = usa checador_config.radio_kiosco_m.
  radio_m     INT,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checador_kioscos_empresa ON checador_kioscos(company_id) WHERE activo;

-- Cada checada puede decir de QUÉ kiosco/centro vino.
ALTER TABLE checador_evento
  ADD COLUMN IF NOT EXISTS kiosco_id UUID REFERENCES checador_kioscos(id) ON DELETE SET NULL;
