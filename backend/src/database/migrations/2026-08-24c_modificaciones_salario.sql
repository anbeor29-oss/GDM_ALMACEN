-- Calendario de modificaciones de salario del trabajador.
--
-- Cada cambio de salario tiene su fecha efectiva: desde ese día el nuevo salario
-- entra a la nómina, y hay que avisarlo al IMSS (movimiento 07 del IDSE). Esta
-- tabla es el histórico —quién, cuándo, de cuánto a cuánto— y la fuente del aviso.
CREATE TABLE IF NOT EXISTS nomina_modificaciones_salario (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id                UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  empleado_id               UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,
  fecha                     DATE NOT NULL,             -- fecha efectiva del cambio
  salario_diario            NUMERIC(12,2) NOT NULL,    -- nuevo salario diario
  sdi                       NUMERIC(12,2),             -- nuevo SDI (base de cotización)
  salario_diario_anterior   NUMERIC(12,2),             -- para leer el histórico
  motivo                    VARCHAR(200),
  created_at                TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_modif_salario_empleado
  ON nomina_modificaciones_salario (company_id, empleado_id, fecha DESC);
