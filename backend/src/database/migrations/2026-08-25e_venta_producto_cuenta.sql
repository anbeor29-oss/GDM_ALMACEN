-- ============================================================================
-- MAPEO CLAVE PRODUCTO/SERVICIO (SAT) → CUENTA DE INGRESO (401-xx)
--
-- La cuenta de venta depende del PRODUCTO. Cada ClaveProdServ del Anexo 20 que
-- aparece en las facturas emitidas se mapea a un 401 del catálogo. Con eso la
-- póliza de venta parte cada factura por producto: una línea de abono por cada
-- 401 distinto que tenga la factura.
-- ============================================================================

CREATE TABLE IF NOT EXISTS venta_producto_cuenta (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  clave_prod_serv VARCHAR(12) NOT NULL,     -- c_ClaveProdServ del SAT
  descripcion     VARCHAR(300),             -- la del último concepto visto (referencia)
  cuenta_codigo   VARCHAR(40),              -- la cuenta 401 asignada

  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE (company_id, clave_prod_serv)
);

COMMENT ON TABLE venta_producto_cuenta IS
  'Cuenta de ingreso (401-xx) por ClaveProdServ. De aquí la póliza de venta parte '
  'cada factura por producto.';
