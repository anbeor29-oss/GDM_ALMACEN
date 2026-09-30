-- ============================================================================
-- Facturación ESCALONADA por usuarios — los timbres incluidos y el precio del
-- timbre extra CRECEN con el número de usuarios facturables de la empresa.
--
--   Incluidos    = timbres_incluidos (base) + timbres_por_usuario × (usuarios − 1)
--   Timbre extra = timbre_extra_mxn (base) + timbre_extra_por_usuario × (usuarios − 1)
--
--   Nuevo baseline (2026-09-30): $750/usuario · 1,000 timbres base (+500 por usuario)
--   · timbre extra $1.30 base (+$0.20 por usuario). Sube por INPC editando la config.
--   El cobro sigue siendo MENSUAL y sin plazo forzoso (no hay plan anual).
-- ============================================================================

ALTER TABLE facturacion_config ADD COLUMN IF NOT EXISTS timbres_por_usuario INT NOT NULL DEFAULT 500;
ALTER TABLE facturacion_config ADD COLUMN IF NOT EXISTS timbre_extra_por_usuario NUMERIC(10,2) NOT NULL DEFAULT 0.20;

-- Nuevo baseline en el único renglón de config (sustituye $500/2000/2.00).
UPDATE facturacion_config
   SET precio_usuario_mxn = 750.00,
       timbres_incluidos = 1000,
       timbre_extra_mxn = 1.30,
       timbres_por_usuario = 500,
       timbre_extra_por_usuario = 0.20,
       updated_at = NOW()
 WHERE id = 1;
