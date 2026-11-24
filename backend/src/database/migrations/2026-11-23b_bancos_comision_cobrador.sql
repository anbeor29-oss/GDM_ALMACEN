-- ============================================================================
-- ESTADOS DE CUENTA — la COMISIÓN del cobrador de pagos, con su IVA
--
-- POR QUÉ
-- Un cobrador de pagos (Stripe y parecidos) no es un banco: recibe el ingreso
-- del cliente, se queda su comisión —CON IVA INCLUIDO— y lo que resta se manda
-- después a un banco de verdad. Esa comisión es un GASTO con IVA ACREDITABLE, y
-- si se queda metida dentro del neto depositado se pierde: ni el gasto ni el
-- IVA aparecen en ningún lado.
--
-- La base es `comisión / 1.16` y el IVA la diferencia. Se guarda el desglose ya
-- hecho, por mes, para poder CONTROLARLO después y no tener que volver a leer
-- el documento. El desglose es papel de trabajo: el respaldo para acreditar el
-- IVA sigue siendo el CFDI que el cobrador emite por sus comisiones.
--
-- Columnas nulas en todo lo demás: una chequera no tiene comisión de cobrador.
-- ============================================================================

ALTER TABLE bancos_estados_cuenta
  ADD COLUMN IF NOT EXISTS comision_total NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS comision_base  NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS comision_iva   NUMERIC(14,2);

COMMENT ON COLUMN bancos_estados_cuenta.comision_total IS
  'Comisión del cobrador de pagos en el periodo, CON IVA (NULL si no es un cobrador).';
COMMENT ON COLUMN bancos_estados_cuenta.comision_base IS
  'Base de la comisión = comision_total / 1.16. Es el gasto deducible.';
COMMENT ON COLUMN bancos_estados_cuenta.comision_iva IS
  'IVA de la comisión = comision_total - comision_base. Acreditable con el CFDI del cobrador.';
