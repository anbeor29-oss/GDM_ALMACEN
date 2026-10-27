-- Comercio Electrónico — rebanada 9: CUPONES / PROMOCIONES.
-- Códigos de descuento por empresa (aplican a cualquier tienda de la empresa). El
-- comprador captura el código en el checkout; el descuento se aplica a los PRODUCTOS
-- bajando su precio neto (así el CFDI sale correcto: IVA sobre el neto, sin campo
-- Descuento global). El envío no se descuenta.

CREATE TABLE IF NOT EXISTS ec_coupon (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  codigo      TEXT NOT NULL,                       -- se compara en MAYÚSCULAS
  tipo        TEXT NOT NULL DEFAULT 'PORCENTAJE',  -- PORCENTAJE | MONTO
  valor       NUMERIC(12,2) NOT NULL DEFAULT 0,    -- % (0..100) o monto fijo (con IVA)
  min_compra  NUMERIC(12,2),                       -- total de productos (con IVA) mínimo; NULL = sin mínimo
  vence       DATE,                                -- último día válido; NULL = sin vencimiento
  usos_max    INTEGER,                             -- usos totales permitidos; NULL = ilimitado
  usos        INTEGER NOT NULL DEFAULT 0,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Un código único por empresa (sin importar mayúsculas/minúsculas).
CREATE UNIQUE INDEX IF NOT EXISTS ux_ec_coupon_codigo ON ec_coupon (company_id, upper(codigo));

-- El cupón usado se congela en el pedido (código + descuento CON IVA aplicado a productos).
ALTER TABLE ec_order
  ADD COLUMN IF NOT EXISTS cupon_codigo TEXT,
  ADD COLUMN IF NOT EXISTS descuento    NUMERIC(14,2) NOT NULL DEFAULT 0;
