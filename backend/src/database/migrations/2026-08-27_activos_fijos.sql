-- ============================================================================
-- ACTIVOS FIJOS Y SU DEPRECIACIÓN (LISR art. 33-35 · NIF C-6/C-8)
--
-- Cuando una compra manda una partida a una cuenta de activo fijo (15x) o
-- diferido/intangible (17x), esa partida ES la adquisición de un activo: su MOI
-- (monto original de la inversión) es el cargo neto y la fecha es la del CFDI.
-- De ahí sale, en automático, la depreciación en línea recta.
--
-- Dos tablas: el REGISTRO del activo (su cédula) y el renglón de depreciación de
-- cada MES. La póliza mensual se arma de estos renglones; no se guarda saldo, se
-- deriva (igual que la balanza). El renglón cuelga de la póliza del mes: si se
-- borra la póliza para regenerar, el mes se libera (ON DELETE CASCADE).
-- ============================================================================

CREATE TABLE IF NOT EXISTS activos_fijos (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  descripcion    TEXT NOT NULL,
  -- Rubro que fija la tasa y las cuentas (vehiculos, computo, mobiliario…).
  categoria      VARCHAR(24) NOT NULL,

  -- El activo se registra por CÓDIGO de cuenta (no por id): la partida de compra
  -- ya trae el código (154.01) y así el registro es legible y estable.
  cuenta_activo    VARCHAR(30) NOT NULL,   -- 15x/17x — el activo
  cuenta_gasto     VARCHAR(30),            -- 701.x/702.x — gasto por depreciación/amortización
  cuenta_dep_acum  VARCHAR(30),            -- 171.x/183.x — depreciación/amortización acumulada (complementaria)

  moi              NUMERIC(16,2) NOT NULL CHECK (moi >= 0),  -- monto original de la inversión (neto, sin IVA)
  valor_residual   NUMERIC(16,2) NOT NULL DEFAULT 0,         -- casi siempre 0 en México (fiscal)
  fecha_adquisicion DATE NOT NULL,
  -- Primer día del mes en que ARRANCA la depreciación (por defecto, el mes de la
  -- adquisición). Editable: la LISR permite empezar desde el mes de uso.
  mes_inicio       DATE NOT NULL,
  tasa_anual       NUMERIC(6,4) NOT NULL CHECK (tasa_anual >= 0 AND tasa_anual <= 1),  -- 0.2500 = 25 %

  estado           VARCHAR(12) NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO','BAJA')),
  fecha_baja       DATE,

  -- De dónde salió (para no registrarlo dos veces y para poder rastrearlo).
  origen_uuid      VARCHAR(40),            -- el CFDI de compra
  origen_folio     VARCHAR(40),
  clave_prod_serv  VARCHAR(16),
  proveedor_rfc    VARCHAR(13),
  proveedor_nombre VARCHAR(250),

  notas            TEXT,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un mismo renglón de compra (CFDI + cuenta de activo) no se registra dos veces:
-- así «detectar desde compras» es idempotente. Los altas manuales van sin CFDI.
CREATE UNIQUE INDEX IF NOT EXISTS ux_activo_origen
  ON activos_fijos (company_id, origen_uuid, cuenta_activo)
  WHERE origen_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_activo_empresa ON activos_fijos (company_id, estado);

CREATE TABLE IF NOT EXISTS activo_fijo_depreciacion (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  activo_id   UUID NOT NULL REFERENCES activos_fijos(id) ON DELETE CASCADE,

  anio        SMALLINT NOT NULL,
  mes         SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  monto       NUMERIC(16,2) NOT NULL CHECK (monto >= 0),

  -- La póliza del mes que asentó esta depreciación. Si se borra la póliza para
  -- regenerar, el renglón se va con ella y el mes vuelve a estar disponible.
  entry_id    UUID REFERENCES journal_entries(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Un activo se deprecia UNA vez por mes.
  CONSTRAINT ux_depre_activo_mes UNIQUE (activo_id, anio, mes)
);

CREATE INDEX IF NOT EXISTS ix_depre_empresa_periodo ON activo_fijo_depreciacion (company_id, anio, mes);
CREATE INDEX IF NOT EXISTS ix_depre_entry ON activo_fijo_depreciacion (entry_id);

COMMENT ON TABLE activos_fijos IS
  'Cédula de activos fijos. La depreciación en línea recta (LISR 33-35) se deriva de aquí.';
