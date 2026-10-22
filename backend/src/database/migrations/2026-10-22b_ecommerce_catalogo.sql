-- Comercio Electrónico — rebanada 3: CATÁLOGO WEB.
-- Contenido web por producto SOBRE la tabla real `products` (no la copia): se liga por
-- product_id. Si un campo web va NULL, el storefront usa el dato del producto maestro
-- (name/base_price). Así el despacho y el merchant trabajan el MISMO producto.

CREATE TABLE IF NOT EXISTS ec_product_channel (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id       UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  publicado        BOOLEAN NOT NULL DEFAULT FALSE,
  destacado        BOOLEAN NOT NULL DEFAULT FALSE,
  precio_web       NUMERIC(12,2),      -- NULL = usa products.base_price
  titulo_web       TEXT,              -- NULL = usa products.name
  descripcion_web  TEXT,
  seo_title        TEXT,
  seo_description  TEXT,
  orden            INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un overlay web por producto.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ec_product_channel_prod ON ec_product_channel (product_id);
CREATE INDEX IF NOT EXISTS idx_ec_product_channel_pub ON ec_product_channel (company_id) WHERE publicado;
