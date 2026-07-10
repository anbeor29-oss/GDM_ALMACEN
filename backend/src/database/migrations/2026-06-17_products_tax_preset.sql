-- ============================================================================
-- Columnas faltantes en products e invoice_items — extensiones agregadas
-- manualmente durante desarrollo local que no quedaron en el schema base.
--
-- Idempotente (IF NOT EXISTS). Corre solo una vez por ambiente.
-- ============================================================================

-- ─── products ────────────────────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS no_identificacion VARCHAR(40);
ALTER TABLE products ADD COLUMN IF NOT EXISTS currency          VARCHAR(3)  DEFAULT 'MXN';
ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_preset_id     VARCHAR(30);
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_name         VARCHAR(80);

-- Índice para búsquedas por preset (usado por reportes fiscales)
CREATE INDEX IF NOT EXISTS idx_products_tax_preset
    ON products (company_id, tax_preset_id)
    WHERE deleted_at IS NULL;

-- Backfill: productos existentes que no tienen preset → 'iva16' (default seguro)
UPDATE products
   SET tax_preset_id = 'iva16'
 WHERE tax_preset_id IS NULL
   AND tax_type = 'IVA'
   AND tax_rate = 0.16;
UPDATE products
   SET tax_preset_id = 'iva8'
 WHERE tax_preset_id IS NULL
   AND tax_type = 'IVA'
   AND tax_rate = 0.08;
UPDATE products
   SET tax_preset_id = 'iva0'
 WHERE tax_preset_id IS NULL
   AND tax_type = 'IVA'
   AND tax_rate = 0
   AND is_exempt = FALSE;
UPDATE products
   SET tax_preset_id = 'ivaex'
 WHERE tax_preset_id IS NULL
   AND is_exempt = TRUE;

COMMENT ON COLUMN products.tax_preset_id IS
    'Preset del catálogo de impuestos (iva16, iva8, iva0, ivaex, hon_pf_pm, resico_pf_pm, arr_pf_pm, ieps_tasa, auto_carga, desperdicios).';
COMMENT ON COLUMN products.currency IS
    'ISO 4217 c_Moneda: MXN, USD, EUR, etc. Default MXN.';
COMMENT ON COLUMN products.no_identificacion IS
    'Numero de identificacion propio (SKU alternativo del cliente, opcional).';

-- ─── invoice_items ───────────────────────────────────────────────────────────
-- Ya existía tax_preset_id pero por seguridad (idempotente):
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS tax_preset_id VARCHAR(30);

-- Backfill items existentes con el mismo criterio de products
UPDATE invoice_items ii
   SET tax_preset_id = COALESCE(p.tax_preset_id, 'iva16')
  FROM products p
 WHERE ii.product_id = p.id
   AND ii.tax_preset_id IS NULL;
