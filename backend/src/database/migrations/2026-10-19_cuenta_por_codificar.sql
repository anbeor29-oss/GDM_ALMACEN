-- ============================================================================
-- Cuenta temporal de migración → nombre visible «POR CODIFICAR»
--
-- La cuenta suspense donde caen el descuadre de origen y las partidas sin cuenta
-- al importar respaldos (CPQ/CTLK) se llamaba «CUENTA TEMPORAL DE MIGRACIÓN
-- (reasignar)». El usuario la quiere denominada «Por codificar» para su revisión.
-- El código interno NO cambia (sigue MIG-TEMPORAL) para no romper las pólizas ya
-- ligadas; sólo se actualiza el nombre de las que ya existan.
-- ============================================================================
UPDATE accounting_accounts
   SET nombre = 'POR CODIFICAR (reasignar)', updated_at = NOW()
 WHERE codigo = 'MIG-TEMPORAL'
   AND nombre <> 'POR CODIFICAR (reasignar)';
