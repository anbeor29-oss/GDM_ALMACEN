-- ============================================================================
-- ENTREGA DE EQUIPO/UNIFORME — foto de lo entregado (evidencia visual)
--
-- El patrón es el mismo que la foto del trabajador: un data-URL base64 en TEXT,
-- validado como imagen y con techo de tamaño. NO va en el listado (se pide aparte)
-- para no engordar cada consulta.
-- ============================================================================

ALTER TABLE nomina_entregas
  ADD COLUMN IF NOT EXISTS foto TEXT;

COMMENT ON COLUMN nomina_entregas.foto IS
  'Foto de lo entregado (data-URL base64, imagen ≤ ~1.5 MB). Evidencia visual del equipo/uniforme.';
