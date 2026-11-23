-- ============================================================================
-- CHECADOR · CONSENTIMIENTO BIOMÉTRICO — la EVIDENCIA libera el enrolamiento
--
-- POR QUÉ
-- El consentimiento se otorgaba con una PALOMITA en pantalla. Para un dato
-- personal SENSIBLE (art. 3 fr. VI LFPDPPP) la ley pide consentimiento
-- EXPRESO Y POR ESCRITO: una palomita no es prueba de nada el día de una
-- inspección o una queja ante el INAI.
--
-- EL ORDEN QUE SE IMPONE AHORA
--   1. se configura todo (turnos, kioscos, parámetros),
--   2. se IMPRIME el convenio                → impreso_at
--   3. el trabajador lo firma de su puño y letra  —fuera del sistema—
--   4. se le toma FOTO al convenio firmado   → documento / documento_at
--   5. esa foto LIBERA el enrolamiento del rostro.
--
-- La foto va como data-URL base64 en TEXT, igual que la foto del trabajador y
-- la de las entregas de equipo: son unos cientos de KB por persona, viajan con
-- el expediente y no se pierden por separado (el disco de Render es efímero).
-- NUNCA se trae en los listados: se pide con su propio endpoint.
-- ============================================================================

ALTER TABLE checador_consentimiento
  ADD COLUMN IF NOT EXISTS documento    TEXT,
  ADD COLUMN IF NOT EXISTS documento_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS impreso_at   TIMESTAMPTZ;

COMMENT ON COLUMN checador_consentimiento.documento IS
  'Foto del convenio FIRMADO de puño y letra (data-URL base64, imagen <= ~2 MB). Es la prueba del consentimiento expreso y por escrito (LFPDPPP) y lo que libera el enrolamiento facial.';
COMMENT ON COLUMN checador_consentimiento.documento_at IS
  'Cuándo se subió la foto del convenio firmado.';
COMMENT ON COLUMN checador_consentimiento.impreso_at IS
  'Cuándo se imprimió el convenio para la firma autógrafa (paso 1 del flujo).';
