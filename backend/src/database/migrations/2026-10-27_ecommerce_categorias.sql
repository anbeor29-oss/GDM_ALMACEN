-- Comercio Electrónico — rebanada 7: CATEGORÍAS del catálogo web.
-- Agrupan los productos publicados para que el comprador navegue por secciones.
-- Por empresa (no copian el producto): el producto se liga a su categoría en
-- ec_product_channel.category_id (NULL = sin categoría). Al borrar una categoría
-- los productos quedan sin categoría (ON DELETE SET NULL), no se pierden.

CREATE TABLE IF NOT EXISTS ec_category (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  slug        TEXT NOT NULL,              -- identifica la categoría en la URL de la tienda
  orden       INTEGER NOT NULL DEFAULT 0, -- orden de aparición en la tienda
  activa      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Slug único por empresa.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ec_category_slug ON ec_category (company_id, lower(slug));
CREATE INDEX IF NOT EXISTS idx_ec_category_company ON ec_category (company_id);

-- Liga del producto (overlay web) a su categoría.
ALTER TABLE ec_product_channel
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES ec_category(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ec_product_channel_cat ON ec_product_channel (category_id);
