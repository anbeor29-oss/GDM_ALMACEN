-- ============================================================================
-- UNA SOLA CUENTA POR PAGAR POR CADA XML DE COMPRA
--
-- xml_imports tiene ON CONFLICT (company_id, sha256) DO UPDATE: volver a
-- subir la misma factura del proveedor re-commitea el mismo import. El
-- inventario ya estaba protegido contra la doble entrada; la cuenta por pagar
-- no. Un XML subido dos veces generaba DOS deudas por el mismo importe, y esa
-- es la clase de error que se descubre pagando de más.
--
-- El código ya verifica antes de insertar; este índice es el cinturón: si dos
-- peticiones entran a la vez, la segunda falla en la base en lugar de duplicar.
--
-- Parcial sobre status <> 'CANCELLED' a propósito: si un pago se cancela por
-- error de captura, la misma factura debe poder volver a programarse.
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- Limpieza previa: si alguna BD ya arrastra duplicados, el CREATE UNIQUE
-- fallaría. Se conserva el más antiguo (el que ya pudo haberse pagado) y se
-- cancelan los demás dejando constancia de por qué.
UPDATE supplier_payments_schedule s
   SET status = 'CANCELLED',
       notes  = COALESCE(notes, '') || ' · cancelado por duplicado del mismo XML (migración 2026-07-28d)'
 WHERE s.status <> 'CANCELLED'
   AND s.xml_import_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM supplier_payments_schedule p
      WHERE p.xml_import_id = s.xml_import_id
        AND p.status <> 'CANCELLED'
        AND (p.created_at, p.id) < (s.created_at, s.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_payment_por_xml
  ON supplier_payments_schedule (xml_import_id)
  WHERE xml_import_id IS NOT NULL AND status <> 'CANCELLED';

COMMENT ON INDEX uq_supplier_payment_por_xml IS
  'Un XML de compra genera una sola cuenta por pagar viva; si se cancela, puede volver a programarse';

COMMIT;
