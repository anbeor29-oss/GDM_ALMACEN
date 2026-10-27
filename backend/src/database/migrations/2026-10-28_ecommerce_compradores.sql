-- Comercio Electrónico — rebanada 10: CUENTAS DE COMPRADOR.
-- Los compradores de una tienda pueden registrarse (email + contraseña) para ver su
-- historial y no recapturar sus datos. Son cuentas SEPARADAS de los usuarios de NEXO
-- (no dan acceso al ERP): su token se firma con un secreto derivado distinto. Email
-- único por tienda. El pedido se liga al comprador cuando compra con sesión iniciada.

CREATE TABLE IF NOT EXISTS ec_buyer (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id       UUID NOT NULL REFERENCES ec_store(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  nombre         TEXT NOT NULL,
  telefono       TEXT,
  direccion      TEXT,
  cp             TEXT,
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Email único por tienda (sin importar mayúsculas).
CREATE UNIQUE INDEX IF NOT EXISTS ux_ec_buyer_email ON ec_buyer (store_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_ec_buyer_company ON ec_buyer (company_id);

-- Liga del pedido a la cuenta del comprador (NULL = compra como invitado).
ALTER TABLE ec_order ADD COLUMN IF NOT EXISTS buyer_id UUID REFERENCES ec_buyer(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ec_order_buyer ON ec_order (buyer_id);
