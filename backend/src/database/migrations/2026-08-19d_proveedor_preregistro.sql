-- ═══════════════════════════════════════════════════════════════════════════
-- Proveedores a medio registrar
--
-- EL PROBLEMA
-- La mercancía llega con su factura y quien recibe tiene el papel en la mano.
-- Si ese proveedor no está dado de alta, hoy no hay dónde poner la deuda: dar
-- de alta un proveedor completo pide RFC, régimen fiscal, domicilio… datos que
-- quien está en el andén no tiene y no debería ir a buscar.
--
-- El resultado era que la mercancía entraba y la deuda no. Nadie la reclama
-- hasta que el proveedor llama, y para entonces ya venció.
--
-- LA SOLUCIÓN, Y SU PRECIO
-- Un proveedor de PREREGISTRO: nombre y días de crédito, nada más. Alcanza
-- para que la cuenta por pagar exista, tenga acreedor y tenga vencimiento.
--
-- El precio es que NO sirve para nada fiscal hasta completarlo, y por eso se
-- marca. Un preregistro no puede recibir un complemento de pago ni entrar a
-- una declaración: le falta el RFC.
--
-- POR QUÉ UN RFC INVENTADO Y NO UNO NULO
-- Porque `customers.rfc` es NOT NULL y tiene UNIQUE (company_id, rfc), y ese
-- índice lo usa el `ON CONFLICT` de la descarga masiva del SAT. Aflojarlo para
-- este caso rompería aquello.
--
-- Así que el preregistro lleva un marcador que NO puede confundirse con un RFC
-- —empieza con "SINRFC-"—, es único, y cualquier validación de RFC lo rechaza,
-- que es exactamente lo que debe pasar si alguien intenta usarlo para timbrar.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS es_preregistro BOOLEAN NOT NULL DEFAULT false;

/* Para poder listarlos y perseguirlos: "qué proveedores están a medias" es la
 * pregunta que evita que un preregistro se quede así un año. */
CREATE INDEX IF NOT EXISTS customers_preregistro_ix
  ON customers (company_id)
  WHERE es_preregistro AND deleted_at IS NULL;

COMMENT ON COLUMN customers.es_preregistro IS
  'Proveedor capturado al vuelo con nombre y días de crédito. Sin RFC real: '
  'sirve para la cuenta por pagar, no para nada fiscal.';
