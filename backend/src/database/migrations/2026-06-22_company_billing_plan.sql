-- Modelo de negocio de la plataforma:
--   · `renta`  → renta mensual $350-400 + pago por timbre adicional (sin cap)
--   · `iguala` → iguala $500 + 100 timbres incluidos (cap_timbres = 100)
--
-- billing_plan controla el comportamiento del contador en /archive/usage/current-month
-- y los warnings del Dashboard.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_plan  VARCHAR(16) DEFAULT 'iguala';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cap_timbres   INTEGER     DEFAULT 100;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS monthly_fee   NUMERIC(8,2) DEFAULT 500.00;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS extra_stamp_fee NUMERIC(6,2) DEFAULT 0.80;

-- Constraint: plan debe ser conocido
ALTER TABLE companies DROP CONSTRAINT IF EXISTS chk_billing_plan;
ALTER TABLE companies ADD CONSTRAINT chk_billing_plan
  CHECK (billing_plan IN ('renta', 'iguala'));

-- Demo seed
UPDATE companies SET billing_plan = 'iguala', cap_timbres = 100, monthly_fee = 500
 WHERE billing_plan IS NULL OR cap_timbres IS NULL;

COMMENT ON COLUMN companies.billing_plan IS 'renta=por uso | iguala=cap fijo de timbres';
COMMENT ON COLUMN companies.cap_timbres  IS 'Cap mensual (solo aplica si billing_plan=iguala)';
