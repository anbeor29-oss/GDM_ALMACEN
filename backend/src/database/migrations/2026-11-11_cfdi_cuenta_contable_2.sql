-- ============================================================================
-- SEGUNDA CUENTA CONTABLE POR COMPROBANTE (combos de la pestaña Compras)
--
-- En la pantalla de Pólizas, la pestaña «Compras» captura DOS cuentas por
-- factura: la del PROVEEDOR (cuenta_contable, la de siempre) y la del
-- GASTO/COMPRA/ACTIVO/COSTO (esta columna nueva). Cuando el usuario captura la
-- segunda, el motor manda TODA la factura a esa cuenta de gasto/activo (en vez
-- de partir por producto). Si queda nula, el motor parte por producto como
-- siempre — nada cambia para lo ya capturado.
-- ============================================================================

ALTER TABLE cfdi_recibidos
  ADD COLUMN IF NOT EXISTS cuenta_contable_2 VARCHAR(40);

COMMENT ON COLUMN cfdi_recibidos.cuenta_contable_2 IS
  'Segunda cuenta capturada en la pestaña Compras: la del gasto/compra/activo/'
  'costo. cuenta_contable guarda la del proveedor. NULL = el motor parte por '
  'producto como antes.';
