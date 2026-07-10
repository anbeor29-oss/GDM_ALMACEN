-- ============================================================================
-- Actualiza el precio del plan de uso libre (PKG_FLEX) a $4.99 MXN por timbre.
-- (Precio anterior: $2.00). Idempotente — solo modifica el registro existente.
--
-- Fix bootstrap (regla 26): en BD virgen la tabla stamp_packages aún no existe
-- (se crea en 2026-07-01_stamp_packages.sql, fecha posterior). El guard hace
-- que esta migración sea un no-op en ese caso — el archivo del 07-01 ya
-- inserta PKG_FLEX con 4.99 directamente o el precio queda corregido al
-- reejecutar sobre BD existente.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.stamp_packages') IS NOT NULL THEN
    UPDATE stamp_packages
       SET extra_stamp_mxn = 4.99
     WHERE code = 'PKG_FLEX';
  END IF;
END $$;
