-- ============================================================================
-- PUNTO DE VENTA: CLIENTE IDENTIFICADO
--
-- Hasta hoy toda venta de mostrador iba al público general y terminaba en la
-- factura global del día. Pero pasa a diario que alguien compra poco y SÍ
-- quiere factura con su RFC. Sin esta columna, la única salida era capturarle
-- una factura aparte a mano y descuadrar el inventario, porque el POS ya había
-- descontado la mercancía.
--
-- `customer_name` ya existía como texto libre —para escribir "Juan" en el
-- ticket—. No sirve para facturar: una factura necesita el CLIENTE del
-- catálogo, con su RFC, régimen y uso de CFDI validados.
--
-- Los estados `INVOICED_INDIVIDUAL` e `invoice_id` YA estaban previstos en el
-- diseño original de pos_sales; sólo faltaba a quién se le factura.
-- ============================================================================

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

/* Las ventas con cliente son las que se facturan al momento; buscarlas por
 * cliente es la consulta natural cuando alguien pregunta "¿qué le vendimos?". */
CREATE INDEX IF NOT EXISTS idx_pos_sales_customer
  ON pos_sales(customer_id) WHERE customer_id IS NOT NULL;

COMMENT ON COLUMN pos_sales.customer_id IS
  'Cliente del catálogo cuando pidió factura. NULL = venta a público general, '
  'que se incluye en la factura global del día.';
