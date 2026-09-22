-- ============================================================================
-- CHECADOR — regla configurable "N retardos = 1 falta"
--
-- Hasta ahora los retardos sólo se DETECTABAN (informativos) porque no había
-- una regla de descuento. Esto la vuelve CONFIGURABLE por empresa, en la misma
-- Configuración del checador (junto a la tolerancia): si retardos_por_falta > 0,
-- cada N retardos ACUMULADOS del periodo cuentan como 1 falta extra (deducción
-- 020, en días con séptimo). NULL o 0 = como antes, sólo informativos.
--
-- El usuario lo define (check + de 1 a 5); el código NO asume ningún valor.
-- ============================================================================

ALTER TABLE checador_config
  ADD COLUMN IF NOT EXISTS retardos_por_falta INT;

COMMENT ON COLUMN checador_config.retardos_por_falta IS
  'Si >0, cada N retardos del periodo cuentan como 1 falta (deducción 020). NULL/0 = sólo informativos.';
