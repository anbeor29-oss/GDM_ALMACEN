-- ============================================================================
-- NÓMINA — DEPARTAMENTOS, PRÉSTAMOS, FONACOT Y NÓMINA ESPECIAL
--
-- 1. DEPARTAMENTOS COMO CATÁLOGO
--    El departamento se venía capturando como texto libre, y ahí es donde nacen
--    "PRODUCCION", "Producción" y "produccion " como tres departamentos
--    distintos que parten en tres cualquier reporte. Igual que los puestos: se
--    elige de una lista y, si no está, se agrega desde ahí mismo.
--
-- 2. PRÉSTAMOS DE LA EMPRESA Y CRÉDITOS FONACOT
--    No son como el INFONAVIT. El crédito de vivienda acompaña al trabajador
--    durante años y por eso vive en su expediente; un préstamo se pide, se
--    descuenta unas semanas y se acaba. Son eventos con saldo, no atributos de
--    la persona: por eso van en su propia tabla y una misma persona puede tener
--    varios a la vez, o ninguno durante meses.
--
--    EL SALDO SE LLEVA AQUÍ, NO SE RECALCULA
--    Cada descuento aplicado baja el saldo y queda registrado con el periodo en
--    que se aplicó. Recalcular "lo prestado menos lo descontado" cada vez que se
--    consulta parece más limpio, pero deja sin explicación el día que los
--    números no cuadran: con los abonos escritos se puede ver cuál faltó.
--
-- 3. NÓMINA ESPECIAL
--    El sistema anterior manejaba cuatro tipos: semanal, quincenal, mensual y
--    ESPECIAL, esta última para lo que no cae en el calendario —un finiquito, el
--    aguinaldo, el reparto de utilidades—. El CHECK actual sólo admite las tres
--    primeras, así que se amplía.
-- ============================================================================


/* ── 1. Departamentos ──────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS nomina_departamentos (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  nombre     VARCHAR(100) NOT NULL,
  activo     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

/* Sin distinguir mayúsculas ni espacios de sobra, igual que los puestos. */
CREATE UNIQUE INDEX IF NOT EXISTS uq_nomina_departamentos_nombre
  ON nomina_departamentos (company_id, UPPER(TRIM(nombre)));

/* Los departamentos que ya se capturaron a mano o llegaron de un XML pasan al
 * catálogo: si no, la primera vez que alguien abra el combo no vería los suyos
 * y volvería a escribirlos, esta vez distinto. */
INSERT INTO nomina_departamentos (company_id, nombre)
SELECT DISTINCT e.company_id, TRIM(e.departamento)
  FROM nomina_empleados e
 WHERE e.departamento IS NOT NULL
   AND TRIM(e.departamento) <> ''
   AND e.deleted_at IS NULL
ON CONFLICT DO NOTHING;

/* Lo mismo con los puestos, que ya tenían catálogo pero se llenaba aparte. */
INSERT INTO nomina_puestos (company_id, nombre)
SELECT DISTINCT e.company_id, TRIM(e.puesto)
  FROM nomina_empleados e
 WHERE e.puesto IS NOT NULL
   AND TRIM(e.puesto) <> ''
   AND e.deleted_at IS NULL
ON CONFLICT DO NOTHING;


/* ── 2. Préstamos de la empresa y créditos FONACOT ─────────────────────── */

/* Una sola tabla para los dos, con `origen` para distinguirlos.
 *
 * Se parecen en todo lo que importa —monto, plazo, descuento por periodo,
 * saldo— y difieren en quién presta y en que el FONACOT trae número de crédito.
 * Dos tablas gemelas obligarían a escribir dos veces cada consulta del recibo y
 * a acordarse siempre de las dos; una sola con su origen no. */
CREATE TABLE IF NOT EXISTS nomina_creditos (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  empleado_id  UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,

  origen       VARCHAR(12) NOT NULL,   -- PRESTAMO | FONACOT
  /* El FONACOT lo asigna el instituto; un préstamo de la empresa puede no
   * tener número y entonces se identifica por su fecha y su monto. */
  numero       VARCHAR(30),
  concepto     VARCHAR(200),

  monto_original NUMERIC(12,2) NOT NULL,
  /* Lo que falta por descontar. Baja con cada abono aplicado. */
  saldo          NUMERIC(12,2) NOT NULL,

  /* Cuánto se descuenta en cada periodo de nómina. Es un importe fijo y no un
   * porcentaje: así es como llegan tanto la carta del FONACOT como el convenio
   * de un préstamo interno. */
  descuento_por_periodo NUMERIC(12,2) NOT NULL,

  fecha_inicio DATE NOT NULL,
  /* Informativo: cuándo se espera que termine. No se usa para cortar el
   * descuento — el que manda es el saldo, porque un periodo sin pago corre la
   * fecha y nadie actualiza el plan. */
  fecha_fin_estimada DATE,

  estatus      VARCHAR(12) NOT NULL DEFAULT 'ACTIVO',  -- ACTIVO | LIQUIDADO | SUSPENDIDO | CANCELADO
  notas        TEXT,

  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT nomina_creditos_origen_ck   CHECK (origen IN ('PRESTAMO','FONACOT')),
  CONSTRAINT nomina_creditos_estatus_ck  CHECK (estatus IN ('ACTIVO','LIQUIDADO','SUSPENDIDO','CANCELADO')),
  CONSTRAINT nomina_creditos_montos_ck   CHECK (monto_original > 0 AND descuento_por_periodo > 0),
  /* El saldo no puede pasarse del monto ni bajar de cero: si eso ocurre es que
   * un abono se aplicó dos veces o con el signo cambiado. */
  CONSTRAINT nomina_creditos_saldo_ck    CHECK (saldo >= 0 AND saldo <= monto_original),
  CONSTRAINT nomina_creditos_fechas_ck
    CHECK (fecha_fin_estimada IS NULL OR fecha_fin_estimada >= fecha_inicio)
);

CREATE INDEX IF NOT EXISTS ix_nomina_creditos_activos
  ON nomina_creditos (company_id, empleado_id)
  WHERE estatus = 'ACTIVO';

/* El número del FONACOT no se repite dentro de la empresa: si aparece dos
 * veces es que se capturó doble y al trabajador se le descontaría el doble. */
CREATE UNIQUE INDEX IF NOT EXISTS uq_nomina_creditos_fonacot
  ON nomina_creditos (company_id, UPPER(TRIM(numero)))
  WHERE origen = 'FONACOT' AND numero IS NOT NULL AND estatus <> 'CANCELADO';


/* Los abonos: qué se descontó, cuándo y en qué periodo.
 *
 * Sin esto el saldo sería un número sin historia, y el día que no cuadre con lo
 * que dice el trabajador no habría forma de ver qué periodo falló. */
CREATE TABLE IF NOT EXISTS nomina_credito_abonos (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  credito_id  UUID NOT NULL REFERENCES nomina_creditos(id) ON DELETE CASCADE,
  periodo_id  UUID REFERENCES nomina_periodos(id) ON DELETE SET NULL,
  fecha       DATE NOT NULL,
  importe     NUMERIC(12,2) NOT NULL,
  /* El saldo que quedó DESPUÉS de este abono, congelado. Recalcularlo hacia
   * atrás daría otro número si alguien corrige un abono viejo. */
  saldo_despues NUMERIC(12,2) NOT NULL,
  notas       TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT nomina_credito_abonos_importe_ck CHECK (importe > 0)
);

CREATE INDEX IF NOT EXISTS ix_nomina_credito_abonos
  ON nomina_credito_abonos (credito_id, fecha DESC);

/* Un mismo crédito no se abona dos veces en el mismo periodo: sería descontarle
 * doble al trabajador en una sola raya. */
CREATE UNIQUE INDEX IF NOT EXISTS uq_nomina_credito_abonos_periodo
  ON nomina_credito_abonos (credito_id, periodo_id)
  WHERE periodo_id IS NOT NULL;


/* ── 3. Nómina especial ────────────────────────────────────────────────── */

/* Finiquitos, aguinaldo, PTU: pagos que no caen en el calendario ordinario.
 * El sistema anterior los manejaba como un cuarto tipo y así se conserva.
 *
 * Su numeración no está acotada a 12/24/53 como las otras: van saliendo según
 * se necesiten, y por eso el CHECK les deja hasta 99. */
ALTER TABLE nomina_periodos DROP CONSTRAINT IF EXISTS nomina_periodos_tipo_ck;
ALTER TABLE nomina_periodos ADD CONSTRAINT nomina_periodos_tipo_ck
  CHECK (tipo IN ('SEMANAL','QUINCENAL','MENSUAL','ESPECIAL'));

ALTER TABLE nomina_periodos DROP CONSTRAINT IF EXISTS nomina_periodos_numero_ck;
ALTER TABLE nomina_periodos ADD CONSTRAINT nomina_periodos_numero_ck CHECK (
  (tipo = 'SEMANAL'   AND numero BETWEEN 1 AND 53) OR
  (tipo = 'QUINCENAL' AND numero BETWEEN 1 AND 24) OR
  (tipo = 'MENSUAL'   AND numero BETWEEN 1 AND 12) OR
  (tipo = 'ESPECIAL'  AND numero BETWEEN 1 AND 99)
);

/* Un periodo especial necesita decir de qué es: "finiquito de Juan Pérez" o
 * "aguinaldo 2026". Los ordinarios se explican solos con su número. */
ALTER TABLE nomina_periodos ADD COLUMN IF NOT EXISTS concepto VARCHAR(200);

/* Los especiales pueden durar más de 31 días —un aguinaldo cubre el año— así
 * que el tope de días deja de aplicarles. */
ALTER TABLE nomina_periodos DROP CONSTRAINT IF EXISTS nomina_periodos_dias_ck;
ALTER TABLE nomina_periodos ADD CONSTRAINT nomina_periodos_dias_ck
  CHECK (dias > 0 AND (tipo = 'ESPECIAL' OR dias <= 31));

COMMENT ON TABLE nomina_creditos IS
  'Préstamos de la empresa y créditos FONACOT. Son eventos con saldo, no '
  'atributos del trabajador: empiezan, se descuentan y se acaban.';
