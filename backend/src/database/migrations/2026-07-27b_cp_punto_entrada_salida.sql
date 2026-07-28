-- ============================================================================
-- Migración: punto de entrada/salida según la modalidad
-- Fecha: 2026-07-27
-- ============================================================================
-- El campo se llamó "cruce_fronterizo" porque nació pensando solo en
-- autotransporte. Pero el punto por donde la mercancía entra o sale del país
-- depende del medio:
--
--   01 Autotransporte → cruce carretero  (cp_cruce_fronterizo, catálogo propio)
--   04 Ferroviario    → el mismo cruce carretero (Nuevo Laredo, Piedras Negras…)
--   02 Marítimo       → puerto     (sat_cp_estaciones, clave_transporte='02', 123)
--   03 Aéreo          → aeropuerto (sat_cp_estaciones, clave_transporte='03', 2346)
--
-- Los puertos y aeropuertos ya viven en sat_cp_estaciones desde el seed del
-- SAT; no hay que sembrar nada, solo consultarlos con el filtro correcto.
--
-- VARCHAR(10) alcanzaba para los cruces ('NLD-LRD') y los puertos ('PM046'),
-- pero las estaciones ferroviarias llegan a 12 caracteres y se truncarían.
-- ============================================================================

BEGIN;

ALTER TABLE carta_porte ALTER COLUMN cruce_fronterizo TYPE VARCHAR(16);

COMMENT ON COLUMN carta_porte.cruce_fronterizo IS
  'Punto de entrada/salida. Autotransporte y ferroviario: clave de cp_cruce_fronterizo. Marítimo y aéreo: clave de sat_cp_estaciones.';

-- Las estaciones se consultan siempre filtrando por modalidad; sin este
-- índice cada apertura del combo hace seq scan sobre 5 279 filas.
CREATE INDEX IF NOT EXISTS ix_sat_cp_estaciones_transporte
  ON sat_cp_estaciones(clave_transporte);

-- TipoEstacion, NumEstacion y NombreEstacion son atributos de la Ubicación y
-- solo aplican a marítimo, aéreo y ferroviario (c_TipoEstacion lo dice en su
-- columna clave_transporte: "02, 03 y 04"). Las columnas ya existen en
-- cp_ubicaciones desde la migración original; aquí solo se ensancha
-- num_estacion, que era VARCHAR(6) y no admite una clave ferroviaria.
ALTER TABLE cp_ubicaciones ALTER COLUMN num_estacion TYPE VARCHAR(16);

COMMIT;
