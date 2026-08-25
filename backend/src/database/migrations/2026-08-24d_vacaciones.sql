-- Control de vacaciones del trabajador.
--
-- Cada renglón es un tramo de vacaciones: las que DISFRUTÓ (tomó los días) o las
-- que se le PAGARON sin tomarlas. Con la antigüedad se sabe cuántas GANÓ (Art. 76
-- LFT); ganadas menos disfrutadas menos pagadas es el REMANENTE. La prima
-- vacacional (Art. 80) y el pago, cuando toca, pasan a la nómina que cubre esos
-- días.
CREATE TABLE IF NOT EXISTS nomina_vacaciones (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  empleado_id   UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,
  fecha_inicio  DATE NOT NULL,
  fecha_fin     DATE NOT NULL,
  dias          NUMERIC(6,2) NOT NULL,
  tipo          VARCHAR(12) NOT NULL DEFAULT 'DISFRUTADA',  -- DISFRUTADA / PAGADA
  motivo        VARCHAR(200),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vacaciones_empleado
  ON nomina_vacaciones (company_id, empleado_id, fecha_inicio);
