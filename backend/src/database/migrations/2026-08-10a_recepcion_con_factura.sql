-- ============================================================================
-- RECEPCIÓN CON FACTURA — la orden de compra deja de morir en el almacén
--
-- Hasta hoy, recibir mercancía de una orden de compra sólo movía existencias.
-- La deuda con el proveedor no existía en ningún lado: quien pagaba se
-- enteraba cuando llegaba la factura por correo, y tesorería no la veía hasta
-- que alguien la capturaba a mano. Las compras por XML sí generaban su cuenta
-- por pagar desde el día uno; las recepciones manuales no. Era la misma
-- compra tratada de dos maneras distintas según por dónde entró.
--
-- Estas dos columnas cierran el círculo: al recibir se captura el número de
-- factura del proveedor y la cuenta por pagar nace ahí mismo, ligada a la
-- orden que la originó.
--
-- POR QUÉ EN supplier_payments_schedule Y NO EN UNA TABLA NUEVA
-- Es la misma deuda. Tesorería ya la lista, ya la marca pagada y ya libera
-- línea de crédito. Una tabla aparte para "deuda que vino de orden de compra"
-- obligaría a que cada pantalla de pagos consultara dos orígenes y sumara —
-- y tarde o temprano una de las dos se quedaría fuera de un reporte.
-- ============================================================================

ALTER TABLE supplier_payments_schedule
  ADD COLUMN IF NOT EXISTS invoice_number     VARCHAR(60),
  ADD COLUMN IF NOT EXISTS purchase_order_id  UUID REFERENCES purchase_orders(id) ON DELETE SET NULL;

COMMENT ON COLUMN supplier_payments_schedule.invoice_number IS
  'Folio de la factura del proveedor capturado al recibir la mercancía. '
  'Es el dato con el que tesorería concilia el pago contra el estado de cuenta.';

COMMENT ON COLUMN supplier_payments_schedule.purchase_order_id IS
  'Orden de compra que originó la deuda. NULL = alta manual o compra por XML.';

/* La misma factura del mismo proveedor no puede deber dos veces.
 *
 * El caso real no es el fraude sino el dedo: se recibe, la pantalla tarda,
 * alguien vuelve a dar "Confirmar" y la deuda queda duplicada. También cubre
 * la recepción en dos partidas amparadas por una sola factura — la segunda
 * entrega mueve existencias pero no vuelve a deber.
 *
 * UPPER() porque "A-123" y "a-123" son la misma factura para el proveedor.
 * Se excluyen las canceladas: una deuda cancelada por error debe poder
 * recapturarse con el mismo folio. */
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_payment_factura
  ON supplier_payments_schedule (company_id, supplier_id, UPPER(invoice_number))
  WHERE invoice_number IS NOT NULL AND status <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS idx_supplier_payments_orden
  ON supplier_payments_schedule (purchase_order_id)
  WHERE purchase_order_id IS NOT NULL;
