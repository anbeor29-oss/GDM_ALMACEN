-- Comercio Electrónico — rebanada 2: la TIENDA (alta de tienda + branding + políticas).
-- Plan en docs/ECOMMERCE_PLAN.md. Las demás tablas ec_* (cart, pedido, pasarela, envío…)
-- llegan en sus propias rebanadas. Todo multi-empresa por company_id.

CREATE TABLE IF NOT EXISTS ec_store (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  nombre              TEXT NOT NULL,
  -- slug = subdominio/segmento de la tienda: tienda.hcgm.com.mx/<slug>. Único GLOBAL.
  slug                TEXT NOT NULL,
  moneda              TEXT NOT NULL DEFAULT 'MXN',
  zona_horaria        TEXT NOT NULL DEFAULT 'America/Mexico_City',
  -- Branding (del merchant)
  logo_url            TEXT,
  color_primario      TEXT NOT NULL DEFAULT '#059669',   -- emerald-600
  color_secundario    TEXT NOT NULL DEFAULT '#0d9488',   -- teal-600
  -- Políticas (texto por ahora; el storefront las muestra)
  politica_envio      TEXT,
  politica_devolucion TEXT,
  politica_privacidad TEXT,
  terminos            TEXT,
  activa              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

-- El slug es el subdominio: debe ser único entre tiendas vivas (de cualquier empresa).
CREATE UNIQUE INDEX IF NOT EXISTS ux_ec_store_slug ON ec_store (lower(slug)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ec_store_company ON ec_store (company_id) WHERE deleted_at IS NULL;
