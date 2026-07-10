-- ============================================================================
-- Actualiza el precio del plan de uso libre (PKG_FLEX) a $4.99 MXN por timbre.
-- (Precio anterior: $2.00). Idempotente — solo modifica el registro existente.
-- ============================================================================

UPDATE stamp_packages
   SET extra_stamp_mxn = 4.99
 WHERE code = 'PKG_FLEX';
