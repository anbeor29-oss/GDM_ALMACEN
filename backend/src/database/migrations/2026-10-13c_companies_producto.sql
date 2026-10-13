-- Producto contratado por cada empresa, para separar la Facturación del super admin
-- en dos paneles: NEXO (el ERP) e IVA (cliente del servicio IVA.HTML, cuyo CFDI
-- emite NEXO). 'AMBOS' = contrató los dos y aparece en las dos pestañas.
--
-- Default 'NEXO': todas las empresas actuales son del ERP. El valor se valida en el
-- backend (NEXO / IVA / AMBOS); se deja sin CHECK para que la migración sea simple.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS producto VARCHAR(10) NOT NULL DEFAULT 'NEXO';
