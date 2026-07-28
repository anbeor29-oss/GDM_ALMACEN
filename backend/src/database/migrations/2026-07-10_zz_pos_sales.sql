-- ================================================================
-- INVENTARIO — Fase 5 (M7): Punto de Venta + factura global diaria
-- Conclusión de ALMACEN.MD: "ventas tipo punto de venta, y al final de
-- cada día lo que no se facturó individualmente se genera una factura
-- al público en general".
-- ================================================================
-- Idempotente y autosuficiente en BD virgen (regla 26).
-- Prefijo zz_ para ordenar al final (después de zz_inventory_costing).

CREATE TABLE IF NOT EXISTS pos_sales (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id)  ON DELETE CASCADE,
  warehouse_id      UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  folio             INT  NOT NULL,
  status            VARCHAR(24) NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN',                 -- vendida, sin facturar
                                      'INVOICED_INDIVIDUAL',  -- el cliente pidió su factura
                                      'IN_GLOBAL',            -- incluida en la global del día
                                      'CANCELLED')),
  payment_form      VARCHAR(2) NOT NULL DEFAULT '01',        -- c_FormaPago (01 efectivo…)
  subtotal          NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax               NUMERIC(15,2) NOT NULL DEFAULT 0,
  total             NUMERIC(15,2) NOT NULL DEFAULT 0,
  invoice_id        UUID REFERENCES invoices(id) ON DELETE SET NULL, -- factura individual
  global_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL, -- factura global del día
  sold_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  cancelled_at      TIMESTAMP,
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email        VARCHAR(255),
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE(company_id, folio)
);

-- Los índices se crean solo si la tabla trae la forma de Almacén.
--
-- En la fusión con GDM_FAC esta tabla puede existir ya con el esquema del POS
-- de facturación, que no tiene sold_at: el CREATE TABLE IF NOT EXISTS de
-- arriba no hace nada y el índice reventaba el arranque completo. La
-- reconciliación real vive en 2026-07-28_fusion_pos_unificado.sql, que corre
-- después; aquí solo se evita tumbar el deploy.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='pos_sales' AND column_name='sold_at') THEN
    CREATE INDEX IF NOT EXISTS idx_pos_sales_company_day
      ON pos_sales(company_id, sold_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pos_sales_status
      ON pos_sales(company_id, status);
  ELSE
    RAISE NOTICE '[pos] tabla con esquema previo — los índices los pone la migración de fusión';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pos_sale_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pos_sale_id  UUID NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id)  ON DELETE RESTRICT,
  quantity     NUMERIC(15,6) NOT NULL CHECK (quantity > 0),
  unit_price   NUMERIC(15,2) NOT NULL,                       -- precio FINAL (IVA incluido)
  line_total   NUMERIC(15,2) NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Mismo caso que arriba: el POS de facturación nombra la llave `sale_id` y
-- éste `pos_sale_id`. Si la tabla ya venía de allá, el índice no existe y la
-- reconciliación la hace la migración de fusión.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='pos_sale_items' AND column_name='pos_sale_id') THEN
    CREATE INDEX IF NOT EXISTS idx_pos_items_sale    ON pos_sale_items(pos_sale_id);
    CREATE INDEX IF NOT EXISTS idx_pos_items_product ON pos_sale_items(product_id);
  ELSE
    RAISE NOTICE '[pos] pos_sale_items con esquema previo — la fusión lo normaliza';
  END IF;
END $$;

COMMENT ON TABLE pos_sales IS
  'Ventas de mostrador — descuentan inventario al momento; las OPEN se facturan en la global diaria (RFC XAXX010101000)';
