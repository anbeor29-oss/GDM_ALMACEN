-- ============================================================================
-- MÓDULO FACTURACIÓN Y CONSUMO — Fase 1 (foundational)
--
-- Extiende el modelo comercial existente (stamp_packages + stamp_usage) con:
--   · Rollover mensual del cap no usado (plan iguala).
--   · Bitácora de facturación mensual (monthly_invoicing).
--   · Bolsa prepago para plan FLEX (prepaid_stamp_balance + purchases).
--   · Vista v_stamp_usage_current ampliada con cap efectivo (cap + rollover).
--
-- Referencia: docs/DISENO_FACTURACION_PLANES.md
-- Todo idempotente (IF NOT EXISTS / OR REPLACE).
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) ROLLOVER: timbres no usados del mes anterior que se suman al cap
--    del mes actual. Solo aplica a planes iguala; renta y FLEX lo ignoran.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS carried_over_stamps INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN companies.carried_over_stamps IS
  'Timbres acumulados del cap no usado en meses previos (rollover, plan iguala)';

-- ─────────────────────────────────────────────────────────────────────
-- 2) MONTHLY INVOICING: una fila por empresa por mes con el desglose
--    de renta + extras + total. Origen de la CFDI que HCGM emite al
--    cliente cada día 1.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS monthly_invoicing (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id                  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    billing_period              DATE NOT NULL,  -- YYYY-MM-01 (mes facturado)
    package_code                VARCHAR(16) NOT NULL,
    stamps_included             INT NOT NULL DEFAULT 0,
    stamps_used                 INT NOT NULL DEFAULT 0,
    stamps_extra                INT NOT NULL DEFAULT 0,
    stamps_rolled_over_from_prev INT NOT NULL DEFAULT 0,
    stamps_rolling_to_next        INT NOT NULL DEFAULT 0,
    monthly_fee_mxn             NUMERIC(10,2) NOT NULL DEFAULT 0,
    extra_charge_mxn            NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_mxn                   NUMERIC(10,2) NOT NULL DEFAULT 0,
    -- Estado del ciclo de cobro
    status                      VARCHAR(16) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'INVOICED', 'PAID', 'CANCELLED', 'ERROR')),
    -- CFDI que HCGM emitió al cliente (si se timbró automáticamente)
    invoice_id                  UUID REFERENCES invoices(id) ON DELETE SET NULL,
    invoice_folio               VARCHAR(32),
    invoice_uuid                VARCHAR(36),
    -- Meta para prorrateo si hubo cambio de plan mid-month
    had_plan_change             BOOLEAN NOT NULL DEFAULT FALSE,
    plan_change_details         JSONB,  -- { from_plan, to_plan, change_date, days_in_from, days_in_to }
    -- Trazabilidad
    generated_at                TIMESTAMP NOT NULL DEFAULT NOW(),
    generated_by                UUID REFERENCES users(id),
    paid_at                     TIMESTAMP,
    last_error                  TEXT,
    UNIQUE (company_id, billing_period)
);

CREATE INDEX IF NOT EXISTS idx_monthly_invoicing_period
  ON monthly_invoicing (billing_period);
CREATE INDEX IF NOT EXISTS idx_monthly_invoicing_company_status
  ON monthly_invoicing (company_id, status);

COMMENT ON TABLE monthly_invoicing IS
  'Bitácora inmutable de facturación mensual (uno por empresa por mes)';
COMMENT ON COLUMN monthly_invoicing.plan_change_details IS
  'JSON con detalle del prorrateo si hubo cambio de plan en el mes';

-- ─────────────────────────────────────────────────────────────────────
-- 3) PREPAGO FLEX: bolsa de timbres pre-cargados por bloques de 30.
--    Al llegar a 0 el sistema bloquea el timbrado.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prepaid_stamp_balance (
    company_id       UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    balance          INT NOT NULL DEFAULT 0 CHECK (balance >= 0),
    low_threshold    INT NOT NULL DEFAULT 5 CHECK (low_threshold >= 0),
    -- Flags para no spamear las alertas de correo
    low_notified_at  TIMESTAMP,
    zero_notified_at TIMESTAMP,
    updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE prepaid_stamp_balance IS
  'Bolsa prepago del plan FLEX. Al llegar a 0 se bloquea el timbrado.';

CREATE TABLE IF NOT EXISTS prepaid_stamp_purchases (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    stamps_bought     INT NOT NULL CHECK (stamps_bought > 0),
    unit_price_mxn    NUMERIC(6,2) NOT NULL,
    total_mxn         NUMERIC(10,2) NOT NULL,
    payment_method    VARCHAR(20),   -- transferencia | efectivo | tarjeta | otro
    payment_reference VARCHAR(128),  -- folio SPEI / referencia bancaria
    notes             TEXT,
    granted_by        UUID REFERENCES users(id),
    granted_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prepaid_purchases_company
  ON prepaid_stamp_purchases (company_id, granted_at DESC);

COMMENT ON TABLE prepaid_stamp_purchases IS
  'Bitácora de compras de timbres prepago (para reporte de ingresos HCGM)';

-- Inicialización: cada empresa con plan PKG_FLEX debe tener su fila en
-- prepaid_stamp_balance (aunque sea con balance = 0). Se crea perezosamente
-- desde el helper si no existe.

-- ─────────────────────────────────────────────────────────────────────
-- 4) VISTA v_stamp_usage_current AMPLIADA con cap efectivo
--    (cap del plan + rollover) y flag de si es plan prepago FLEX.
--
--    ⚠ DROP antes de CREATE: la versión nueva inserta columnas en medio
--    (carried_over_stamps, effective_cap) y Postgres NO permite reordenar
--    columnas con CREATE OR REPLACE VIEW — solo agregar al final. Sin el
--    DROP, la migración truena con "cannot change name of view column".
--    Nada en SQL depende de esta vista (solo la consulta el backend).
-- ─────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS v_stamp_usage_current;

CREATE VIEW v_stamp_usage_current AS
SELECT
    c.id                             AS company_id,
    c.rfc,
    c.business_name,
    c.stamp_package_code,
    sp.monthly_stamps                AS quota,
    sp.monthly_fee_mxn,
    sp.extra_stamp_mxn,
    c.carried_over_stamps,
    -- Cap efectivo del mes en curso (cap del plan + rollover del previo).
    -- Para FLEX el cap es 0 y se ignora — la limitación viene del prepago.
    (sp.monthly_stamps + c.carried_over_stamps) AS effective_cap,
    COALESCE(u.used, 0)              AS used_current_month,
    -- 'remaining' es contra el cap efectivo (no el nominal del plan).
    GREATEST(sp.monthly_stamps + c.carried_over_stamps - COALESCE(u.used, 0), 0)
                                     AS remaining,
    CASE WHEN (sp.monthly_stamps + c.carried_over_stamps) = 0 THEN 0
         ELSE ROUND(100.0 * COALESCE(u.used, 0)
                    / (sp.monthly_stamps + c.carried_over_stamps), 1)
    END                              AS percent_used,
    -- Flag conveniente para el frontend
    (c.stamp_package_code = 'PKG_FLEX') AS is_prepaid,
    -- Saldo prepago (solo tiene sentido para FLEX; 0 en el resto)
    COALESCE(pb.balance, 0)          AS prepaid_balance,
    pb.low_threshold                 AS prepaid_low_threshold
FROM companies c
JOIN stamp_packages sp ON sp.code = c.stamp_package_code
LEFT JOIN LATERAL (
    SELECT count(*) AS used
      FROM stamp_usage su
     WHERE su.company_id = c.id
       AND su.billing_period = date_trunc('month', NOW())::date
) u ON TRUE
LEFT JOIN prepaid_stamp_balance pb ON pb.company_id = c.id;

COMMENT ON VIEW v_stamp_usage_current IS
  'Consumo del mes actual con cap efectivo (rollover incluido) y saldo prepago';

COMMIT;
