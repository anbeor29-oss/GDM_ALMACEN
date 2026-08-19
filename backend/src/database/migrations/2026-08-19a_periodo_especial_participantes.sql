-- ═══════════════════════════════════════════════════════════════════════════
-- Quiénes entran a una nómina especial
--
-- POR QUÉ
-- Los especiales se pensaron para el aguinaldo y la PTU, que alcanzan a toda
-- la plantilla, y por eso alcanzaban a todos sin preguntar. Pero un especial
-- también es un bono a un turno, una gratificación a un área o un pago a tres
-- personas: en esos casos la rejilla traía a los ochenta y había que confiar
-- en no cerrar de más. Un periodo cerrado ya generó recibos, y deshacerlo es
-- borrar CFDI.
--
-- CÓMO SE LEE LA AUSENCIA DE RENGLONES
-- Sin renglones aquí, el periodo alcanza a TODOS. Es lo que ya hacía, así que
-- los especiales que existan hoy siguen comportándose igual sin tocarlos. Con
-- renglones, alcanza sólo a los listados.
--
-- ON DELETE CASCADE en las dos llaves: si se borra el periodo o el trabajador,
-- esta lista no tiene por qué sobrevivir a ninguno de los dos.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS nomina_periodo_empleados (
  periodo_id  UUID NOT NULL REFERENCES nomina_periodos(id)  ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (periodo_id, empleado_id)
);

/* Se consulta SIEMPRE por periodo —"quiénes entran a éste"— y la llave
 * primaria ya sirve para eso. El índice extra es para el camino contrario, que
 * usa el borrado de un trabajador. */
CREATE INDEX IF NOT EXISTS nomina_periodo_empleados_empleado_ix
  ON nomina_periodo_empleados (empleado_id);

COMMENT ON TABLE nomina_periodo_empleados IS
  'Participantes de un periodo ESPECIAL. Sin renglones = toda la plantilla.';
