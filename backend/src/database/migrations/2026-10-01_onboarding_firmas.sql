-- ============================================================
-- Avisos al dueño cuando una empresa FIRMA el contrato
-- ============================================================
-- Al firmar, se libera todo y hay que ACTUAR: elaborar su factura y pasarla a su
-- ambiente real (PRODUCCIÓN). Esta tabla es la bandeja del súper admin con esas
-- firmas pendientes de atención.
CREATE TABLE IF NOT EXISTS onboarding_firmas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES companies(id) ON DELETE CASCADE,
  rfc           VARCHAR(13),
  business_name VARCHAR(255),
  signed_at     TIMESTAMPTZ,
  estado        VARCHAR(16) NOT NULL DEFAULT 'PENDIENTE',   -- PENDIENTE | ATENDIDA
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS onboarding_firmas_estado_idx ON onboarding_firmas (estado, created_at DESC);
