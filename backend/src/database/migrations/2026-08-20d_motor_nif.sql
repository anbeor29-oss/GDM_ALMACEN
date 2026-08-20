-- ═══════════════════════════════════════════════════════════════════════════
-- Motor NIF: reglas versionadas, evaluaciones y hallazgos
--
-- PARA QUÉ
-- Una norma clasificando a una cuenta no sirve de nada si nadie la ejecuta.
-- Este es el motor que la ejecuta: toma los saldos y dice qué exige la NIF
-- que hoy no se está cumpliendo.
--
-- ── TRES ESTADOS, NO DOS ──
-- El sistema reportaba "222 cuentas sin norma NIF" como si fueran trabajo
-- pendiente. No lo son. Hay tres situaciones distintas y confundirlas hace
-- que el aviso sea ruido:
--
--   ESPECIFICA  → le aplica una NIF concreta.  115 Inventario → C-4.
--
--   NO_APLICA   → correctamente no tiene ninguna. El IVA acreditable no es un
--                 instrumento financiero (esos son contractuales; el impuesto
--                 es de ley) ni un impuesto a la utilidad (D-4 cubre ISR y
--                 PTU, no impuestos indirectos). Se presenta y ya.
--
--   DEPENDE     → no se puede saber sin ver qué hay dentro. '121 Otros
--                 activos a corto plazo' puede ser cualquier cosa; quien lo
--                 sabe es la empresa, no el catálogo.
--
-- Marcar el IVA como C-3 "para que no salga en la lista" sería peor que
-- dejarlo vacío: el motor empezaría a exigirle estimación de pérdida
-- crediticia esperada a un saldo que se compensa contra el propio impuesto.
--
-- ── POR QUÉ LAS REGLAS SE VERSIONAN ──
-- Las NIF cambian. Un hallazgo de hace dos años se emitió bajo la regla de
-- entonces, y releerlo con la de hoy lo vuelve incomprensible. Cada hallazgo
-- guarda la VERSIÓN de la regla que lo produjo — el mismo principio que
-- "toda póliza conserva la versión de la regla que la generó".
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El tercer estado, en los dos catálogos ──
ALTER TABLE sat_codigos_agrupadores
  ADD COLUMN IF NOT EXISTS nif_aplica VARCHAR(12) NOT NULL DEFAULT 'DEPENDE';
ALTER TABLE sat_codigos_agrupadores DROP CONSTRAINT IF EXISTS chk_sat_nif_aplica;
ALTER TABLE sat_codigos_agrupadores ADD CONSTRAINT chk_sat_nif_aplica
  CHECK (nif_aplica IN ('ESPECIFICA', 'NO_APLICA', 'DEPENDE'));

ALTER TABLE accounting_accounts
  ADD COLUMN IF NOT EXISTS nif_aplica VARCHAR(12) NOT NULL DEFAULT 'DEPENDE';
ALTER TABLE accounting_accounts DROP CONSTRAINT IF EXISTS chk_cta_nif_aplica;
ALTER TABLE accounting_accounts ADD CONSTRAINT chk_cta_nif_aplica
  CHECK (nif_aplica IN ('ESPECIFICA', 'NO_APLICA', 'DEPENDE'));

-- Coherencia: si dice ESPECIFICA, tiene que traer la norma.
ALTER TABLE accounting_accounts DROP CONSTRAINT IF EXISTS chk_cta_nif_coherente;
ALTER TABLE accounting_accounts ADD CONSTRAINT chk_cta_nif_coherente
  CHECK (nif_aplica <> 'ESPECIFICA' OR nif_norma IS NOT NULL);

-- ── 2. El catálogo de reglas ──
CREATE TABLE IF NOT EXISTS nif_reglas (
  clave        VARCHAR(60) NOT NULL,
  version      SMALLINT    NOT NULL DEFAULT 1,
  norma        VARCHAR(10) NOT NULL REFERENCES nif_normas(clave),
  ambito       VARCHAR(20) NOT NULL,
  titulo       VARCHAR(200) NOT NULL,
  que_exige    TEXT NOT NULL,
  -- Qué pasa si no se cumple. Es lo que convierte un aviso en una decisión.
  consecuencia TEXT NOT NULL,
  fundamento   VARCHAR(200),
  severidad    VARCHAR(15) NOT NULL DEFAULT 'MEDIA',
  vigente_desde DATE NOT NULL DEFAULT '2020-01-01',
  vigente_hasta DATE,
  activa       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (clave, version),
  CONSTRAINT chk_regla_ambito CHECK (ambito IN
    ('RECONOCIMIENTO','VALUACION','PRESENTACION','REVELACION')),
  CONSTRAINT chk_regla_severidad CHECK (severidad IN ('ALTA','MEDIA','INFORMATIVA'))
);

-- ── 3. Cada corrida del motor ──
CREATE TABLE IF NOT EXISTS nif_evaluaciones (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fecha_corte  DATE NOT NULL,
  -- De dónde salieron los saldos evaluados.
  origen       VARCHAR(20) NOT NULL DEFAULT 'BALANZA',
  reglas_corridas SMALLINT NOT NULL DEFAULT 0,
  cumple       SMALLINT NOT NULL DEFAULT 0,
  no_cumple    SMALLINT NOT NULL DEFAULT 0,
  revisar      SMALLINT NOT NULL DEFAULT 0,
  no_aplica    SMALLINT NOT NULL DEFAULT 0,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_eval_origen CHECK (origen IN ('BALANZA','CATALOGO','POLIZAS'))
);
CREATE INDEX IF NOT EXISTS ix_nif_eval_empresa
  ON nif_evaluaciones(company_id, fecha_corte DESC);

-- ── 4. Los hallazgos ──
CREATE TABLE IF NOT EXISTS nif_hallazgos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  evaluacion_id UUID NOT NULL REFERENCES nif_evaluaciones(id) ON DELETE CASCADE,
  regla_clave   VARCHAR(60) NOT NULL,
  -- La versión con la que se emitió. Sin ella, un hallazgo viejo releído con
  -- la regla nueva no se puede interpretar.
  regla_version SMALLINT NOT NULL,
  norma         VARCHAR(10) NOT NULL,
  ambito        VARCHAR(20) NOT NULL,
  estado        VARCHAR(20) NOT NULL,
  severidad     VARCHAR(15) NOT NULL,
  mensaje       TEXT NOT NULL,
  -- Las cifras que llevaron a la conclusión: sin ellas el hallazgo es una
  -- opinión, y con ellas es una cuenta que se puede rehacer.
  cifras        JSONB NOT NULL DEFAULT '{}',
  cuentas       TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_hallazgo_estado CHECK (estado IN
    ('CUMPLE','NO_CUMPLE','REQUIERE_REVISION','NO_APLICA')),
  FOREIGN KEY (regla_clave, regla_version) REFERENCES nif_reglas(clave, version)
);
CREATE INDEX IF NOT EXISTS ix_nif_hallazgos_eval ON nif_hallazgos(evaluacion_id);
CREATE INDEX IF NOT EXISTS ix_nif_hallazgos_estado
  ON nif_hallazgos(evaluacion_id, estado) WHERE estado <> 'CUMPLE';
