-- ============================================================================
-- PUNTO DE VENTA (POS) + GRUPOS DE TRABAJO
--
-- 1) Grupos de trabajo por usuario (VENTAS / ALMACEN / COMPRAS / TESORERIA /
--    ADMIN_ALL). Ortogonal al rol (ADMIN/MANAGER/USER): el rol define el nivel
--    de autoridad, el grupo define QUÉ módulos ve. ADMIN_ALL = ve todo (default
--    para no romper usuarios existentes).
-- 2) Precio de mayoreo por producto + umbral de cantidad configurable por
--    empresa (default 4: a partir de 4 piezas se cobra mayoreo).
-- 3) Ventas de mostrador (contado) con cobro efectivo/tarjeta. Los clientes a
--    crédito se manejan en el módulo de Facturas — el POS es solo contado.
--
-- Todo idempotente. Ref: pantalla "Punto de venta".
-- ============================================================================

BEGIN;

-- 1) Grupo de trabajo del usuario
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS work_group VARCHAR(16) NOT NULL DEFAULT 'ADMIN_ALL';

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_work_group;
ALTER TABLE users ADD CONSTRAINT chk_work_group
  CHECK (work_group IN ('ADMIN_ALL', 'VENTAS', 'ALMACEN', 'COMPRAS', 'TESORERIA'));

COMMENT ON COLUMN users.work_group IS
  'Grupo de trabajo: define qué módulos ve el usuario (ADMIN_ALL=todo)';

-- 2) Precio de mayoreo + umbral
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(15,2);
COMMENT ON COLUMN products.wholesale_price IS
  'Precio unitario de mayoreo; se aplica cuando la cantidad vendida >= umbral';

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS pos_mayoreo_min_qty INT NOT NULL DEFAULT 4;
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS next_pos_folio INT NOT NULL DEFAULT 1;
COMMENT ON COLUMN companies.pos_mayoreo_min_qty IS
  'Cantidad a partir de la cual una línea del POS se cobra a precio de mayoreo';

-- 3) Ventas POS
CREATE TABLE IF NOT EXISTS pos_sales (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    folio           INT NOT NULL,
    customer_name   VARCHAR(255) DEFAULT 'Público en general',
    subtotal        NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax             NUMERIC(15,2) NOT NULL DEFAULT 0,
    total           NUMERIC(15,2) NOT NULL DEFAULT 0,
    payment_method  VARCHAR(12) NOT NULL CHECK (payment_method IN ('EFECTIVO', 'TARJETA')),
    amount_tendered NUMERIC(15,2),   -- efectivo recibido
    change_given    NUMERIC(15,2) DEFAULT 0,
    card_ref        VARCHAR(40),     -- últimos 4 / referencia de la terminal
    status          VARCHAR(12) NOT NULL DEFAULT 'COMPLETED'
                      CHECK (status IN ('COMPLETED', 'CANCELLED')),
    sold_by         UUID REFERENCES users(id),
    invoice_id      UUID REFERENCES invoices(id),  -- si luego se factura
    notes           TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, folio)
);
-- El índice solo si la tabla es la de ESTE esquema.
--
-- En la fusión con GDM Almacén, pos_sales puede existir ya con el esquema de
-- allá (sold_at en vez de created_at): el CREATE TABLE IF NOT EXISTS de arriba
-- no hace nada y este índice tumbaba el arranque completo. La reconciliación
-- la hace 2026-07-28_fusion_pos_unificado.sql, que corre después.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='pos_sales' AND column_name='created_at') THEN
    CREATE INDEX IF NOT EXISTS idx_pos_sales_company ON pos_sales (company_id, created_at DESC);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pos_sale_items (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sale_id       UUID NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
    product_id    UUID REFERENCES products(id),
    sku           VARCHAR(50),
    description   VARCHAR(255) NOT NULL,
    quantity      NUMERIC(15,3) NOT NULL,
    unit_price    NUMERIC(15,2) NOT NULL,  -- precio aplicado (menudeo o mayoreo)
    is_wholesale  BOOLEAN NOT NULL DEFAULT FALSE,
    tax_rate      NUMERIC(8,6) NOT NULL DEFAULT 0.16,
    line_subtotal NUMERIC(15,2) NOT NULL,
    line_tax      NUMERIC(15,2) NOT NULL,
    line_total    NUMERIC(15,2) NOT NULL
);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='pos_sale_items' AND column_name='sale_id') THEN
    CREATE INDEX IF NOT EXISTS idx_pos_sale_items_sale ON pos_sale_items (sale_id);
  END IF;
END $$;

COMMENT ON TABLE pos_sales IS 'Ventas de mostrador (contado) — efectivo o tarjeta';

COMMIT;
