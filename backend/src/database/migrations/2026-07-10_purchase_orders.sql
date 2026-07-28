-- ================================================================
-- INVENTARIO — Fase 4 (M5): Órdenes de cotización/compra + proyección
-- §2 y §3 de ALMACEN.MD: mínimos/máximos, proyección de faltantes a
-- 15 días y generación de órdenes con proveedor y cantidad sugeridos.
-- ================================================================
-- Idempotente y autosuficiente en BD virgen (regla 26): solo depende del
-- schema base + inventory_core + inventory_reports (orden alfabético:
-- _inventory_core < _inventory_reports_supplier < _purchase_orders ✓).

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  folio           INT  NOT NULL,
  order_type      VARCHAR(12) NOT NULL DEFAULT 'QUOTATION'
                  CHECK (order_type IN ('QUOTATION', 'PURCHASE')),
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING',          -- generada, sin cotizar
                                    'QUOTED',           -- cotizada con proveedor
                                    'APPROVED',         -- autorizada para compra
                                    'PURCHASED',        -- pedida al proveedor
                                    'RECEIVED_PARTIAL', -- mercancía parcial (§14)
                                    'RECEIVED',         -- completa
                                    'CANCELLED')),
  source          VARCHAR(10) NOT NULL DEFAULT 'MANUAL'
                  CHECK (source IN ('AUTO', 'MANUAL')), -- AUTO = generada por el análisis
  supplier_id     UUID REFERENCES customers(id)  ON DELETE SET NULL,
  warehouse_id    UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  needed_by_date  DATE,                                 -- fecha estimada de necesidad (§3)
  notes           TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_email VARCHAR(255),
  approved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at     TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE(company_id, folio)
);

CREATE INDEX IF NOT EXISTS idx_po_company_status ON purchase_orders(company_id, status);
CREATE INDEX IF NOT EXISTS idx_po_supplier       ON purchase_orders(supplier_id);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id    UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id           UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity_suggested   NUMERIC(15,6) NOT NULL DEFAULT 0,   -- lo que el análisis propuso
  quantity_ordered     NUMERIC(15,6) NOT NULL DEFAULT 0,   -- lo que se pidió (editable)
  quantity_received    NUMERIC(15,6) NOT NULL DEFAULT 0,   -- recepción acumulada (§14 parcial)
  last_purchase_price  NUMERIC(15,6),                      -- último precio conocido (§3)
  supplier_suggested_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE(purchase_order_id, product_id),
  CONSTRAINT chk_poi_received_lte CHECK (quantity_received >= 0)
);

CREATE INDEX IF NOT EXISTS idx_poi_product ON purchase_order_items(product_id);

-- Trigger updated_at (reusa la función de inventory_core; guard por si acaso)
CREATE OR REPLACE FUNCTION inv_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_purchase_orders_update ON purchase_orders;
CREATE TRIGGER trigger_purchase_orders_update BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION inv_touch_updated_at();

-- ----------------------------------------------------------------
-- Vista · Proyección de faltantes a 15 días (§2)
--
-- Consumo diario NETO de los últimos 60 días:
--   SALE_OUT − CUSTOMER_RETURN por cancelación (las ventas canceladas no
--   cuentan como consumo real).
-- days_to_minimum: a ritmo actual, en cuántos días la existencia toca el
-- mínimo. reorder_needed cuando ya está en/bajo mínimo o llegará en ≤15 días.
-- suggested_qty: reponer hasta el máximo (si no hay máximo, 2× mínimo).
-- ----------------------------------------------------------------
DROP VIEW IF EXISTS v_projected_stockout_15d;
CREATE VIEW v_projected_stockout_15d AS
  WITH net_consumption AS (
    SELECT m.company_id,
           m.product_id,
           COALESCE(m.warehouse_from_id, m.warehouse_to_id) AS warehouse_id,
           SUM(CASE WHEN m.movement_type = 'SALE_OUT' THEN m.quantity
                    WHEN m.movement_type = 'CUSTOMER_RETURN'
                     AND m.reference_type = 'invoice_cancel' THEN -m.quantity
                    ELSE 0 END) AS net_out_60d
      FROM inventory_movements m
     WHERE m.created_at >= NOW() - INTERVAL '60 days'
       AND (m.movement_type = 'SALE_OUT'
            OR (m.movement_type = 'CUSTOMER_RETURN' AND m.reference_type = 'invoice_cancel'))
     GROUP BY m.company_id, m.product_id, COALESCE(m.warehouse_from_id, m.warehouse_to_id)
  )
  SELECT w.company_id,
         w.id   AS warehouse_id,
         w.code AS warehouse_code,
         w.name AS warehouse_name,
         p.id   AS product_id,
         p.sku,
         p.name AS product_name,
         ws.quantity,
         ws.stock_minimum,
         ws.stock_maximum,
         GREATEST(COALESCE(nc.net_out_60d, 0), 0) / 60.0 AS daily_consumption,
         CASE
           WHEN ws.quantity <= ws.stock_minimum THEN 0
           WHEN COALESCE(nc.net_out_60d, 0) > 0
             THEN ROUND((ws.quantity - ws.stock_minimum) / (nc.net_out_60d / 60.0), 1)
           ELSE NULL                                   -- sin consumo: no proyectable
         END AS days_to_minimum,
         (ws.quantity <= ws.stock_minimum
          OR (COALESCE(nc.net_out_60d, 0) > 0
              AND (ws.quantity - ws.stock_minimum) / (nc.net_out_60d / 60.0) <= 15)
         ) AS reorder_needed,
         GREATEST(
           CASE WHEN ws.stock_maximum > 0 THEN ws.stock_maximum - ws.quantity
                ELSE (ws.stock_minimum * 2) - ws.quantity END,
           0
         ) AS suggested_qty
    FROM warehouse_stock ws
    JOIN warehouses w ON w.id = ws.warehouse_id AND w.deleted_at IS NULL AND w.is_active = true
    JOIN products  p ON p.id = ws.product_id   AND p.deleted_at IS NULL AND p.is_active = true
    LEFT JOIN net_consumption nc
           ON nc.product_id = ws.product_id AND nc.warehouse_id = ws.warehouse_id
   WHERE ws.stock_minimum > 0;

COMMENT ON VIEW v_projected_stockout_15d IS
  'Candidatos a reorden: bajo mínimo HOY o proyectados a tocarlo en ≤15 días (§2 ALMACEN.MD)';
