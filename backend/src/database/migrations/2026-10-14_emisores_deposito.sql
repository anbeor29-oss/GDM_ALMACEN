-- ============================================================================
-- Emisora PREDETERMINADA + datos de depósito (cobro a usuarios NEXO/IVA)
--
-- La marca de emisora ya existe (`es_emisor_cobro`, migración 2026-10-13d, con
-- routing por cliente en `empresa_cobro_id`). Aquí se agrega SOLO:
--   · emisor_predeterminado → cuál emisora cobra por defecto cuando el cliente no
--     tiene `empresa_cobro_id`; reemplaza al candado por env PLATFORM_COMPANY_RFC
--     (que queda como respaldo). Antes NO existía una predeterminada configurable.
--   · deposito_* → datos bancarios de la emisora que se le muestran al cliente
--     (y pueden ir en el correo/PDF de la factura del servicio).
-- El SMTP por emisora ya existe (migración 2026-07-22).
-- ============================================================================
ALTER TABLE companies ADD COLUMN IF NOT EXISTS emisor_predeterminado BOOLEAN DEFAULT FALSE;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS deposito_banco      VARCHAR(80);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS deposito_titular    VARCHAR(160);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS deposito_clabe      VARCHAR(18);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS deposito_cuenta     VARCHAR(30);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS deposito_referencia VARCHAR(120);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS deposito_notas      TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS deposito_updated_at TIMESTAMPTZ;

-- Sólo una emisora predeterminada a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS ux_companies_emisor_predet
  ON companies (emisor_predeterminado) WHERE emisor_predeterminado = TRUE;

-- Arranque: si no hay ninguna predeterminada, deja a GRUPO HCGM (ya emisora) como
-- la predeterminada. Idempotente: no pisa una elección posterior del super admin.
UPDATE companies SET emisor_predeterminado = TRUE
 WHERE UPPER(rfc) = 'GHC1707275Y0' AND es_emisor_cobro = TRUE
   AND NOT EXISTS (SELECT 1 FROM companies WHERE emisor_predeterminado = TRUE);
