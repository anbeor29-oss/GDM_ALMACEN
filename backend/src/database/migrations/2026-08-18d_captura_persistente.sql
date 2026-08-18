/*
 * Lo capturado en la prenómina deja de perderse al salir de la pantalla.
 *
 * QUÉ PASABA
 * Los otros ingresos y las otras deducciones vivían en la memoria del
 * navegador: se tecleaban, se recalculaba, y al cambiar de menú y volver ya no
 * estaban. Con cincuenta trabajadores y sus horas extra, faltas y bonos, eso es
 * media hora de trabajo que se tira cada vez que alguien contesta el teléfono.
 *
 * POR QUÉ EN SU PROPIA TABLA Y NO EN EL RECIBO
 * `nomina_recibos` guarda lo CERRADO: importes congelados que ya no se tocan.
 * Esto es lo contrario — es un borrador que se edita muchas veces antes de
 * cerrar. Mezclarlos obligaría a distinguir "recibo de verdad" de "recibo a
 * medias" en cada consulta, y esa distinción se olvida.
 *
 * POR QUÉ JSONB Y NO UNA FILA POR CONCEPTO
 * La captura de un trabajador se lee y se escribe COMPLETA: la pantalla manda
 * los conceptos que quedaron, no un diff. Una fila por concepto obligaría a
 * borrar e insertar en cada recálculo para acabar guardando lo mismo, y abriría
 * la puerta a que queden conceptos huérfanos de una captura anterior.
 *
 * SE BORRA AL CERRAR
 * Una vez cerrado el periodo los importes viven en el recibo. Dejar el borrador
 * invitaría a editarlo y a preguntarse por qué no cambia nada.
 */

CREATE TABLE IF NOT EXISTS nomina_captura (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  periodo_id  UUID NOT NULL REFERENCES nomina_periodos(id)  ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,

  /* Días pagados, cuando quien captura los ajusta a mano. Nulo = los que salen
   * del calendario y del alta o baja del trabajador. */
  dias        NUMERIC(5,2),

  /* [{ clave, importe, gravadoManual? }] tal como los manda la pantalla. */
  otros_ingresos    JSONB NOT NULL DEFAULT '[]'::jsonb,
  otras_deducciones JSONB NOT NULL DEFAULT '[]'::jsonb,

  capturado_por UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT nomina_captura_dias_ck CHECK (dias IS NULL OR (dias >= 0 AND dias <= 31))
);

/* Una captura por trabajador y periodo. Sostiene el ON CONFLICT del guardado:
 * recalcular veinte veces deja una fila, no veinte. */
CREATE UNIQUE INDEX IF NOT EXISTS uq_nomina_captura
  ON nomina_captura (periodo_id, empleado_id);

CREATE INDEX IF NOT EXISTS ix_nomina_captura_periodo
  ON nomina_captura (periodo_id);

COMMENT ON TABLE nomina_captura IS
  'El BORRADOR de la prenómina: horas extra, faltas, bonos y días ajustados a '
  'mano, mientras el periodo sigue abierto. Al cerrar, los importes quedan '
  'congelados en nomina_recibos y esta captura se borra.';
