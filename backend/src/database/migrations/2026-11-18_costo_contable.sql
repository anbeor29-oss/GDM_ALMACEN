-- Igualado mensual de SERVICIOS CONTABLES por empresa (Súper Admin → Facturación).
-- Es un valor FIJO por cliente (el «igualado» del despacho), editable en la lista de
-- facturación. Se factura JUNTO con la renta de software, como 2.º concepto del CFDI
-- (ClaveProdServ 84111500 «Servicios contables»); NO se suma al total por usuario
-- (ese sigue siendo renta + timbres), es un concepto aparte del mismo comprobante.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS costo_contable_mxn NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN companies.costo_contable_mxn IS
  'Igualado mensual de servicios contables (CFDI ClaveProdServ 84111500) facturado junto con la renta de software; editable en Súper Admin → Facturación. 0 = sin servicio contable.';
