-- Cola de movimientos afiliatorios pendientes de enviar al IDSE.
--
-- Cuando se da de baja a un trabajador (o, más adelante, se le da de alta o se
-- le modifica el salario), el movimiento se encola aquí y aparece en
-- Nómina → IMSS · IDSE, listo para generarse. Así la baja "se manda al menú
-- IDSE" sin que nadie tenga que volver a capturar a la persona ni la fecha.
--
-- No guarda el archivo ni sustituye al generador: es sólo el pendiente. Al
-- generar el TXT se marca GENERADO; mientras, se puede descartar a mano.
CREATE TABLE IF NOT EXISTS nomina_idse_pendientes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  empleado_id  UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,
  tipo         VARCHAR(15) NOT NULL,                     -- ALTA / BAJA / MODIFICACION
  fecha        DATE NOT NULL,                            -- fecha del movimiento
  causa_baja   VARCHAR(1),                               -- 1-9/A, sólo BAJA (se elige al generar)
  sbc          NUMERIC(12,2),                            -- ALTA / MODIFICACION
  origen       VARCHAR(30) NOT NULL DEFAULT 'manual',    -- 'baja', 'alta', 'manual'
  estado       VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE', -- PENDIENTE / GENERADO
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  generado_at  TIMESTAMP,

  -- El mismo movimiento (mismo trabajador, mismo tipo, misma fecha) no se encola
  -- dos veces: dar de baja y reintentar no debe duplicar el pendiente.
  UNIQUE (company_id, empleado_id, tipo, fecha)
);

CREATE INDEX IF NOT EXISTS idx_idse_pendientes_empresa_estado
  ON nomina_idse_pendientes (company_id, estado);
