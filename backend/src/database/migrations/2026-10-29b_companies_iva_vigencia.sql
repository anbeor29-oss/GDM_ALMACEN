-- Servicio IVA (IVA.HTML): fecha de alta como cliente de pago y próxima fecha de
-- cobro (anualidad). Con iva_vigencia_fin capturada la empresa deja de ser
-- «Solicitud en prueba» y pasa a «Usuarios reales» del panel IVA.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS iva_pagado_desde DATE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS iva_vigencia_fin DATE;
