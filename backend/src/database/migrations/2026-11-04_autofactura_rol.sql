-- Autofacturación (RMF 2.7.3): el «rol de facturación por cuenta del adquirente»
-- que el SAT exige para que una empresa pueda emitir CFDI a nombre de sus
-- enajenantes. Se captura por empresa; SIN él no se timbra (el timbrado valida
-- que exista antes de mandar nada al PAC).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS autofactura_rol_sat TEXT;
COMMENT ON COLUMN companies.autofactura_rol_sat IS
  'Referencia del rol/permiso de facturación por cuenta del adquirente ante el SAT (RMF 2.7.3). NULL = no autorizado → no se timbra autofactura.';

-- Resultado del timbrado del comprobante de autofacturación.
ALTER TABLE autofactura_comprobantes
  ADD COLUMN IF NOT EXISTS xml            TEXT,
  ADD COLUMN IF NOT EXISTS fecha_timbrado TIMESTAMPTZ;
