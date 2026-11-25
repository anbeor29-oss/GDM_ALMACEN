-- =====================================================================
-- El precio unitario necesita 6 decimales, no 2
-- =====================================================================
-- La pantalla de factura acepta hasta 6 decimales en el precio (es lo que
-- permite el Anexo 20, y es lo que deja cerrar un total "redondo": 400 piezas
-- a 32.219827 dan 12,887.93 + IVA = 14,950.00 exactos).
--
-- Pero la columna era DECIMAL(15,2): Postgres REDONDEABA el precio al guardar,
-- sin avisar. 32.219827 se guardaba como 32.22, y al timbrar el XML declaraba
-- Importe = 12,887.93 mientras que Cantidad x ValorUnitario daba 12,888.00.
-- Siete centavos de diferencia contra una tolerancia de UNO: el PAC rechazaba.
--
-- OJO: esto arregla lo que se capture DE AQUÍ EN ADELANTE. Los decimales que
-- ya se perdieron no se pueden recuperar —no quedó rastro de ellos—, así que
-- una factura capturada antes hay que volver a teclearle el precio. El
-- constructor del CFDI ahora lo detecta y lo dice con todas sus letras en vez
-- de dejar que el PAC conteste con un error que no se entiende.

DO $$
BEGIN
  -- Idempotente por si corre dos veces: sólo amplía si aún está en 2 decimales.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'invoice_items'
       AND column_name = 'unit_price'
       AND numeric_scale < 6
  ) THEN
    ALTER TABLE invoice_items ALTER COLUMN unit_price TYPE NUMERIC(15,6);
    RAISE NOTICE 'invoice_items.unit_price ampliado a NUMERIC(15,6)';
  END IF;
END $$;
