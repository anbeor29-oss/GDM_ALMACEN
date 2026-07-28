-- ================================================================
-- INVENTARIO — Núcleo multialmacén (Fase 1 de ALMACEN)
-- M1: warehouses + warehouse_stock · M2: inventory_movements (kardex)
-- M4: extensiones de products
-- ================================================================
-- Idempotente (IF NOT EXISTS / ON CONFLICT). Probada contra BD virgen
-- (regla 26): no depende de tablas creadas en migraciones posteriores.
--
-- Regla de oro #4: NADIE escribe warehouse_stock salvo el servicio
-- inventory.applyMovement() — kardex inmutable, correcciones = mov. inverso.

-- ----------------------------------------------------------------
-- M1a · Almacenes
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouses (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code        VARCHAR(20)  NOT NULL,
  name        VARCHAR(150) NOT NULL,
  address     VARCHAR(500),
  is_default  BOOLEAN NOT NULL DEFAULT false,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMP,

  UNIQUE(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_warehouses_company
  ON warehouses(company_id) WHERE deleted_at IS NULL;

-- Un solo almacén default por empresa (índice parcial único)
CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouses_default_per_company
  ON warehouses(company_id) WHERE is_default = true AND deleted_at IS NULL;

-- ----------------------------------------------------------------
-- M1b · Existencias por almacén
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouse_stock (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  warehouse_id  UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  quantity      NUMERIC(15,6) NOT NULL DEFAULT 0,
  stock_minimum NUMERIC(15,6) NOT NULL DEFAULT 0,   -- mín/máx POR almacén (§2 ALMACEN.MD)
  stock_maximum NUMERIC(15,6) NOT NULL DEFAULT 0,
  avg_cost      NUMERIC(15,6) NOT NULL DEFAULT 0,   -- costo promedio ponderado
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE(warehouse_id, product_id),
  CONSTRAINT chk_stock_non_negative CHECK (quantity >= 0)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_stock_product ON warehouse_stock(product_id);

-- ----------------------------------------------------------------
-- M2 · Kardex — bitácora inmutable de movimientos (§10 ALMACEN.MD)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_movements (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id        UUID NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  movement_type     VARCHAR(20) NOT NULL CHECK (movement_type IN (
                      'PURCHASE_IN',      -- entrada por compra (XML)
                      'SALE_OUT',         -- salida por venta/factura
                      'CUSTOMER_RETURN',  -- devolución de cliente (NC)
                      'SUPPLIER_RETURN',  -- devolución a proveedor
                      'TRANSFER_OUT',     -- traspaso: salida del origen
                      'TRANSFER_IN',      -- traspaso: entrada al destino
                      'ADJUSTMENT_IN',    -- ajuste manual positivo
                      'ADJUSTMENT_OUT',   -- ajuste manual negativo
                      'SHRINKAGE',        -- merma
                      'THEFT',            -- robo o pérdida
                      'DAMAGED',          -- producto dañado
                      'INITIAL'           -- carga inicial / inventario físico inicial
                    )),
  quantity          NUMERIC(15,6) NOT NULL CHECK (quantity > 0),
  unit_cost         NUMERIC(15,6),
  -- CASCADE coherente con el borrado total de empresa (los almacenes/productos
  -- vivos nunca se borran duro: se desactivan con deleted_at)
  warehouse_from_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
  warehouse_to_id   UUID REFERENCES warehouses(id) ON DELETE CASCADE,
  -- Documento relacionado (invoice / xml_import / purchase_order / physical_count / transfer)
  reference_type    VARCHAR(30),
  reference_id      UUID,
  -- Traspaso: mismo transfer_group en el OUT y el IN para trazabilidad
  transfer_group    UUID,
  reason            TEXT,
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email        VARCHAR(255),
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Todo movimiento afecta al menos un almacén
  CONSTRAINT chk_movement_has_warehouse
    CHECK (warehouse_from_id IS NOT NULL OR warehouse_to_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_inv_mov_company_ts ON inventory_movements(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_product    ON inventory_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_reference  ON inventory_movements(reference_type, reference_id);

COMMENT ON TABLE inventory_movements IS
  'Kardex inmutable — sin UPDATE/DELETE; correcciones = movimiento inverso. Único escritor: inventory.applyMovement()';

-- Blindaje a nivel BD de la inmutabilidad del kardex.
-- Solo UPDATE: el DELETE directo no se expone en ningún endpoint, y bloquearlo
-- con trigger rompería el borrado total de empresa (FK ON DELETE CASCADE).
CREATE OR REPLACE FUNCTION forbid_kardex_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'inventory_movements es inmutable — registra un movimiento inverso';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_movements_immutable ON inventory_movements;
CREATE TRIGGER trg_inventory_movements_immutable
  BEFORE UPDATE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_kardex_mutation();

-- ----------------------------------------------------------------
-- M4 · Extensiones del catálogo de productos (§6 ALMACEN.MD)
-- ----------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode             VARCHAR(64);
ALTER TABLE products ADD COLUMN IF NOT EXISTS category            VARCHAR(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS internal_unit       VARCHAR(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS primary_supplier_id UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS avg_cost            NUMERIC(15,6) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_products_barcode  ON products(company_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_category ON products(company_id, category);

-- ----------------------------------------------------------------
-- Bootstrap de datos: almacén default + migración del stock global
-- ----------------------------------------------------------------
-- 1) Cada empresa activa recibe un almacén GENERAL default si no tiene ninguno.
INSERT INTO warehouses (company_id, code, name, is_default)
SELECT c.id, 'GEN', 'Almacén General', true
  FROM companies c
 WHERE c.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.company_id = c.id AND w.deleted_at IS NULL)
ON CONFLICT (company_id, code) DO NOTHING;

-- 2) El stock global previo (products.stock_quantity) se traslada al almacén
--    default como existencia inicial, solo si el producto aún no tiene renglón.
INSERT INTO warehouse_stock (warehouse_id, product_id, quantity, stock_minimum, stock_maximum, avg_cost)
SELECT w.id, p.id,
       GREATEST(COALESCE(p.stock_quantity, 0), 0),
       COALESCE(p.stock_minimum, 0),
       COALESCE(p.stock_maximum, 0),
       COALESCE(p.last_cost, 0)
  FROM products p
  JOIN warehouses w ON w.company_id = p.company_id
                   AND w.is_default = true AND w.deleted_at IS NULL
 WHERE p.deleted_at IS NULL
ON CONFLICT (warehouse_id, product_id) DO NOTHING;

-- 3) Kardex de la carga inicial (solo cantidades > 0 y solo una vez)
INSERT INTO inventory_movements
       (company_id, product_id, movement_type, quantity, unit_cost,
        warehouse_to_id, reference_type, reason, user_email)
SELECT p.company_id, p.id, 'INITIAL', p.stock_quantity, COALESCE(p.last_cost, 0),
       w.id, 'migration', 'Carga inicial: migración de products.stock_quantity a multialmacén',
       'system@migration'
  FROM products p
  JOIN warehouses w ON w.company_id = p.company_id
                   AND w.is_default = true AND w.deleted_at IS NULL
 WHERE p.deleted_at IS NULL
   AND COALESCE(p.stock_quantity, 0) > 0
   AND NOT EXISTS (SELECT 1 FROM inventory_movements m
                    WHERE m.product_id = p.id AND m.movement_type = 'INITIAL');

-- ----------------------------------------------------------------
-- Vistas de consulta (§12 parcial — el resto llega en Fase 7)
-- ----------------------------------------------------------------
DROP VIEW IF EXISTS v_stock_consolidated;
CREATE VIEW v_stock_consolidated AS
  SELECT p.company_id,
         p.id            AS product_id,
         p.sku,
         p.name,
         p.category,
         COALESCE(SUM(ws.quantity), 0)                 AS total_quantity,
         COALESCE(SUM(ws.quantity * ws.avg_cost), 0)   AS total_value,
         COUNT(ws.id) FILTER (WHERE ws.quantity > 0)   AS warehouses_with_stock
    FROM products p
    LEFT JOIN warehouse_stock ws ON ws.product_id = p.id
    LEFT JOIN warehouses w ON w.id = ws.warehouse_id AND w.deleted_at IS NULL
   WHERE p.deleted_at IS NULL
   GROUP BY p.company_id, p.id, p.sku, p.name, p.category;

DROP VIEW IF EXISTS v_products_below_minimum;
CREATE VIEW v_products_below_minimum AS
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
         -- Semáforo (§14): AGOTADO / CRITICO (≤ mín) / PREVENTIVO (≤ mín*1.2) / SUFICIENTE
         CASE
           WHEN ws.quantity <= 0                       THEN 'AGOTADO'
           WHEN ws.quantity <= ws.stock_minimum        THEN 'CRITICO'
           WHEN ws.quantity <= ws.stock_minimum * 1.2  THEN 'PREVENTIVO'
           ELSE 'SUFICIENTE'
         END AS semaforo
    FROM warehouse_stock ws
    JOIN warehouses w ON w.id = ws.warehouse_id AND w.deleted_at IS NULL
    JOIN products  p ON p.id = ws.product_id   AND p.deleted_at IS NULL
   WHERE ws.stock_minimum > 0 OR ws.quantity > 0;

-- Trigger updated_at — la función se define AQUÍ para que la migración sea
-- autosuficiente en BD virgen (regla 26: schema.sql no trae update_timestamp)
CREATE OR REPLACE FUNCTION inv_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_warehouses_update ON warehouses;
CREATE TRIGGER trigger_warehouses_update BEFORE UPDATE ON warehouses
  FOR EACH ROW EXECUTE FUNCTION inv_touch_updated_at();
