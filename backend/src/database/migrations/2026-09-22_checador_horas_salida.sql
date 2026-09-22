-- ============================================================================
-- CHECADOR — horas mínimas entre ENTRADA y SALIDA, CONFIGURABLE por empresa
--
-- Antes eran 3 horas FIJAS en el código para aceptar la checada de salida. Ahora
-- el usuario define «a las cuántas horas» se acepta la salida, desde
-- Checador → Configuración (por centro de trabajo / empresa). Default 3 para no
-- cambiar el comportamiento de quien no lo toque.
-- ============================================================================

ALTER TABLE checador_config
  ADD COLUMN IF NOT EXISTS horas_min_salida NUMERIC(3,1) NOT NULL DEFAULT 3;

COMMENT ON COLUMN checador_config.horas_min_salida IS
  'Horas mínimas que deben pasar tras la ENTRADA para aceptar la SALIDA. Configurable (default 3).';
