-- ═══════════════════════════════════════════════════════════════════════════
-- Desde cuándo aplica el INFONAVIT y la pensión alimenticia
--
-- POR QUÉ HACÍA FALTA
-- Los dos se guardaban como una regla sin fecha: "descuenta el 20%". El
-- descuento entonces aplicaba desde siempre —incluidos los periodos abiertos
-- que cubren fechas anteriores a la carta o al oficio—.
--
-- Un oficio de pensión notificado el 10 de septiembre no alcanza a la quincena
-- que corrió del 1 al 15 de agosto. Cobrarla ahí es retener dinero sin orden
-- que lo respalde, y devolverlo después ya no es un ajuste de nómina.
--
-- CÓMO SE LEE LA AUSENCIA DE FECHA
-- NULL = aplica desde siempre. Es como se comportaba antes de esta columna,
-- así que los expedientes que ya existen no cambian de un día para otro: se les
-- pone fecha cuando alguien la capture.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE nomina_empleados
  /* La fecha de la carta del INFONAVIT: desde cuándo el instituto ordena
   * retener. Antes de ella el crédito existe pero no se descuenta. */
  ADD COLUMN IF NOT EXISTS infonavit_desde DATE,

  /* La fecha en que se notificó el oficio judicial. Es la que manda: la orden
   * surte efectos desde que el patrón queda notificado, no desde que se dictó. */
  ADD COLUMN IF NOT EXISTS pension_desde DATE;

COMMENT ON COLUMN nomina_empleados.infonavit_desde IS
  'Desde cuándo se retiene el crédito INFONAVIT. NULL = desde siempre.';
COMMENT ON COLUMN nomina_empleados.pension_desde IS
  'Desde cuándo se retiene la pensión alimenticia. NULL = desde siempre.';
