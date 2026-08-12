-- ============================================================================
-- CONTROL DE EDICIÓN — que el segundo en guardar no borre al primero
--
-- LO QUE YA HABÍA, Y POR QUÉ NO BASTABA
-- La presencia (2026-08-11e) avisa que alguien más tiene el documento abierto.
-- Sirve para que se pongan de acuerdo, pero es un letrero: si los dos guardan,
-- el segundo sigue pisando al primero y nadie se entera. Avisar del riesgo no
-- es lo mismo que impedir el daño.
--
-- CÓMO FUNCIONA
-- Cada documento lleva un contador. El formulario recibe el número al abrirlo y
-- lo devuelve al guardar; si el número que trae ya no coincide con el de la
-- base, significa que alguien guardó en medio y el guardado se rechaza en vez
-- de sobrescribir. El contador sube en cada cambio.
--
-- POR QUÉ `edicion` Y NO `version`
-- `carta_porte.version` ya existe y guarda "3.1", la versión del complemento
-- del SAT. Reusar ese nombre habría mezclado dos cosas sin relación, y un día
-- alguien habría incrementado la versión del complemento creyendo que llevaba
-- la cuenta de las ediciones.
--
-- POR QUÉ ARRANCA EN 1 Y NO EN 0
-- Un contador que empieza en cero se confunde con "no tiene contador" en cuanto
-- pasa por un JSON, un formulario vacío o un COALESCE. Empezar en 1 hace que
-- cualquier valor falsy sea inequívocamente "no me lo mandaron".
-- ============================================================================

ALTER TABLE invoices        ADD COLUMN IF NOT EXISTS edicion INT NOT NULL DEFAULT 1;
ALTER TABLE customers       ADD COLUMN IF NOT EXISTS edicion INT NOT NULL DEFAULT 1;
ALTER TABLE products        ADD COLUMN IF NOT EXISTS edicion INT NOT NULL DEFAULT 1;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS edicion INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN invoices.edicion IS
  'Contador de ediciones. El formulario lo recibe al abrir y lo devuelve al '
  'guardar; si no coincide, alguien guardó en medio y se rechaza el guardado. '
  'La Carta Porte de la factura también lo incrementa: es parte del mismo '
  'documento aunque viva en otra tabla.';

COMMENT ON COLUMN customers.edicion  IS 'Contador de ediciones — ver invoices.edicion.';
COMMENT ON COLUMN products.edicion   IS 'Contador de ediciones — ver invoices.edicion.';
COMMENT ON COLUMN purchase_orders.edicion IS 'Contador de ediciones — ver invoices.edicion.';
