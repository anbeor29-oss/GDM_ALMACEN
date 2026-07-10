-- ===================================================================
-- Fecha: 2026-07-07
-- Motivo: la tabla `payments` del schema base quedó incompleta: el
-- servicio de pagos INSERTA folio/serie/payment_method/pac_timestamp/
-- xml_content, y el service de balance las SELECCIONA. Sin estas
-- columnas la query del modal "Saldo" tira 500 y el frontend queda
-- pegado en "Cargando…". Además el descuento de NC no se refleja en
-- el complemento de pago porque la respuesta nunca llega.
--
-- Todas las columnas son opcionales (nullable / default). No hay
-- backfill destructivo — pagos antiguos quedan sin folio/serie hasta
-- que se timbre uno nuevo.
-- ===================================================================

ALTER TABLE payments ADD COLUMN IF NOT EXISTS folio          INT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS serie          VARCHAR(10);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method VARCHAR(3);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS pac_timestamp  TIMESTAMP;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS xml_content    TEXT;
