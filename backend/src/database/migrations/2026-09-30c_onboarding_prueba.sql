-- ============================================================
-- Onboarding de prueba (alta pública self-service, 72 h)
-- ============================================================
-- El prospecto se da de alta solo en la pantalla pública; la empresa nace en
-- MODO PRUEBA con `prueba_inicio = NOW()`. Tiene 72 h para explorar (sin timbrar
-- real). Al vencer, se bloquea salvo que firme el contrato con e.firma. NULL =
-- la empresa NO es un alta de prueba (las que ya operan o se dieron de alta por
-- el súper admin no se tocan). Los RFC "ocultos" (GHC1707275Y0, AABA020418BW2)
-- nunca se bloquean — eso se resuelve en código, no aquí.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS prueba_inicio TIMESTAMPTZ;
COMMENT ON COLUMN companies.prueba_inicio IS
  'Inicio de la prueba de 72 h (alta pública). NULL = no es alta de prueba.';

-- Solicitudes de "demostración en línea" que el prospecto pide durante la prueba.
CREATE TABLE IF NOT EXISTS demo_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
  rfc         VARCHAR(13),
  contacto    VARCHAR(160),
  correo      VARCHAR(160),
  telefono    VARCHAR(40),
  mensaje     TEXT,
  estado      VARCHAR(16) NOT NULL DEFAULT 'PENDIENTE',   -- PENDIENTE | ATENDIDA
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS demo_requests_estado_idx ON demo_requests (estado, created_at DESC);
