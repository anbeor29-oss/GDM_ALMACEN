-- Comercio Electrónico — rebanada 6: FOTOS de producto.
-- La imagen se guarda OPTIMIZADA (JPEG) como BYTEA en la BD (persistente en
-- Render, como el logo de la empresa). El storefront la sirve por un endpoint
-- público por id (UUID no adivinable). Varias imágenes por producto (orden).
CREATE TABLE IF NOT EXISTS ec_product_media (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  imagen       BYTEA NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  orden        INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ec_media_product ON ec_product_media (product_id, orden);
