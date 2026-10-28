-- Comercio Electrónico — fase envíos+reportes: SURTIDO/ENVIADO/ENTREGADO + guía + recoger.
-- El pedido avanza su estado de surtido (PENDIENTE_PAGO→PAGADO→SURTIDO→ENVIADO→ENTREGADO)
-- y guarda la paquetería + número de guía al enviarse, con sus fechas. El método de
-- envío puede ser a domicilio (ENVIO) o recoger en tienda (RECOGER, sin dirección).

ALTER TABLE ec_order
  ADD COLUMN IF NOT EXISTS paqueteria   TEXT,
  ADD COLUMN IF NOT EXISTS guia         TEXT,
  ADD COLUMN IF NOT EXISTS surtido_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enviado_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS entregado_at TIMESTAMPTZ;

ALTER TABLE ec_shipping_method
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'ENVIO';   -- ENVIO (a domicilio) | RECOGER (en tienda)
