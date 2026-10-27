-- Comercio Electrónico — rebanada 8: ENVÍOS (método y costo).
-- Cada tienda define sus métodos de envío (nombre + costo base sin IVA, y opcional
-- «envío gratis desde» cierto total). El comprador elige uno en el checkout; el
-- costo entra al pedido y, al facturar, como RENGLÓN de flete en el CFDI (IVA 16%).

CREATE TABLE IF NOT EXISTS ec_shipping_method (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id     UUID NOT NULL REFERENCES ec_store(id) ON DELETE CASCADE,
  nombre       TEXT NOT NULL,
  costo        NUMERIC(12,2) NOT NULL DEFAULT 0,   -- base, SIN IVA (como products.base_price)
  gratis_desde NUMERIC(12,2),                      -- NULL = sin envío gratis; si el total (con IVA) de productos >= esto → gratis
  activo       BOOLEAN NOT NULL DEFAULT TRUE,
  orden        INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ec_shipping_store ON ec_shipping_method (store_id);

-- El envío elegido se congela en el pedido (método + base + IVA, para el CFDI).
ALTER TABLE ec_order
  ADD COLUMN IF NOT EXISTS envio_metodo_id UUID REFERENCES ec_shipping_method(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS envio_metodo    TEXT,
  ADD COLUMN IF NOT EXISTS envio_base      NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS envio_iva       NUMERIC(14,2) NOT NULL DEFAULT 0;
