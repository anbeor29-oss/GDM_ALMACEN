-- ============================================================================
-- PRECIOS VIGENTES — la base cobraba distinto de lo que anuncia la página
--
-- QUÉ ESTABA MAL
-- La landing y el contrato dicen Empresarial a $1,800 y timbre suelto a $4.99.
-- `stamp_packages` seguía con los precios de julio: $1,399 y $2.00.
--
-- No es un detalle de presentación: `stamp_packages` es lo que LEE EL CIERRE
-- MENSUAL. Un cliente en Empresarial se estaba facturando a $1,399 —$401
-- menos cada mes— y los timbres extra de Uso libre a menos de la mitad. La
-- página vendía una cosa y el sistema cobraba otra, y quien lo hubiera notado
-- primero sería el cliente, no nosotros.
--
-- POR QUÉ NO SE EDITA LA SEMILLA DE JULIO
-- Aquella migración ya corrió en producción y su registro es histórico: dice
-- qué precios estuvieron vigentes y desde cuándo. En una base nueva las dos
-- corren en orden —julio pone $1,399, ésta lo sube a $1,800— y el resultado es
-- el mismo. Reescribir el pasado para que cuadre con el presente borra la única
-- pista de cuándo cambió el precio.
--
-- LO QUE NO TOCA
-- `monthly_invoicing` ya emitido se queda como está. Cada fila registra lo que
-- se cobró CUANDO se cobró; recalcularla con el precio de hoy alteraría cierres
-- que el cliente ya pagó.
-- ============================================================================

BEGIN;

UPDATE stamp_packages
   SET monthly_fee_mxn = 1800.00
 WHERE code = 'PKG_500' AND monthly_fee_mxn <> 1800.00;

/* Uso libre: el timbre a $4.99, igual que `PREPAID_UNIT_PRICE_MXN` en
 * billing.service. Ese valor ya estaba bien en el código y mal en la tabla —
 * dos números para el mismo precio, que es exactamente como se separan. */
UPDATE stamp_packages
   SET extra_stamp_mxn = 4.99
 WHERE code = 'PKG_FLEX' AND extra_stamp_mxn <> 4.99;

/* `companies.monthly_fee` es de la época anterior a los paquetes (plan
 * "iguala"). El cierre mensual NO la usa —lee `stamp_packages` por el JOIN—
 * pero si quedara con el valor viejo, cualquier reporte que la consulte daría
 * una cifra distinta a la facturada. Se alinea para que no haya dos verdades. */
UPDATE companies c
   SET monthly_fee = sp.monthly_fee_mxn,
       extra_stamp_fee = sp.extra_stamp_mxn
  FROM stamp_packages sp
 WHERE sp.code = c.stamp_package_code
   AND c.deleted_at IS NULL
   AND (c.monthly_fee IS DISTINCT FROM sp.monthly_fee_mxn
        OR c.extra_stamp_fee IS DISTINCT FROM sp.extra_stamp_mxn);

COMMIT;
