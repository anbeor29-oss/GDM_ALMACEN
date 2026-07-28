-- ================================================================
-- INVENTARIO — Reportes, snapshots mensuales y proveedores (Fase 2)
-- M3: extensiones de proveedor + supplier_products + pagos programados
-- Snapshots: valor del inventario guardado mes a mes
-- Vistas: rotación de productos y exigencias de conteo físico
-- ================================================================
-- Idempotente y autosuficiente en BD virgen (regla 26): solo depende de
-- schema.sql base + 2026-07-10_inventory_core.sql (orden alfabético correcto:
-- _inventory_core < _inventory_reports).

-- ----------------------------------------------------------------
-- M3a · Extensiones de proveedor sobre customers (party_type=SUPPLIER)
-- ----------------------------------------------------------------
ALTER TABLE customers ADD COLUMN IF NOT EXISTS delivery_days_avg  INT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS supplier_rating    SMALLINT
  CHECK (supplier_rating IS NULL OR supplier_rating BETWEEN 1 AND 5);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_conditions VARCHAR(100);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_line        NUMERIC(15,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_used        NUMERIC(15,2) DEFAULT 0;

-- ----------------------------------------------------------------
-- M3b · Productos que suministra cada proveedor (§4)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_products (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id        UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id         UUID NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  last_price         NUMERIC(15,6),
  last_purchase_date TIMESTAMP,
  purchases_count    INT NOT NULL DEFAULT 0,
  is_primary         BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE(supplier_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_products_product ON supplier_products(product_id);

-- ----------------------------------------------------------------
-- M3c · Pagos programados a proveedores (conclusión ALMACEN.MD:
--       "actualizando la línea de crédito y programando pagos cada semana")
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_payments_schedule (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  xml_import_id UUID REFERENCES xml_imports(id) ON DELETE SET NULL,
  amount        NUMERIC(15,2) NOT NULL CHECK (amount >= 0),
  due_date      DATE NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING', 'PAID', 'CANCELLED')),
  paid_at       TIMESTAMP,
  notes         TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_due
  ON supplier_payments_schedule(company_id, due_date) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier
  ON supplier_payments_schedule(supplier_id);

-- ----------------------------------------------------------------
-- Snapshots · Valor del inventario mes a mes
-- warehouse_id NULL = consolidado de toda la empresa
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_value_snapshots (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  warehouse_id   UUID REFERENCES warehouses(id) ON DELETE CASCADE,
  snapshot_month DATE NOT NULL,          -- siempre día 1 del mes
  total_units    NUMERIC(18,6) NOT NULL DEFAULT 0,
  total_value    NUMERIC(18,2) NOT NULL DEFAULT 0,
  products_count INT NOT NULL DEFAULT 0,
  source         VARCHAR(16) NOT NULL DEFAULT 'CRON'
                 CHECK (source IN ('CRON', 'MANUAL')),
  taken_at       TIMESTAMP NOT NULL DEFAULT NOW(),

  -- NULLS NOT DISTINCT: el consolidado (warehouse_id NULL) también es único
  -- por empresa+mes (requiere PostgreSQL 15+; local corre 16)
  UNIQUE NULLS NOT DISTINCT (company_id, warehouse_id, snapshot_month)
);

CREATE INDEX IF NOT EXISTS idx_inv_snapshots_company_month
  ON inventory_value_snapshots(company_id, snapshot_month DESC);

COMMENT ON TABLE inventory_value_snapshots IS
  'Valuación del inventario congelada mes a mes — cron día 1 + snapshot manual';

-- ----------------------------------------------------------------
-- Vista · Rotación de productos (§12)
-- rotation_30d = salidas por venta últimos 30 días / existencia actual
-- days_of_stock = a ritmo de venta de 30 días, cuántos días alcanza el stock
-- ----------------------------------------------------------------
DROP VIEW IF EXISTS v_inventory_rotation;
CREATE VIEW v_inventory_rotation AS
  WITH outs AS (
    SELECT company_id, product_id,
           COALESCE(SUM(quantity) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0) AS qty_out_30,
           COALESCE(SUM(quantity) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days'), 0) AS qty_out_90
      FROM inventory_movements
     WHERE movement_type = 'SALE_OUT'
     GROUP BY company_id, product_id
  ),
  last_mov AS (
    SELECT product_id, MAX(created_at) AS last_movement_at
      FROM inventory_movements
     GROUP BY product_id
  ),
  stock AS (
    SELECT product_id,
           SUM(quantity)            AS total_qty,
           SUM(quantity * avg_cost) AS total_value
      FROM warehouse_stock
     GROUP BY product_id
  )
  SELECT p.company_id,
         p.id AS product_id,
         p.sku,
         p.name,
         p.category,
         COALESCE(st.total_qty, 0)   AS total_qty,
         COALESCE(st.total_value, 0) AS total_value,
         COALESCE(o.qty_out_30, 0)   AS qty_out_30,
         COALESCE(o.qty_out_90, 0)   AS qty_out_90,
         CASE WHEN COALESCE(st.total_qty, 0) > 0
              THEN ROUND(COALESCE(o.qty_out_30, 0) / st.total_qty, 4) END AS rotation_30d,
         CASE WHEN COALESCE(o.qty_out_30, 0) > 0
              THEN ROUND(st.total_qty / (o.qty_out_30 / 30.0), 1) END     AS days_of_stock,
         lm.last_movement_at,
         CASE WHEN lm.last_movement_at IS NOT NULL
              THEN EXTRACT(DAY FROM NOW() - lm.last_movement_at)::int END AS days_without_movement
    FROM products p
    LEFT JOIN outs  o  ON o.product_id  = p.id
    LEFT JOIN stock st ON st.product_id = p.id
    LEFT JOIN last_mov lm ON lm.product_id = p.id
   WHERE p.deleted_at IS NULL;

-- ----------------------------------------------------------------
-- Vista · Exigencias de inventario físico (§11 preparatoria)
-- "Última verificación" = último INITIAL o AJUSTE sobre ese producto-almacén.
-- Umbrales: >90 días (o nunca) = URGENTE · >60 días = SUGERIDO · resto AL_DIA
-- ----------------------------------------------------------------
DROP VIEW IF EXISTS v_count_required;
CREATE VIEW v_count_required AS
  SELECT w.company_id,
         w.id   AS warehouse_id,
         w.code AS warehouse_code,
         w.name AS warehouse_name,
         p.id   AS product_id,
         p.sku,
         p.name AS product_name,
         ws.quantity,
         ws.quantity * ws.avg_cost AS stock_value,
         lv.last_verified_at,
         COALESCE(EXTRACT(DAY FROM NOW() - lv.last_verified_at)::int, 99999)
           AS days_since_verification,
         CASE
           WHEN lv.last_verified_at IS NULL                          THEN 'NUNCA_VERIFICADO'
           WHEN lv.last_verified_at < NOW() - INTERVAL '90 days'     THEN 'CONTEO_URGENTE'
           WHEN lv.last_verified_at < NOW() - INTERVAL '60 days'     THEN 'CONTEO_SUGERIDO'
           ELSE 'AL_DIA'
         END AS count_status
    FROM warehouse_stock ws
    JOIN warehouses w ON w.id = ws.warehouse_id AND w.deleted_at IS NULL
    JOIN products  p ON p.id = ws.product_id   AND p.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT MAX(m.created_at) AS last_verified_at
        FROM inventory_movements m
       WHERE m.product_id = ws.product_id
         AND (m.warehouse_from_id = ws.warehouse_id OR m.warehouse_to_id = ws.warehouse_id)
         AND m.movement_type IN ('INITIAL', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT')
    ) lv ON true
   WHERE ws.quantity > 0 OR ws.stock_minimum > 0;
