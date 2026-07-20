-- ============================================================================
-- Consolidación de usuarios en GDM_ALMACEN — 2026-07-20
--
-- OBJETIVO: dejar UN solo login (admin@gdmalmacen.mx con rol SUPER_ADMIN) que
-- entra desde el menú Empresas y "entra" a cada empresa como ADMIN vía el
-- botón nuevo POST /admin/companies/:id/enter.
--
-- Antes:
--   · superadmin@plataforma.local — SUPER_ADMIN (dispersa)
--   · admin@gdmalmacen.mx        — ADMIN de la empresa GDM ALMACEN DEMO
--
-- Después:
--   · admin@gdmalmacen.mx        — SUPER_ADMIN (único login)
--   · hcgm-admin@gdmalmacen.mx   — ADMIN de la empresa GDM ALMACEN DEMO
--     (renombrado + mantiene la contraseña original para no perder acceso a
--      la empresa; el SUPER_ADMIN puede impersonar a este user)
--
-- Ejecutar en psql shell de Render, DB gdm_almacen_1wiu.
-- IDEMPOTENTE — se puede correr N veces sin daño.
-- ============================================================================
BEGIN;

-- 1) Renombrar el actual admin@gdmalmacen.mx a hcgm-admin@gdmalmacen.mx.
--    Mantiene rol ADMIN y su company_id (GDM ALMACEN DEMO).
UPDATE users
   SET email = 'hcgm-admin@gdmalmacen.mx'
 WHERE email = 'admin@gdmalmacen.mx'
   AND role = 'ADMIN';

-- 2) Promover el actual SUPER_ADMIN (superadmin@plataforma.local) y renombrarlo
--    a admin@gdmalmacen.mx.
UPDATE users
   SET email = 'admin@gdmalmacen.mx',
       first_name = 'Antonio',
       last_name  = 'Bernal'
 WHERE email = 'superadmin@plataforma.local'
   AND role = 'SUPER_ADMIN';

-- 3) Reporte de estado final
SELECT email, role,
       CASE WHEN company_id IS NULL THEN '—' ELSE company_id::text END AS empresa
  FROM users
 WHERE email IN ('admin@gdmalmacen.mx', 'hcgm-admin@gdmalmacen.mx', 'superadmin@gdmalmacen.mx')
    OR role = 'SUPER_ADMIN'
 ORDER BY role, email;

COMMIT;

-- Después de correr esto:
-- · Login SUPER_ADMIN: admin@gdmalmacen.mx (contraseña que tenía superadmin@plataforma.local)
-- · ADMIN de empresa: hcgm-admin@gdmalmacen.mx (contraseña que tenía el viejo admin@gdmalmacen.mx)
-- · Desde /admin/companies → nuevo botón LogIn (verde) entra como el ADMIN de la empresa.
