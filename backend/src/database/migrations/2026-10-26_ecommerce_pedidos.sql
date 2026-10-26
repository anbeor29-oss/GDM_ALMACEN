-- Comercio Electrónico — rebanada 4: PEDIDO web + RESERVA de inventario.
-- Plan en docs/ECOMMERCE_PLAN.md §3. El storefront público (catálogo→carrito→
-- checkout) crea un ec_order con fotografía de precios/impuestos y reserva el
-- stock de forma transaccional (evita sobreventa). El cobro (pasarela) y el
-- paso pedido→CFDI→póliza llegan en la rebanada 5. Todo multi-empresa + store.

-- ── Pedido espejo (snapshot de lo que se compró) ──
CREATE TABLE IF NOT EXISTS ec_order (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id         UUID NOT NULL REFERENCES ec_store(id) ON DELETE CASCADE,
  numero           TEXT NOT NULL,                        -- folio legible por tienda (WEB-000001)
  estado           TEXT NOT NULL DEFAULT 'PENDIENTE_PAGO', -- PENDIENTE_PAGO→PAGADO→SURTIDO→ENVIADO→ENTREGADO / CANCELADO
  -- Datos del comprador (invitado por ahora; se liga a customers en rebanadas siguientes).
  cliente_nombre   TEXT NOT NULL,
  cliente_email    TEXT,
  cliente_telefono TEXT,
  envio_direccion  TEXT,
  envio_cp         TEXT,
  notas            TEXT,
  moneda           TEXT NOT NULL DEFAULT 'MXN',
  subtotal         NUMERIC(14,2) NOT NULL DEFAULT 0,     -- sin IVA
  iva              NUMERIC(14,2) NOT NULL DEFAULT 0,
  total            NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ec_order_store   ON ec_order (store_id);
CREATE INDEX IF NOT EXISTS idx_ec_order_company ON ec_order (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ec_order_numero ON ec_order (store_id, numero);

-- ── Renglones del pedido (fotografía de precio/impuesto por si cambian luego) ──
CREATE TABLE IF NOT EXISTS ec_order_item (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID NOT NULL REFERENCES ec_order(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id),
  sku         TEXT,
  nombre      TEXT NOT NULL,
  cantidad    NUMERIC(14,3) NOT NULL,
  precio_unit NUMERIC(14,2) NOT NULL,                    -- sin IVA (para el CFDI)
  tasa_iva    NUMERIC(6,4)  NOT NULL DEFAULT 0,
  importe     NUMERIC(14,2) NOT NULL,                    -- precio_unit * cantidad (sin IVA)
  iva         NUMERIC(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ec_order_item_order ON ec_order_item (order_id);

-- ── Reserva transaccional de stock (evita sobreventa) ──
CREATE TABLE IF NOT EXISTS ec_inventory_reservation (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id    UUID NOT NULL REFERENCES ec_store(id) ON DELETE CASCADE,
  order_id    UUID REFERENCES ec_order(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id),
  cantidad    NUMERIC(14,3) NOT NULL,
  estado      TEXT NOT NULL DEFAULT 'ACTIVA',            -- ACTIVA→CONSUMIDA (al pagar) / LIBERADA (al expirar/cancelar)
  expira_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- El disponible de un producto = stock físico − reservas ACTIVAS. Este índice
-- acelera esa suma (sólo las vivas).
CREATE INDEX IF NOT EXISTS idx_ec_resv_product ON ec_inventory_reservation (product_id) WHERE estado = 'ACTIVA';
CREATE INDEX IF NOT EXISTS idx_ec_resv_order   ON ec_inventory_reservation (order_id);
