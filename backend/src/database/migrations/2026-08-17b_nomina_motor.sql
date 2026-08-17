-- ============================================================================
-- NÓMINA — PARÁMETROS FISCALES POR EJERCICIO, PERIODOS Y GRUPO DE RH
--
-- POR QUÉ LAS TARIFAS SALEN DEL CÓDIGO Y ENTRAN A LA BASE
-- En el sistema anterior la tarifa del Art. 96, el subsidio al empleo, la UMA y
-- los salarios mínimos eran constantes escritas dentro de nomina.html. Cambian
-- CADA AÑO —el DOF los publica en diciembre— y con ellas dentro del código un
-- cambio de tarifa es un despliegue. Peor: si nadie lo despliega a tiempo, el
-- sistema sigue calculando con la tabla del año pasado sin que nada se vea
-- roto, porque un ISR mal calculado no parece un error, parece un número.
--
-- Aquí viven versionadas por ejercicio. El cálculo de enero se hace con la
-- tabla de enero, y el recibo de hace tres años se puede reproducir tal como
-- salió.
--
-- SON GLOBALES, NO DE CADA EMPRESA
-- La tarifa del ISR y la UMA son las mismas para todo el país: no son una
-- política de la empresa como sí lo es el aguinaldo. Guardarlas por empresa
-- permitiría que dos empresas de la misma plataforma calcularan distinto el
-- mismo impuesto. Por eso las edita SUPER_ADMIN, que es quien opera la
-- plataforma, y las lee cualquiera que tenga nómina.
--
-- NACEN SIN CONFIRMAR, A PROPÓSITO
-- La semilla de 2026 se copia TAL CUAL del sistema anterior, que es de donde
-- hoy salen los recibos que la empresa ya emite. Pero copiada no es lo mismo
-- que verificada: se marcan `confirmado = false` y la pantalla lo dice, para
-- que alguien las coteje contra el DOF antes del primer cálculo. Un número
-- fiscal que nadie revisó y que el sistema presenta como bueno es exactamente
-- la clase de dato que se descubre en una auditoría.
-- ============================================================================


/* ── 1. Grupo de trabajo de Recursos Humanos ───────────────────────────────
 *
 * ADMIN_ALL ya alcanza nómina. Este grupo existe para quien SÓLO hace nómina:
 * captura la plantilla, calcula y timbra, sin ver facturación ni inventarios.
 *
 * La restricción se REEMPLAZA en vez de quitarse: sin ella un typo guardaría
 * 'RRHH' o 'RH' y ese usuario se quedaría sin ver absolutamente nada, porque
 * ningún grupo desconocido tiene módulos asignados. */

DO $$
DECLARE
  grupos CONSTANT text[] := ARRAY[
    'ADMIN_ALL','VENTAS','ALMACEN','COMPRAS','TESORERIA','PUNTO_VENTA','RECURSOS_HUMANOS'
  ];
  t record;
  c record;
BEGIN
  FOR t IN SELECT * FROM (VALUES ('users'), ('user_companies')) AS v(tabla)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = t.tabla AND column_name = 'work_group'
    ) THEN
      /* Se quitan TODAS las que mencionen work_group en vez de adivinar el
       * nombre: la original es `chk_user_work_group` (singular) y un DROP mal
       * escrito la dejaría en pie rechazando el grupo nuevo. */
      FOR c IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = t.tabla::regclass
           AND pg_get_constraintdef(oid) ILIKE '%work_group%'
      LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t.tabla, c.conname);
      END LOOP;

      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT chk_%s_work_group CHECK (work_group IS NULL OR work_group = ANY(%L))',
        t.tabla, t.tabla, grupos
      );
      RAISE NOTICE 'work_group de % admite ahora RECURSOS_HUMANOS', t.tabla;
    END IF;
  END LOOP;
END $$;

COMMENT ON COLUMN users.work_group IS
  'Grupo de trabajo: ADMIN_ALL, VENTAS, ALMACEN, COMPRAS, TESORERIA, '
  'PUNTO_VENTA o RECURSOS_HUMANOS (sólo nómina).';


/* ── 2. El ejercicio fiscal ────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS nomina_ejercicios (
  anio          INTEGER PRIMARY KEY,

  /* UMA — Unidad de Medida y Actualización. La publica el INEGI y entra en
   * vigor el 1 de febrero, no el 1 de enero: enero se calcula todavía con la
   * del año anterior. Se guarda el año al que PERTENECE la UMA. */
  uma_diaria    NUMERIC(10,2) NOT NULL,
  uma_mensual   NUMERIC(10,2) NOT NULL,

  /* Salarios mínimos: general y zona libre de la frontera norte. Cambian la
   * exención del Art. 93 Fr. XIV y la cuota obrera del Art. 36 LSS. */
  smg_general   NUMERIC(10,2) NOT NULL,
  smg_frontera  NUMERIC(10,2) NOT NULL,

  /* De dónde salieron y si alguien ya los verificó contra la publicación. */
  fuente        TEXT,
  confirmado    BOOLEAN NOT NULL DEFAULT false,
  confirmado_por UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmado_at TIMESTAMP,

  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT nomina_ejercicios_anio_ck CHECK (anio BETWEEN 2000 AND 2100),
  CONSTRAINT nomina_ejercicios_positivos_ck
    CHECK (uma_diaria > 0 AND uma_mensual > 0 AND smg_general > 0 AND smg_frontera > 0),
  /* La frontera nunca ha sido menor que el general, y si lo fuera sería un
   * dedo cambiado: la exención saldría al revés para media plantilla. */
  CONSTRAINT nomina_ejercicios_frontera_ck CHECK (smg_frontera >= smg_general)
);


/* ── 3. Tarifa del Art. 96 LISR ────────────────────────────────────────── */

/* La columna `periodicidad` existe aunque hoy sólo se siembre 'MENSUAL'.
 *
 * El sistema anterior usa la tarifa MENSUAL y mensualiza la base con un factor
 * (30.4/7 semanal, 30.4/15 quincenal, 1 mensual). El SAT también publica
 * tarifas por periodicidad en el Anexo 8, que dan resultados ligeramente
 * distintos. Se conserva el método que la empresa ya venía usando —cambiarlo
 * movería los ISR de todos sin avisar— pero el esquema admite las tablas del
 * Anexo 8 el día que se decidan, sin migrar nada. */
CREATE TABLE IF NOT EXISTS nomina_tarifa_isr (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  anio          INTEGER NOT NULL REFERENCES nomina_ejercicios(anio) ON DELETE CASCADE,
  periodicidad  VARCHAR(12) NOT NULL DEFAULT 'MENSUAL',
  renglon       INTEGER NOT NULL,
  limite_inferior NUMERIC(14,2) NOT NULL,
  /* El último renglón no tiene techo: NULL es "de aquí en adelante". Un
   * 999999999 sería un techo real que algún día alguien alcanza. */
  limite_superior NUMERIC(14,2),
  cuota_fija    NUMERIC(14,2) NOT NULL,
  porcentaje    NUMERIC(8,4) NOT NULL,

  CONSTRAINT nomina_tarifa_isr_pct_ck CHECK (porcentaje >= 0 AND porcentaje <= 100),
  CONSTRAINT nomina_tarifa_isr_rango_ck
    CHECK (limite_superior IS NULL OR limite_superior > limite_inferior)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nomina_tarifa_isr
  ON nomina_tarifa_isr (anio, periodicidad, renglon);


/* ── 4. Subsidio al empleo ─────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS nomina_subsidio (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  anio          INTEGER NOT NULL REFERENCES nomina_ejercicios(anio) ON DELETE CASCADE,
  periodicidad  VARCHAR(12) NOT NULL DEFAULT 'MENSUAL',
  renglon       INTEGER NOT NULL,
  limite_inferior NUMERIC(14,2) NOT NULL,
  limite_superior NUMERIC(14,2),
  subsidio      NUMERIC(14,2) NOT NULL,

  CONSTRAINT nomina_subsidio_positivo_ck CHECK (subsidio >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nomina_subsidio
  ON nomina_subsidio (anio, periodicidad, renglon);


/* ── 5. Periodos de nómina ─────────────────────────────────────────────── */

/* Sí son de cada empresa: dos empresas cierran su semana en días distintos.
 *
 * El número de periodo va de 1 a 53 en semanal —hay años con 53 semanas y
 * truncar en 52 dejaría una semana sin poder pagarse—, de 1 a 24 en quincenal
 * y de 1 a 12 en mensual. El CHECK lo impone por tipo. */
CREATE TABLE IF NOT EXISTS nomina_periodos (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  anio         INTEGER NOT NULL,
  tipo         VARCHAR(10) NOT NULL,
  numero       INTEGER NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin    DATE NOT NULL,
  /* La fecha de pago es un dato del CFDI (nomina12:FechaPago) y no siempre
   * cae el último día del periodo. */
  fecha_pago   DATE,
  dias         INTEGER NOT NULL,
  /* ABIERTO se puede recalcular; CALCULADO tiene resultados; CERRADO ya no se
   * toca. No hay borrado: un periodo pagado no desaparece. */
  estatus      VARCHAR(12) NOT NULL DEFAULT 'ABIERTO',
  cerrado_at   TIMESTAMP,
  cerrado_por  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT nomina_periodos_tipo_ck
    CHECK (tipo IN ('SEMANAL','QUINCENAL','MENSUAL')),
  CONSTRAINT nomina_periodos_estatus_ck
    CHECK (estatus IN ('ABIERTO','CALCULADO','CERRADO')),
  CONSTRAINT nomina_periodos_numero_ck CHECK (
    (tipo = 'SEMANAL'   AND numero BETWEEN 1 AND 53) OR
    (tipo = 'QUINCENAL' AND numero BETWEEN 1 AND 24) OR
    (tipo = 'MENSUAL'   AND numero BETWEEN 1 AND 12)
  ),
  CONSTRAINT nomina_periodos_fechas_ck CHECK (fecha_fin >= fecha_inicio),
  CONSTRAINT nomina_periodos_dias_ck CHECK (dias > 0 AND dias <= 31)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nomina_periodos
  ON nomina_periodos (company_id, anio, tipo, numero);

CREATE INDEX IF NOT EXISTS ix_nomina_periodos_abiertos
  ON nomina_periodos (company_id, anio, tipo, numero)
  WHERE estatus <> 'CERRADO';


/* ── 6. Semilla del ejercicio 2026 ─────────────────────────────────────── */

/* Copiada TAL CUAL del sistema que hoy emite los recibos de la empresa
 * (nom_com_v2/public/pages/nomina.html). Se marca sin confirmar: copiar no es
 * verificar, y estos números deciden cuánto ISR se le retiene a cada persona.
 *
 * ON CONFLICT DO NOTHING para que volver a correr la migración no pise lo que
 * alguien ya haya corregido a mano. */

INSERT INTO nomina_ejercicios (anio, uma_diaria, uma_mensual, smg_general, smg_frontera, fuente, confirmado)
VALUES (2026, 113.14, 3300.72, 315.04, 440.87,
        'Copiado del sistema de nómina anterior (NOM_COM_1). PENDIENTE de cotejar contra el DOF.',
        false)
ON CONFLICT (anio) DO NOTHING;

INSERT INTO nomina_tarifa_isr (anio, periodicidad, renglon, limite_inferior, limite_superior, cuota_fija, porcentaje)
VALUES
  (2026,'MENSUAL', 1,      0.01,    746.04,      0.00,  1.92),
  (2026,'MENSUAL', 2,    746.05,   6332.05,     14.32,  6.40),
  (2026,'MENSUAL', 3,   6332.06,  11128.01,    371.83, 10.88),
  (2026,'MENSUAL', 4,  11128.02,  12935.82,    893.63, 16.00),
  (2026,'MENSUAL', 5,  12935.83,  15487.71,   1182.88, 17.92),
  (2026,'MENSUAL', 6,  15487.72,  31236.49,   1640.18, 21.36),
  (2026,'MENSUAL', 7,  31236.50,  49233.00,   4997.58, 23.52),
  (2026,'MENSUAL', 8,  49233.01,  93993.90,   9233.62, 30.00),
  (2026,'MENSUAL', 9,  93993.91, 125325.20,  22661.50, 32.00),
  (2026,'MENSUAL',10, 125325.21, 375975.61,  32691.18, 34.00),
  (2026,'MENSUAL',11, 375975.62,      NULL, 117912.32, 35.00)
ON CONFLICT (anio, periodicidad, renglon) DO NOTHING;

INSERT INTO nomina_subsidio (anio, periodicidad, renglon, limite_inferior, limite_superior, subsidio)
VALUES
  (2026,'MENSUAL', 1,    0.01, 1768.96, 407.02),
  (2026,'MENSUAL', 2, 1768.97, 2653.38, 406.83),
  (2026,'MENSUAL', 3, 2653.39, 3472.84, 406.62),
  (2026,'MENSUAL', 4, 3472.85, 3537.87, 392.77),
  (2026,'MENSUAL', 5, 3537.88, 4446.15, 382.46),
  (2026,'MENSUAL', 6, 4446.16, 4717.18, 354.23),
  (2026,'MENSUAL', 7, 4717.19, 5335.42, 324.87),
  (2026,'MENSUAL', 8, 5335.43, 6224.67, 294.63),
  (2026,'MENSUAL', 9, 6224.68, 7113.90, 253.54),
  (2026,'MENSUAL',10, 7113.91, 7382.33, 217.61),
  (2026,'MENSUAL',11, 7382.34,    NULL,   0.00)
ON CONFLICT (anio, periodicidad, renglon) DO NOTHING;

COMMENT ON TABLE nomina_ejercicios IS
  'Parámetros fiscales por año. Globales: la UMA y la tarifa del ISR son del '
  'país, no de la empresa. Nacen sin confirmar hasta que alguien los coteja.';
