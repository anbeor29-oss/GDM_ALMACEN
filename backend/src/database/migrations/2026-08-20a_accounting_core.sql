-- ═══════════════════════════════════════════════════════════════════════════
-- Contabilidad — núcleo: ejercicios, periodos y catálogo de cuentas
--
-- PARA QUÉ
-- GDM NEXO factura, cobra, compra, paga, mueve inventario y calcula nómina —y
-- ninguna de esas operaciones llega a un estado financiero. Esta migración es
-- el suelo donde van a caer: sin catálogo de cuentas no hay dónde asentar, y
-- sin periodos no hay contra qué cerrar.
--
-- ── POR QUÉ 'codigo' Y 'codigo_agrupador' SON DOS COLUMNAS DISTINTAS ──
-- Hoy valen lo mismo: el catálogo semilla adopta la numeración del Anexo 24.
-- Es tentador dejar una sola columna. NO se hace, y la razón es la decisión
-- que ya se tomó: más adelante se empatan catálogos ya formados de otras
-- empresas y del despacho.
--
-- El día que llegue un catálogo ajeno con "1102-001 Bancrea", la equivalencia
-- se registra y ya. Con una sola columna habría que re-numerar la contabilidad
-- entera —con movimientos encima— o renunciar al empate.
--
-- Fusionarlas hoy porque coinciden es el atajo que cierra esa puerta.
--
-- ── CUENTAS COMPLEMENTARIAS ──
-- '171 Depreciación acumulada' es una cuenta de ACTIVO con saldo ACREEDOR, y
-- eso no es un error de captura: resta del activo que corrige. Igual '108
-- Estimación de cuentas incobrables' y '116 Estimación de inventarios
-- obsoletos'.
--
-- Por eso la naturaleza NO se deduce del tipo, y existe 'es_complementaria'.
-- Un catálogo que asume "activo ⇒ deudora" no puede representar una
-- depreciación acumulada, y ese es el momento en que el balance deja de cuadrar.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Las NIF, como catálogo de referencia
--
-- No es adorno documental. La norma que clasifica a una cuenta determina cómo
-- se valúa, cómo se presenta y qué hay que revelar en las notas. El motor NIF
-- (fase posterior) cuelga sus reglas de aquí; tenerlo desde el catálogo evita
-- clasificar 400 cuentas después, a mano y con movimientos encima.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nif_normas (
  clave        VARCHAR(10) PRIMARY KEY,      -- 'C-4', 'D-3', 'B-2'
  serie        CHAR(1)     NOT NULL,         -- A..E
  titulo       VARCHAR(200) NOT NULL,
  ambito       VARCHAR(30)  NOT NULL,        -- RECONOCIMIENTO | VALUACION | PRESENTACION | REVELACION | MARCO
  resumen      TEXT,
  vigente      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. El código agrupador del SAT (Anexo 24), como referencia global
--
-- No lleva company_id: es del SAT, es el mismo para todos. Se siembra una vez.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sat_codigos_agrupadores (
  codigo       VARCHAR(10) PRIMARY KEY,      -- '102', '102.01'
  padre        VARCHAR(10) REFERENCES sat_codigos_agrupadores(codigo),
  nombre       VARCHAR(250) NOT NULL,
  nivel        SMALLINT     NOT NULL,        -- 1 = mayor (NNN), 2 = subcuenta (NNN.NN)
  tipo         VARCHAR(20)  NOT NULL,        -- ACTIVO|PASIVO|CAPITAL|INGRESO|COSTO|GASTO|RIF|ORDEN
  naturaleza   VARCHAR(10)  NOT NULL,        -- DEUDORA | ACREEDORA
  nif_norma    VARCHAR(10)  REFERENCES nif_normas(clave),
  anexo_version VARCHAR(20) NOT NULL DEFAULT 'RMF-2026',
  CONSTRAINT sat_agrup_naturaleza CHECK (naturaleza IN ('DEUDORA','ACREEDORA')),
  CONSTRAINT sat_agrup_tipo CHECK (tipo IN
    ('ACTIVO','PASIVO','CAPITAL','INGRESO','COSTO','GASTO','RIF','ORDEN'))
);
CREATE INDEX IF NOT EXISTS ix_sat_agrup_padre ON sat_codigos_agrupadores(padre);
CREATE INDEX IF NOT EXISTS ix_sat_agrup_tipo  ON sat_codigos_agrupadores(tipo);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Ejercicios contables
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting_fiscal_years (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  anio         SMALLINT NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin    DATE NOT NULL,
  -- ABIERTO admite pólizas; CERRADO ya no; el cierre es un candado, no un aviso.
  estado       VARCHAR(15) NOT NULL DEFAULT 'ABIERTO',
  cerrado_por  UUID REFERENCES users(id),
  cerrado_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fy_estado CHECK (estado IN ('ABIERTO','CERRADO')),
  CONSTRAINT fy_fechas CHECK (fecha_fin > fecha_inicio),
  CONSTRAINT fy_unico  UNIQUE (company_id, anio)
);

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Periodos mensuales
--
-- Doce por ejercicio. La balanza del Anexo 24 es mensual y tiene fecha fatal
-- (primeros 3 días del segundo mes siguiente), así que el mes es la unidad
-- real de trabajo, no el año.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting_periods (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year_id UUID NOT NULL REFERENCES accounting_fiscal_years(id) ON DELETE CASCADE,
  anio           SMALLINT NOT NULL,
  mes            SMALLINT NOT NULL,
  fecha_inicio   DATE NOT NULL,
  fecha_fin      DATE NOT NULL,
  estado         VARCHAR(15) NOT NULL DEFAULT 'ABIERTO',
  cerrado_por    UUID REFERENCES users(id),
  cerrado_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT per_mes    CHECK (mes BETWEEN 1 AND 12),
  CONSTRAINT per_estado CHECK (estado IN ('ABIERTO','CERRADO')),
  CONSTRAINT per_unico  UNIQUE (company_id, anio, mes)
);
CREATE INDEX IF NOT EXISTS ix_periodos_year ON accounting_periods(fiscal_year_id);

-- ───────────────────────────────────────────────────────────────────────────
-- 5. El catálogo de cuentas de la empresa
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting_accounts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  parent_id    UUID REFERENCES accounting_accounts(id) ON DELETE RESTRICT,

  -- La clave interna: la que ve y teclea el usuario.
  codigo       VARCHAR(30)  NOT NULL,
  nombre       VARCHAR(250) NOT NULL,

  -- La equivalencia con el Anexo 24. Se captura desde el día uno aunque el
  -- envío al buzón sea posterior: volver a mapear 400 cuentas dos años después,
  -- ya con movimientos encima, es un trabajo que nadie hace bien.
  codigo_agrupador VARCHAR(10) REFERENCES sat_codigos_agrupadores(codigo),

  tipo         VARCHAR(20) NOT NULL,
  naturaleza   VARCHAR(10) NOT NULL,
  -- TRUE en 108, 116, 171, 172, 183: cuentas que RESTAN del rubro que corrigen.
  es_complementaria BOOLEAN NOT NULL DEFAULT FALSE,
  nif_norma    VARCHAR(10) REFERENCES nif_normas(clave),

  nivel        SMALLINT NOT NULL DEFAULT 1,

  -- Sólo las hojas reciben movimientos. Una cuenta con hijos que además admite
  -- pólizas produce un saldo que no es ni el propio ni el consolidado, y ya no
  -- hay forma de saber cuál se está leyendo.
  permite_movimientos BOOLEAN NOT NULL DEFAULT TRUE,

  -- Dimensiones exigidas al asentar. '105 Clientes' sin party_id es un saldo
  -- que no se puede cobrar: se sabe cuánto, no a quién.
  requiere_tercero   BOOLEAN NOT NULL DEFAULT FALSE,
  requiere_producto  BOOLEAN NOT NULL DEFAULT FALSE,
  requiere_almacen   BOOLEAN NOT NULL DEFAULT FALSE,
  requiere_centro    BOOLEAN NOT NULL DEFAULT FALSE,

  moneda       CHAR(3) NOT NULL DEFAULT 'MXN',
  activa       BOOLEAN NOT NULL DEFAULT TRUE,
  notas        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cta_naturaleza CHECK (naturaleza IN ('DEUDORA','ACREEDORA')),
  CONSTRAINT cta_tipo CHECK (tipo IN
    ('ACTIVO','PASIVO','CAPITAL','INGRESO','COSTO','GASTO','RIF','ORDEN')),
  CONSTRAINT cta_unica UNIQUE (company_id, codigo)
);
CREATE INDEX IF NOT EXISTS ix_ctas_company  ON accounting_accounts(company_id);
CREATE INDEX IF NOT EXISTS ix_ctas_parent   ON accounting_accounts(parent_id);
CREATE INDEX IF NOT EXISTS ix_ctas_agrup    ON accounting_accounts(codigo_agrupador);
CREATE INDEX IF NOT EXISTS ix_ctas_mov      ON accounting_accounts(company_id, permite_movimientos)
  WHERE activa;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Equivalencias con OTROS catálogos
--
-- El SAT vive en 'codigo_agrupador' porque es el único obligatorio y va en el
-- XML. Los demás catálogos —el del despacho, el de otra empresa del grupo, el
-- clasificador de EDOSFINANCIEROS— viven aquí, y pueden ser varios a la vez.
--
-- Esta tabla es lo que hace posible el empate sin re-numerar nada.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting_account_equivalences (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES accounting_accounts(id) ON DELETE CASCADE,
  -- 'DESPACHO', 'EDOSFINANCIEROS', 'GRUPO_HCGM_2024', lo que haga falta.
  catalogo     VARCHAR(40) NOT NULL,
  codigo_externo      VARCHAR(40) NOT NULL,
  descripcion_externa VARCHAR(250),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Una cuenta tiene UNA equivalencia por catálogo. Dos sería ambigüedad pura:
  -- al exportar no habría forma de elegir.
  CONSTRAINT equiv_unica UNIQUE (account_id, catalogo)
);
CREATE INDEX IF NOT EXISTS ix_equiv_cat ON accounting_account_equivalences(company_id, catalogo);

-- ───────────────────────────────────────────────────────────────────────────
-- 7. Configuración contable de la empresa
--
-- Separada de 'companies' para no seguir engordándola indefinidamente.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_accounting_settings (
  company_id            UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  contabilidad_activa   BOOLEAN NOT NULL DEFAULT FALSE,
  marco_normativo       VARCHAR(20) NOT NULL DEFAULT 'NIF',
  moneda_funcional      CHAR(3) NOT NULL DEFAULT 'MXN',
  mes_inicio_ejercicio  SMALLINT NOT NULL DEFAULT 1,
  metodo_valuacion_inv  VARCHAR(20) NOT NULL DEFAULT 'PROMEDIO',
  -- Si el asiento automático está apagado, los eventos se acumulan sin asentar
  -- y se procesan a mano. Es el modo con el que conviene arrancar.
  asiento_automatico    BOOLEAN NOT NULL DEFAULT FALSE,
  permite_polizas_manuales BOOLEAN NOT NULL DEFAULT TRUE,
  -- Envío del Anexo 24 al buzón. Apagado: se decidió contabilidad interna
  -- primero. El código agrupador se captura igual.
  envia_anexo24         BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_inicio_operacion DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cas_mes CHECK (mes_inicio_ejercicio BETWEEN 1 AND 12),
  CONSTRAINT cas_valuacion CHECK (metodo_valuacion_inv IN ('PROMEDIO','CAPAS','ULTIMO','ESTANDAR'))
);

-- ───────────────────────────────────────────────────────────────────────────
-- 8. Una cuenta con hijos no puede recibir movimientos
--
-- Se hace en la base y no en TypeScript porque el catálogo se puede tocar desde
-- varios lados (pantalla, semilla, carga de balanza, importación de catálogo
-- ajeno) y la regla tiene que valer para todos, no sólo para el que se acordó.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION acc_padre_no_recibe_movimientos()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    UPDATE accounting_accounts
       SET permite_movimientos = FALSE, updated_at = NOW()
     WHERE id = NEW.parent_id
       AND permite_movimientos = TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_acc_padre_no_mov ON accounting_accounts;
CREATE TRIGGER trg_acc_padre_no_mov
  AFTER INSERT OR UPDATE OF parent_id ON accounting_accounts
  FOR EACH ROW EXECUTE FUNCTION acc_padre_no_recibe_movimientos();
