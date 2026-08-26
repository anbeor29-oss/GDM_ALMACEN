-- ============================================================================
-- MAPEO CLAVE PRODUCTO/SERVICIO (SAT) → CUENTA DE COMPRA (115 inventario / 601 gasto)
--
-- Espejo de venta_producto_cuenta, pero del lado de las compras: cada
-- ClaveProdServ que aparece en las facturas RECIBIDAS se manda a una cuenta de
-- inventario (115.xx) o de gasto (601.xx), según qué sea. La póliza de compra
-- carga a esas cuentas partiendo la factura por producto, más el IVA acreditable
-- (119.01) al cargo, contra el proveedor (201) al abono.
-- ============================================================================

CREATE TABLE IF NOT EXISTS compra_producto_cuenta (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  clave_prod_serv VARCHAR(12) NOT NULL,
  descripcion     VARCHAR(300),
  cuenta_codigo   VARCHAR(40),              -- 115.xx inventario o 601.xx gasto

  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE (company_id, clave_prod_serv)
);

COMMENT ON TABLE compra_producto_cuenta IS
  'Cuenta de compra (115 inventario / 601 gasto) por ClaveProdServ de recibidos.';
