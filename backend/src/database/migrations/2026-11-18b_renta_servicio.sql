-- Renta de software EDITABLE por empresa, para la factura de servicios del Súper Admin.
-- Para clientes que NO cobran por usuario (0 usuarios NEXO) pero sí pagan una renta de
-- software y/o servicios contables, aquí se captura a mano la renta (ClaveProdServ
-- 81112218). Es un OVERRIDE: cuando es > 0 manda sobre el cálculo por usuario para la
-- precarga del concepto; NO cambia el total del cobro por usuario (ese sigue su cálculo).
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS renta_servicio_mxn NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN companies.renta_servicio_mxn IS
  'Renta de software editable (CFDI ClaveProdServ 81112218) para la factura de servicios del Súper Admin. 0 = usar el cálculo por usuario. No altera el cobro por usuario.';
