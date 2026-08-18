-- ============================================================================
-- NÓMINA — BITÁCORA DEL TRABAJADOR Y ENTREGA DE UNIFORMES / EPP
--
-- SON DOS COSAS DISTINTAS Y POR ESO SON DOS TABLAS
-- Una nota de la bitácora es un HECHO fechado que ya ocurrió: un reconocimiento,
-- una acta administrativa, un dato reservado. No cambia y no se devuelve.
-- Un uniforme entregado es un BIEN que está en poder de alguien: tiene talla,
-- cantidad, y se devuelve o se repone. Meterlos en la misma tabla obligaría a
-- dejar la mitad de las columnas vacías en cada renglón.
--
-- LO CONFIDENCIAL SE MARCA, NO SE ESCONDE EN OTRO LADO
-- Una sanción y un reconocimiento viven en la misma bitácora porque los dos
-- forman el historial de la persona; lo que cambia es quién puede leerlos. El
-- campo `confidencial` lo dice, y la pantalla decide. Una tabla aparte para "lo
-- delicado" acaba con la mitad de las notas en el lugar equivocado.
--
-- QUIÉN ESCRIBIÓ, Y NO SE BORRA
-- Cada nota deja el usuario que la capturó. Una sanción anónima no sirve de
-- nada el día que se discute, y por eso tampoco hay borrado: se cancela con su
-- motivo, y queda el rastro de que existió.
--
-- EL EQUIPO DE PROTECCIÓN NO ES UN UNIFORME MÁS
-- La ley obliga al patrón a proporcionarlo (Art. 132 Fr. XVII LFT y NOM-017) y
-- a poder demostrarlo. Por eso la entrega guarda fecha y quién la recibió: es
-- el comprobante, no un inventario.
-- ============================================================================


/* ── 1. Bitácora del trabajador ────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS nomina_bitacora (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,

  /* LOGRO       reconocimientos, cursos, ascensos
   * SANCION     amonestaciones, actas administrativas, suspensiones
   * INCIDENCIA  lo que pasó y hay que dejar escrito sin ser ni premio ni castigo
   * NOTA        cualquier otra cosa del expediente */
  tipo        VARCHAR(12) NOT NULL,
  fecha       DATE NOT NULL,
  titulo      VARCHAR(200) NOT NULL,
  detalle     TEXT,

  /* Lo que no debe ver cualquiera que abra el expediente. */
  confidencial BOOLEAN NOT NULL DEFAULT false,

  /* Una sanción con días de suspensión se descuenta; se guarda para poder
   * relacionarla con la nómina del periodo, aunque el descuento se capture
   * aparte: aquí queda el porqué. */
  dias_suspension INTEGER,

  /* Se cancela, no se borra: el rastro de que existió es parte del historial. */
  cancelada    BOOLEAN NOT NULL DEFAULT false,
  motivo_cancelacion TEXT,

  creada_por  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT nomina_bitacora_tipo_ck
    CHECK (tipo IN ('LOGRO','SANCION','INCIDENCIA','NOTA')),
  CONSTRAINT nomina_bitacora_suspension_ck
    CHECK (dias_suspension IS NULL OR (dias_suspension > 0 AND dias_suspension <= 90))
);

CREATE INDEX IF NOT EXISTS ix_nomina_bitacora_empleado
  ON nomina_bitacora (empleado_id, fecha DESC);


/* ── 2. Entrega de uniformes y equipo de protección ────────────────────── */

CREATE TABLE IF NOT EXISTS nomina_entregas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,

  /* UNIFORME  camisola, pantalón, playera
   * EPP       casco, botas, guantes, lentes, arnés — lo que obliga la NOM-017
   * HERRAMIENTA  lo que se presta para trabajar y se devuelve
   * OTRO */
  tipo        VARCHAR(12) NOT NULL,
  articulo    VARCHAR(200) NOT NULL,
  talla       VARCHAR(20),
  cantidad    INTEGER NOT NULL DEFAULT 1,

  fecha_entrega DATE NOT NULL,
  /* Cuándo TOCA reponerlo. Unas botas de seguridad tienen vida útil; sin esta
   * fecha nadie se entera de que llevan tres años puestas. */
  fecha_reposicion DATE,

  /* Devuelto o repuesto. Un artículo devuelto deja de contar como "en poder
   * de", que es lo que se revisa al liquidar a alguien. */
  devuelto     BOOLEAN NOT NULL DEFAULT false,
  fecha_devolucion DATE,
  estado_devolucion VARCHAR(20),   -- BUENO | USADO | DANADO | EXTRAVIADO

  /* Lo que costó, para poder descontarlo si se pierde. No se descuenta solo:
   * eso lo decide alguien y se captura como deducción. */
  costo        NUMERIC(12,2),
  notas        TEXT,

  entregado_por UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT nomina_entregas_tipo_ck
    CHECK (tipo IN ('UNIFORME','EPP','HERRAMIENTA','OTRO')),
  CONSTRAINT nomina_entregas_cantidad_ck CHECK (cantidad > 0),
  CONSTRAINT nomina_entregas_estado_ck
    CHECK (estado_devolucion IS NULL OR estado_devolucion IN ('BUENO','USADO','DANADO','EXTRAVIADO')),
  /* No se puede devolver antes de entregar. */
  CONSTRAINT nomina_entregas_fechas_ck
    CHECK (fecha_devolucion IS NULL OR fecha_devolucion >= fecha_entrega),
  /* Marcado como devuelto tiene que traer la fecha: "devuelto" sin cuándo no
   * sirve como comprobante de nada. */
  CONSTRAINT nomina_entregas_devuelto_ck
    CHECK (NOT devuelto OR fecha_devolucion IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_nomina_entregas_empleado
  ON nomina_entregas (empleado_id, fecha_entrega DESC);

/* Lo que sigue en poder del trabajador: es la consulta del finiquito. */
CREATE INDEX IF NOT EXISTS ix_nomina_entregas_pendientes
  ON nomina_entregas (company_id, empleado_id)
  WHERE NOT devuelto;

COMMENT ON TABLE nomina_bitacora IS
  'Historial del trabajador: logros, sanciones e incidencias. Se cancela, no se '
  'borra — el rastro de que existió es parte del historial.';

COMMENT ON TABLE nomina_entregas IS
  'Uniformes y equipo de protección entregados. Es el comprobante que exige el '
  'Art. 132 Fr. XVII LFT, no un inventario.';
