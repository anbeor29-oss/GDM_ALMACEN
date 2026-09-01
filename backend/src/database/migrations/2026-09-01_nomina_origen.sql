-- ============================================================================
-- NÓMINA — MARCADOR DE ORIGEN PARA LA MIGRACIÓN DESDE NomiPaq
--
-- Para distinguir lo MIGRADO de un respaldo de CONTPAQ/NomiPaq de lo que genera
-- NEXO, y para poder re-importar sin duplicar. La idempotencia real la dan las
-- llaves que ya existen (empleado por num_empleado, periodo por año+tipo+número,
-- recibo por periodo+empleado); esta columna sólo etiqueta el origen.
-- ============================================================================

ALTER TABLE nomina_empleados ADD COLUMN IF NOT EXISTS origen VARCHAR(20) NOT NULL DEFAULT 'NEXO';
ALTER TABLE nomina_periodos  ADD COLUMN IF NOT EXISTS origen VARCHAR(20) NOT NULL DEFAULT 'NEXO';
ALTER TABLE nomina_recibos   ADD COLUMN IF NOT EXISTS origen VARCHAR(20) NOT NULL DEFAULT 'NEXO';
