-- Factura global al público en general (RFC genérico XAXX010101000).
--
-- El CFDI 4.0 obliga el nodo cfdi:InformacionGlobal en toda factura de ingreso
-- (tipo I) emitida al receptor genérico nacional. Guarda el PERIODO que ampara
-- el comprobante para poder reconstruir/retimbrar sin volver a capturarlo.
--
--   · global_periodicidad  c_Periodicidad: 01 Diario, 02 Semanal, 03 Quincenal,
--                          04 Mensual, 05 Bimestral.
--   · global_meses         c_Meses: 01-12 por mes; 13-18 por bimestre.
--   · global_anio          año de 4 dígitos (no mayor al año en curso).
--
-- Nullable: sólo aplica a las facturas al genérico. Cuando están en NULL, el
-- serializador deriva un valor MENSUAL a partir de la fecha de emisión.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS global_periodicidad VARCHAR(2),
  ADD COLUMN IF NOT EXISTS global_meses        VARCHAR(2),
  ADD COLUMN IF NOT EXISTS global_anio         INT;
