-- ============================================================================
-- JOURNAL — las pólizas, el corazón de la contabilidad (PLAN_CONTABILIDAD §2)
--
-- Dos tablas: la póliza (encabezado) y sus partidas. De aquí, sumando por cuenta
-- y por mes, sale la balanza; no se guarda ningún saldo, se deriva.
--
-- REGLAS NO NEGOCIABLES (del plan), en la BASE y no en TypeScript:
--   · SUM(cargo) = SUM(abono) en cada póliza — trigger DEFERRABLE al commit.
--   · Una partida es cargo O abono, nunca las dos ni negativas.
--   · Idempotencia: un CFDI genera UNA póliza (UNIQUE por origen_uuid). Volver a
--     "generar pólizas del mes" no duplica.
-- Una póliza asentada no se edita: se reversa (otra póliza con reversa_de_id).
-- ============================================================================

CREATE TABLE IF NOT EXISTS journal_entries (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  tipo          VARCHAR(10) NOT NULL DEFAULT 'DIARIO'      -- los 3 del Anexo 24
                CHECK (tipo IN ('INGRESO', 'EGRESO', 'DIARIO')),
  folio         INTEGER,                                    -- consecutivo por empresa/año
  fecha         DATE NOT NULL,
  concepto      TEXT,

  periodo_id    UUID REFERENCES accounting_periods(id),
  estado        VARCHAR(10) NOT NULL DEFAULT 'ASENTADA'
                CHECK (estado IN ('BORRADOR', 'ASENTADA', 'REVERSADA')),

  -- De dónde nació. origen_uuid = el CFDI que la originó (idempotencia).
  origen        VARCHAR(16) NOT NULL DEFAULT 'MANUAL'
                CHECK (origen IN ('MANUAL', 'CFDI', 'NOMINA', 'DEPRECIACION', 'APERTURA', 'BANCO')),
  origen_uuid   VARCHAR(40),
  regla         VARCHAR(40),                                -- p.ej. 'ventas_cfdi_v1'

  reversa_de_id UUID REFERENCES journal_entries(id),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Un CFDI no puede producir dos pólizas: la defensa real contra doble contabilización.
CREATE UNIQUE INDEX IF NOT EXISTS ux_journal_origen_uuid
  ON journal_entries (company_id, origen_uuid) WHERE origen_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_journal_empresa_fecha
  ON journal_entries (company_id, fecha);

CREATE TABLE IF NOT EXISTS journal_lines (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id    UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  orden       SMALLINT NOT NULL DEFAULT 1,

  account_id  UUID NOT NULL REFERENCES accounting_accounts(id),
  cargo       NUMERIC(16,2) NOT NULL DEFAULT 0,
  abono       NUMERIC(16,2) NOT NULL DEFAULT 0,
  concepto    TEXT,

  -- Dimensiones para trazar el renglón hasta su documento (lo que hace
  -- consultable a la contabilidad — §2.1 del plan).
  uuid_cfdi   VARCHAR(40),
  party_rfc   VARCHAR(13),

  CONSTRAINT jl_no_negativos CHECK (cargo >= 0 AND abono >= 0),
  CONSTRAINT jl_cargo_o_abono CHECK (NOT (cargo > 0 AND abono > 0))
);

CREATE INDEX IF NOT EXISTS ix_journal_lines_entry   ON journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS ix_journal_lines_account ON journal_lines (account_id);

-- ─── El cuadre, verificado en la base al cierre de la transacción ───────────
CREATE OR REPLACE FUNCTION trg_poliza_cuadra() RETURNS trigger AS $$
DECLARE
  dif NUMERIC(16,2);
BEGIN
  SELECT COALESCE(SUM(cargo), 0) - COALESCE(SUM(abono), 0)
    INTO dif
    FROM journal_lines
   WHERE entry_id = COALESCE(NEW.entry_id, OLD.entry_id);
  -- Una póliza sin renglones (dif = 0 porque no hay filas) se deja pasar: es una
  -- que se está borrando o aún llenando. El descuadre real es dif <> 0.
  IF dif <> 0 THEN
    RAISE EXCEPTION 'Póliza descuadrada: cargos - abonos = % (entry %)',
      dif, COALESCE(NEW.entry_id, OLD.entry_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS poliza_cuadra ON journal_lines;
CREATE CONSTRAINT TRIGGER poliza_cuadra
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_poliza_cuadra();

COMMENT ON TABLE journal_entries IS
  'Pólizas (Anexo 24). La balanza se deriva de aquí; no se guardan saldos.';
