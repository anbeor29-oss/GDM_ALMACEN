-- ============================================================================
-- SatGo — proveedor fiscal (CIF/CSF, Opinión 32-D, OC IMSS, Declaraciones, etc.).
--
-- Auth de SatGo en dos pasos:
--   1) POST /api/v1/Users/CreateKey  (token del portal → API Key PERMANENTE)
--   2) POST /api/Auth/token          (API Key → JWT de corta duración, Bearer)
-- La AUTORIZACIÓN por RFC va aparte: header `Secret` (CIEC) o FIEL (.cer/.key/clave).
--
-- Aquí se guarda la config a NIVEL CUENTA (una sola fila): la URL base y la API
-- Key PERMANENTE (cifrada con la bóveda SAT_VAULT_KEY). El JWT corto NO se guarda:
-- se genera al vuelo y se cachea en memoria. Las credenciales por RFC (CIEC/e.firma)
-- viven en cumplimiento_config / la bóveda, como hasta ahora.
-- ============================================================================

CREATE TABLE IF NOT EXISTS satgo_config (
  id         INT PRIMARY KEY DEFAULT 1,
  base_url   TEXT,                       -- URL base de la API de SatGo (prod/preprod)
  api_key    TEXT,                       -- API Key PERMANENTE, CIFRADA (del CreateKey)
  ambiente   VARCHAR(12) DEFAULT 'PRUEBAS',  -- PRUEBAS | PRODUCCION (informativo)
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT satgo_config_una_fila CHECK (id = 1)
);
INSERT INTO satgo_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
