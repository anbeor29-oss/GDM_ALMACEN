/*
 * Un finiquito es de UNA persona, no de la plantilla.
 *
 * QUÉ ESTABA MAL
 * Los periodos ESPECIALES se pensaron para el aguinaldo y la PTU, que sí
 * alcanzan a todos. El finiquito se metió en la misma bolsa y por eso, al
 * generarlo, la prenómina traía a los cincuenta trabajadores: quien liquida a
 * una persona veía la nómina completa y tenía que confiar en no cerrar por
 * error un periodo que no era el suyo.
 *
 * QUÉ CAMBIA
 * El periodo puede apuntar a un trabajador. Cuando lo hace, la prenómina trae
 * SÓLO a ese: es la misma pantalla, el mismo motor y el mismo cierre, pero con
 * un renglón. Los especiales de aguinaldo y PTU se quedan como están —sin
 * empleado— y siguen alcanzando a todos.
 *
 * POR QUÉ EL TIPO Y LOS DATOS VIVEN AQUÍ
 * El finiquito no se guarda como una lista de importes: se DERIVA del
 * expediente y de la fecha de baja cada vez que se calcula. Así, si se corrige
 * la fecha o el sueldo, la cuenta se corrige con ellos en lugar de quedar
 * congelada en un número que ya no corresponde. Lo que sí hay que recordar es
 * la decisión —finiquito o liquidación— y los dos datos que nadie puede
 * adivinar: los días que se le deben y las vacaciones que ya tomó.
 *
 * Al CERRAR el periodo los importes se congelan en nomina_recibos, como en
 * cualquier otro. De ahí en adelante ya no se mueven.
 */

ALTER TABLE nomina_periodos
  ADD COLUMN IF NOT EXISTS empleado_id      UUID REFERENCES nomina_empleados(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS finiquito_tipo   VARCHAR(12),
  ADD COLUMN IF NOT EXISTS finiquito_datos  JSONB;

ALTER TABLE nomina_periodos
  DROP CONSTRAINT IF EXISTS nomina_periodos_finiquito_tipo_ck;

ALTER TABLE nomina_periodos
  ADD CONSTRAINT nomina_periodos_finiquito_tipo_ck
  CHECK (finiquito_tipo IS NULL OR finiquito_tipo IN ('FINIQUITO', 'LIQUIDACION'));

/* Un finiquito sin trabajador no tiene sentido: sería la cuenta de nadie. */
ALTER TABLE nomina_periodos
  DROP CONSTRAINT IF EXISTS nomina_periodos_finiquito_con_empleado_ck;

ALTER TABLE nomina_periodos
  ADD CONSTRAINT nomina_periodos_finiquito_con_empleado_ck
  CHECK (finiquito_tipo IS NULL OR empleado_id IS NOT NULL);

/* Y sólo los ESPECIALES pueden ser de una persona: una nómina semanal que
 * apuntara a un solo trabajador dejaría a los demás sin pagar sin que se note. */
ALTER TABLE nomina_periodos
  DROP CONSTRAINT IF EXISTS nomina_periodos_individual_solo_especial_ck;

ALTER TABLE nomina_periodos
  ADD CONSTRAINT nomina_periodos_individual_solo_especial_ck
  CHECK (empleado_id IS NULL OR tipo = 'ESPECIAL');

CREATE INDEX IF NOT EXISTS ix_nomina_periodos_empleado
  ON nomina_periodos (empleado_id)
  WHERE empleado_id IS NOT NULL;

COMMENT ON COLUMN nomina_periodos.empleado_id IS
  'Si viene, el periodo es de UNA persona y la prenómina trae sólo a ella. '
  'Nulo en el aguinaldo y la PTU, que alcanzan a toda la plantilla.';
COMMENT ON COLUMN nomina_periodos.finiquito_tipo IS
  'FINIQUITO = sólo proporcionales. LIQUIDACION = agrega la indemnización del '
  'Art. 48 y la prima de antigüedad del 162.';
COMMENT ON COLUMN nomina_periodos.finiquito_datos IS
  'Lo que no se puede derivar del expediente: vacaciones ya disfrutadas y el '
  'motivo de la baja. Los importes NO se guardan aquí — se derivan al calcular '
  'y se congelan al cerrar, en nomina_recibos.';
