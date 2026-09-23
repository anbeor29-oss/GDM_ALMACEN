-- ============================================================================
-- CUMPLIMIENTO — CSF y CONFIGURACIÓN de la descarga automática
--
-- 1) Se agrega el tipo CSF (Constancia de Situación Fiscal) al tracker de
--    opiniones (además de SAT 32-D, IMSS, INFONAVIT), y el sentido VIGENTE
--    (la CSF no es Positiva/Negativa: sólo está vigente).
--
-- 2) Configuración por empresa y dependencia para AUTOMATIZAR la descarga:
--    el endpoint (URL), el usuario y la contraseña/token — estos ÚLTIMOS
--    CIFRADOS con la bóveda (SAT_VAULT_KEY), nunca en claro. Es lo que el
--    usuario pidió capturar «desde el http hasta usuarios y contraseñas».
-- ============================================================================

-- 1. Ampliar el tracker con CSF y el sentido VIGENTE.
ALTER TABLE opinion_cumplimiento DROP CONSTRAINT IF EXISTS opinion_cumplimiento_tipo_check;
ALTER TABLE opinion_cumplimiento
  ADD CONSTRAINT opinion_cumplimiento_tipo_check CHECK (tipo IN ('SAT','IMSS','INFONAVIT','CSF'));
ALTER TABLE opinion_cumplimiento DROP CONSTRAINT IF EXISTS opinion_cumplimiento_sentido_check;
ALTER TABLE opinion_cumplimiento
  ADD CONSTRAINT opinion_cumplimiento_sentido_check
    CHECK (sentido IN ('POSITIVA','NEGATIVA','SIN_ADEUDOS','SUSPENDIDA','VIGENTE','OTRO'));

-- 2. Configuración de la descarga automática (una por empresa+tipo).
CREATE TABLE IF NOT EXISTS cumplimiento_config (
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tipo        VARCHAR(10) NOT NULL CHECK (tipo IN ('SAT','IMSS','INFONAVIT','CSF')),
  -- Cómo se obtiene: PORTAL (se navega el sitio) | API (proveedor externo) |
  -- EFIRMA (flujo oficial con la e.firma ya guardada en la bóveda).
  metodo      VARCHAR(10) NOT NULL DEFAULT 'API' CHECK (metodo IN ('PORTAL','API','EFIRMA')),
  base_url    TEXT,                 -- endpoint / URL del portal o del proveedor
  usuario     TEXT,                 -- usuario / RFC (no secreto)
  -- Secretos CIFRADOS con boveda.cifrar (SAT_VAULT_KEY). NUNCA en claro.
  credencial  TEXT,                 -- contraseña / CIEC cifrada
  token       TEXT,                 -- API key / token cifrado
  extra       JSONB,                -- headers/params adicionales del proveedor
  activo      BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, tipo)
);
