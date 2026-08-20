-- ═══════════════════════════════════════════════════════════════════════════
-- Saldos por periodo: el lugar donde caen las cifras, vengan de donde vengan
--
-- ── EL PROBLEMA QUE RESUELVE ──
-- Hasta ahora los estados financieros leían un archivo que se acababa de
-- subir. Eso es un visor, no una contabilidad: cierras la pantalla y no queda
-- nada. No se puede comparar contra el mes pasado, no se puede cerrar un mes,
-- y cada quien ve lo que trajo en su archivo.
--
-- Los estados tienen que leer EL PERIODO. Y el periodo se alimenta de varias
-- fuentes, en momentos distintos:
--
--     balanza de otro sistema  ─┐
--     CFDI emitidos            ─┤
--     CFDI recibidos           ─┼──►  saldos del periodo  ──►  todos los
--     nómina timbrada          ─┤                              estados
--     pólizas capturadas       ─┘
--
-- Por eso el saldo vive aquí y no se recalcula desde el origen cada vez: el
-- origen puede ser un archivo que ya no está, o un XML que llegó en marzo por
-- una operación de enero.
--
-- ── POR QUÉ SE GUARDAN LAS CUATRO CIFRAS Y NO SÓLO EL SALDO FINAL ──
-- Saldo inicial, cargos, abonos y saldo final. Con sólo el final no se puede
-- armar una balanza —que es lo que pide el Anexo 24— ni saber si el mes tuvo
-- movimiento o viene arrastrando. Y el enlace entre meses (el final de uno es
-- el inicial del siguiente) deja de poder comprobarse.
--
-- ── EL CIERRE ──
-- Cerrar un mes congela sus saldos. Un periodo cerrado que sigue admitiendo
-- cifras no es un cierre: es una sugerencia, y la balanza que se envió al SAT
-- deja de coincidir con la que el sistema muestra.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS accounting_period_balances (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  periodo_id   UUID NOT NULL REFERENCES accounting_periods(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,

  saldo_inicial NUMERIC(16,2) NOT NULL DEFAULT 0,
  cargos        NUMERIC(16,2) NOT NULL DEFAULT 0,
  abonos        NUMERIC(16,2) NOT NULL DEFAULT 0,
  saldo_final   NUMERIC(16,2) NOT NULL DEFAULT 0,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Una cuenta tiene UN saldo por periodo. Dos filas serían dos verdades.
  CONSTRAINT saldo_unico_por_periodo UNIQUE (periodo_id, account_id)
);
CREATE INDEX IF NOT EXISTS ix_saldos_periodo ON accounting_period_balances(periodo_id);
CREATE INDEX IF NOT EXISTS ix_saldos_empresa ON accounting_period_balances(company_id, periodo_id);

-- ───────────────────────────────────────────────────────────────────────────
-- Qué alimentó cada periodo
--
-- Sin esto, un saldo es un número sin procedencia. Con esto se puede contestar
-- "¿de dónde salió esta cifra?" —que es la pregunta que hace cualquiera que
-- revise— y saber qué falta por cargar de un mes.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting_period_sources (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  periodo_id   UUID NOT NULL REFERENCES accounting_periods(id) ON DELETE CASCADE,

  -- BALANZA_EXTERNA · CFDI_EMITIDOS · CFDI_RECIBIDOS · NOMINA · POLIZAS · MANUAL
  fuente       VARCHAR(20) NOT NULL,
  descripcion  VARCHAR(250),
  -- Cuántas cuentas tocó y cuánto movió: el resumen de lo que hizo esta carga.
  cuentas      INTEGER NOT NULL DEFAULT 0,
  total_cargos NUMERIC(16,2) NOT NULL DEFAULT 0,
  total_abonos NUMERIC(16,2) NOT NULL DEFAULT 0,
  -- Reemplaza lo anterior de esa fuente, o se suma a lo que hay.
  modo         VARCHAR(12) NOT NULL DEFAULT 'REEMPLAZA',
  archivo      VARCHAR(250),
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_fuente CHECK (fuente IN
    ('BALANZA_EXTERNA','CFDI_EMITIDOS','CFDI_RECIBIDOS','NOMINA','POLIZAS','MANUAL')),
  CONSTRAINT chk_modo CHECK (modo IN ('REEMPLAZA','ACUMULA'))
);
CREATE INDEX IF NOT EXISTS ix_fuentes_periodo ON accounting_period_sources(periodo_id, created_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
-- Un periodo cerrado no admite cifras
--
-- Va en la base y no en TypeScript porque a los saldos les van a escribir
-- varias fuentes —la importación de balanza, el motor de eventos, la captura
-- de pólizas—, y una regla repetida en cinco lugares se olvida en el sexto.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION periodo_cerrado_no_admite_saldos()
RETURNS TRIGGER AS $$
DECLARE
  est VARCHAR(15);
BEGIN
  SELECT estado INTO est FROM accounting_periods WHERE id = NEW.periodo_id;
  IF est = 'CERRADO' THEN
    RAISE EXCEPTION 'El periodo está cerrado y no admite cambios de saldo. '
                    'Reábrelo si de verdad hay que corregirlo.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_periodo_cerrado ON accounting_period_balances;
CREATE TRIGGER trg_periodo_cerrado
  BEFORE INSERT OR UPDATE ON accounting_period_balances
  FOR EACH ROW EXECUTE FUNCTION periodo_cerrado_no_admite_saldos();

-- ───────────────────────────────────────────────────────────────────────────
-- Quién cerró y cuándo ya está en accounting_periods; se agrega el rastro del
-- envío al SAT, para saber si lo que se muestra es lo que se declaró.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE accounting_periods
  ADD COLUMN IF NOT EXISTS enviado_sat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tipo_envio VARCHAR(15);
ALTER TABLE accounting_periods DROP CONSTRAINT IF EXISTS chk_tipo_envio;
ALTER TABLE accounting_periods ADD CONSTRAINT chk_tipo_envio
  CHECK (tipo_envio IS NULL OR tipo_envio IN ('NORMAL','COMPLEMENTARIA'));
