-- ═══════════════════════════════════════════════════════════════════════════
-- Bancos: cuentas, estados de cuenta y movimientos
--
-- PARA QUÉ
-- Tesorería programa pagos, pero no sabía cuánto hay en el banco. El saldo
-- vivía en el portal del banco y en la cabeza de quien lo consulta; al armar
-- una remesa de $49,075 nadie podía decir si la cuenta lo aguantaba.
--
-- EL CONTROL ES MES A MES, Y ESO NO ES UNA LIMITACIÓN
-- Un estado de cuenta es un documento cerrado: tiene saldo inicial, movimientos
-- y saldo final, y esas tres cifras cuadran entre sí. Cargar movimientos
-- sueltos sin su estado dejaría un saldo que nadie puede verificar contra nada.
-- Por eso el movimiento SIEMPRE cuelga de un estado de cuenta.
--
-- Y por eso el saldo que muestra el sistema es "al corte del último estado
-- procesado", no "en este momento": decir lo segundo sería mentir.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bancos_cuentas (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  /* Clave del catálogo del SAT (c_Banco) cuando se conoce; el nombre queda
   * libre porque no todos los bancos de una empresa son del catálogo —hay
   * cajas, SOFIPOS y cuentas en el extranjero—. */
  banco_clave  VARCHAR(10),
  banco_nombre VARCHAR(120) NOT NULL,

  /* Cómo la llama la empresa: "Bancrea principal", "nómina", "dólares". Es lo
   * que se lee en la pantalla; el número de cuenta no distingue nada de un
   * vistazo. */
  alias        VARCHAR(80) NOT NULL,

  numero_cuenta VARCHAR(30),
  clabe         VARCHAR(18),
  moneda        VARCHAR(3) NOT NULL DEFAULT 'MXN',

  /* El punto de partida. Sin él, el primer estado de cuenta no tiene contra
   * qué cuadrar su saldo inicial. */
  saldo_inicial       NUMERIC(16,2) NOT NULL DEFAULT 0,
  saldo_inicial_fecha DATE,

  activa       BOOLEAN NOT NULL DEFAULT true,
  notas        TEXT,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ,

  CONSTRAINT bancos_cuentas_moneda_ck CHECK (moneda ~ '^[A-Z]{3}$')
);

/* Dos cuentas con la misma CLABE en la misma empresa es un error de captura,
 * no dos cuentas. Parcial porque la CLABE puede faltar mientras se consigue. */
CREATE UNIQUE INDEX IF NOT EXISTS bancos_cuentas_clabe_uq
  ON bancos_cuentas (company_id, clabe)
  WHERE clabe IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS bancos_cuentas_company_ix
  ON bancos_cuentas (company_id) WHERE deleted_at IS NULL;


-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bancos_estados_cuenta (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cuenta_id   UUID NOT NULL REFERENCES bancos_cuentas(id) ON DELETE CASCADE,

  anio        INT NOT NULL,
  mes         INT NOT NULL,

  /* Las tres cifras que trae el documento. Son las que permiten decir si lo
   * que se extrajo está completo: saldo_inicial + depósitos - retiros debe dar
   * saldo_final. Si no da, algo se quedó fuera. */
  saldo_inicial NUMERIC(16,2),
  saldo_final   NUMERIC(16,2),

  /* De dónde salió: PDF | TEXTO | CSV. Sirve para saber en quién confiar
   * cuando dos cargas del mismo mes no coinciden. */
  origen        VARCHAR(10) NOT NULL DEFAULT 'TEXTO',
  archivo_nombre VARCHAR(255),
  banco_detectado VARCHAR(40),

  movimientos_total INT NOT NULL DEFAULT 0,
  total_retiros     NUMERIC(16,2) NOT NULL DEFAULT 0,
  total_depositos   NUMERIC(16,2) NOT NULL DEFAULT 0,

  /* Cuántos renglones quedaron marcados. Un estado con advertencias NO es un
   * estado inválido: es uno que alguien tiene que mirar. */
  con_advertencia   INT NOT NULL DEFAULT 0,
  /* Si el saldo final declarado cuadra con la suma de los movimientos. */
  cuadra            BOOLEAN NOT NULL DEFAULT false,

  procesado_por   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bancos_estados_mes_ck CHECK (mes BETWEEN 1 AND 12),
  CONSTRAINT bancos_estados_anio_ck CHECK (anio BETWEEN 2000 AND 2100),
  CONSTRAINT bancos_estados_origen_ck CHECK (origen IN ('PDF','TEXTO','CSV'))
);

/* UN estado por cuenta y mes.
 *
 * Volver a cargar el mismo mes REEMPLAZA, no acumula: cargar dos veces el
 * estado de julio y quedarse con los movimientos duplicados daría un saldo del
 * doble, y nadie lo notaría hasta cuadrar contra el banco. */
CREATE UNIQUE INDEX IF NOT EXISTS bancos_estados_cuenta_mes_uq
  ON bancos_estados_cuenta (cuenta_id, anio, mes);


-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bancos_movimientos (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cuenta_id   UUID NOT NULL REFERENCES bancos_cuentas(id) ON DELETE CASCADE,
  estado_id   UUID NOT NULL REFERENCES bancos_estados_cuenta(id) ON DELETE CASCADE,

  fecha       DATE NOT NULL,
  concepto    VARCHAR(200) NOT NULL,
  referencia  TEXT,

  retiro      NUMERIC(16,2) NOT NULL DEFAULT 0,
  deposito    NUMERIC(16,2) NOT NULL DEFAULT 0,
  /* El saldo que declara el banco en ese renglón. Puede venir vacío. */
  saldo       NUMERIC(16,2),
  /* El saldo que resulta de arrastrar los movimientos. Cuando los dos existen
   * y no coinciden, hay algo que revisar — y es lo único que delata un
   * movimiento que el PDF se comió. */
  saldo_calculado NUMERIC(16,2),

  advertencia TEXT,

  /* Un movimiento INFERIDO no lo reportó el banco: lo dedujo el sistema por la
   * diferencia de saldos (la comisión que Bancrea a veces omite). Se marca y
   * NUNCA se presenta como dato del banco: inventar un movimiento y no decirlo
   * es peor que dejar el saldo descuadrado. */
  inferido    BOOLEAN NOT NULL DEFAULT false,

  /* El orden en que venían en el documento. Dos movimientos del mismo día no
   * tienen hora, y reordenarlos rompería el arrastre del saldo. */
  orden       INT NOT NULL DEFAULT 0,
  linea_origen TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bancos_movimientos_estado_ix
  ON bancos_movimientos (estado_id, orden);
CREATE INDEX IF NOT EXISTS bancos_movimientos_cuenta_fecha_ix
  ON bancos_movimientos (cuenta_id, fecha);

COMMENT ON TABLE bancos_movimientos IS
  'Movimientos de un estado de cuenta. Siempre cuelgan de su estado: un '
  'movimiento suelto da un saldo que no se puede verificar contra nada.';
