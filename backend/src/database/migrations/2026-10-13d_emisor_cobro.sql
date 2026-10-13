-- Emisores de cobro: qué empresa(s) emiten las facturas del SERVICIO (el cobro a los
-- clientes de NEXO) y, por cada cliente, cuál lo factura.
--
--   es_emisor_cobro  → la empresa puede EMITIR las facturas de cobro (con su CSD).
--                      GHC1707275Y0 es el principal; se deja abierto para más de uno.
--   empresa_cobro_id → por cliente, qué emisor lo factura (FK a otra empresa).
--
-- No cambia nada del timbrado de las ventas propias de cada empresa; es solo para el
-- cobro del servicio desde el super admin. La exención (billing_exempt de GHC/SAJ)
-- queda intacta: esas empresas no se cobran, pero sí pueden EMITIR el cobro a otros.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS es_emisor_cobro BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS empresa_cobro_id UUID REFERENCES companies(id) ON DELETE SET NULL;

-- GHC1707275Y0 queda como emisor de cobro por omisión (empresa propia de GRUPO HCGM).
UPDATE companies SET es_emisor_cobro = TRUE WHERE UPPER(rfc) = 'GHC1707275Y0';
