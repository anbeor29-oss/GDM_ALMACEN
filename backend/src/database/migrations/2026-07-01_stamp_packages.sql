-- ============================================================================
-- PAQUETES DE TIMBRES 100/200/500 y contadores mensuales
--
-- Modelo comercial:
--   PKG_100  → 100 timbres/mes  o hasta agotarse  · $399 MXN/mes
--   PKG_200  → 200 timbres/mes  o hasta agotarse  · $699 MXN/mes
--   PKG_500  → 500 timbres/mes  o hasta agotarse  · $1,399 MXN/mes
--   PKG_FLEX → sin cap fijo, pago por timbre       · $2.00 MXN/timbre
--
-- Reglas:
--   · Al timbrar → INSERT en stamp_usage y decremento del pool
--   · Cancelar CFDI NO devuelve el timbre (SAT lo cuenta igual)
--   · Reset automático el día 1 de cada mes (billing_period_start)
--   · SUPER_ADMIN puede cambiar plan; el nuevo aplica el siguiente ciclo
-- ============================================================================

BEGIN;

-- 1) Catálogo de paquetes (permite agregar planes sin migración)
CREATE TABLE IF NOT EXISTS stamp_packages (
    code            VARCHAR(16) PRIMARY KEY,
    name            VARCHAR(64) NOT NULL,
    monthly_stamps  INT         NOT NULL CHECK (monthly_stamps >= 0),
    monthly_fee_mxn NUMERIC(8,2) NOT NULL CHECK (monthly_fee_mxn >= 0),
    extra_stamp_mxn NUMERIC(6,2) NOT NULL DEFAULT 0,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP   NOT NULL DEFAULT NOW()
);

INSERT INTO stamp_packages (code, name, monthly_stamps, monthly_fee_mxn, extra_stamp_mxn) VALUES
    ('PKG_100', 'Paquete 100 timbres', 100,  399.00, 2.50),
    ('PKG_200', 'Paquete 200 timbres', 200,  699.00, 2.25),
    ('PKG_500', 'Paquete 500 timbres', 500, 1399.00, 2.00),
    ('PKG_FLEX','Uso libre (pay-per-stamp)', 0, 0.00, 2.00)
ON CONFLICT (code) DO UPDATE
   SET name = EXCLUDED.name,
       monthly_stamps = EXCLUDED.monthly_stamps,
       monthly_fee_mxn = EXCLUDED.monthly_fee_mxn,
       extra_stamp_mxn = EXCLUDED.extra_stamp_mxn;

-- 2) Asignación de paquete a cada empresa
ALTER TABLE companies ADD COLUMN IF NOT EXISTS stamp_package_code VARCHAR(16)
    REFERENCES stamp_packages(code) DEFAULT 'PKG_100';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_period_start DATE DEFAULT date_trunc('month', NOW())::date;

-- 3) Bitácora de consumo (una fila por CFDI timbrado)
CREATE TABLE IF NOT EXISTS stamp_usage (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    invoice_id       UUID REFERENCES invoices(id),
    credit_note_id   UUID REFERENCES credit_notes(id),
    stamp_uuid       VARCHAR(64),
    stamped_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    billing_period   DATE      NOT NULL DEFAULT date_trunc('month', NOW())::date,
    package_code_at_stamp VARCHAR(16) NOT NULL,
    was_extra        BOOLEAN   NOT NULL DEFAULT FALSE,  -- TRUE si superó el cap
    extra_charge_mxn NUMERIC(6,2) DEFAULT 0,
    CONSTRAINT chk_one_document CHECK (
        (invoice_id IS NOT NULL AND credit_note_id IS NULL) OR
        (invoice_id IS NULL AND credit_note_id IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_stamp_usage_company_period
    ON stamp_usage (company_id, billing_period);
CREATE INDEX IF NOT EXISTS idx_stamp_usage_period
    ON stamp_usage (billing_period);

-- 4) Vista de consumo del mes actual por empresa
CREATE OR REPLACE VIEW v_stamp_usage_current AS
SELECT
    c.id             AS company_id,
    c.rfc,
    c.business_name,
    c.stamp_package_code,
    sp.monthly_stamps AS quota,
    sp.monthly_fee_mxn,
    sp.extra_stamp_mxn,
    COALESCE(u.used, 0) AS used_current_month,
    GREATEST(sp.monthly_stamps - COALESCE(u.used, 0), 0) AS remaining,
    CASE WHEN sp.monthly_stamps = 0 THEN 0
         ELSE ROUND(100.0 * COALESCE(u.used, 0) / sp.monthly_stamps, 1)
    END AS percent_used
FROM companies c
JOIN stamp_packages sp ON sp.code = c.stamp_package_code
LEFT JOIN LATERAL (
    SELECT count(*) AS used
      FROM stamp_usage su
     WHERE su.company_id = c.id
       AND su.billing_period = date_trunc('month', NOW())::date
) u ON TRUE;

-- 5) audit_log de cambios de plan (compliance interno)
COMMENT ON TABLE stamp_packages IS 'Catálogo comercial — modificable sólo por SUPER_ADMIN';
COMMENT ON TABLE stamp_usage    IS 'Bitácora inmutable de timbres (compliance financiero)';

COMMIT;
