-- ============================================================================
-- UNIFICAR EL VOCABULARIO DE GRUPOS DE TRABAJO
--
-- La fusión de GDM_FAC + GDM ALMACÉN dejó DOS constraints vivos sobre
-- users.work_group, cada uno con un vocabulario distinto y ninguno de los dos
-- borrando al otro:
--
--   · 2026-07-11_pos_and_groups.sql → chk_work_group
--       ('ADMIN_ALL','VENTAS','ALMACEN','COMPRAS','TESORERIA')
--   · 2026-07-14_work_groups.sql    → chk_user_work_group
--       ('ADMIN_ALL','VENTAS','INVENTARIOS','COMPRAS','TESORERIA')
--
-- Como en Postgres TODOS los CHECK de una tabla deben cumplirse a la vez, la
-- intersección real de valores aceptados quedó en cuatro:
--   ADMIN_ALL, VENTAS, COMPRAS, TESORERIA.
--
-- Es decir: el grupo de almacén era IMPOSIBLE de guardar. Con 'ALMACEN'
-- reventaba chk_user_work_group y con 'INVENTARIOS' reventaba chk_work_group.
-- Ese es el error que veía el operador al dar de alta un usuario de almacén.
--
-- Canónico = 'ALMACEN', porque es lo que ya emiten el backend
-- (admin-users.routes.ts) y ambos mapas de permisos, y es la etiqueta que se
-- muestra en el menú ("Almacén"). 'INVENTARIOS' fue un sinónimo que nunca
-- llegó a escribirse desde la UI, pero se convierte por si alguna BD lo tiene.
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- 1) Normalizar datos ANTES de imponer el constraint nuevo.
UPDATE users SET work_group = 'ALMACEN' WHERE work_group = 'INVENTARIOS';

-- Cualquier valor fuera del vocabulario (BD tocada a mano) cae a ADMIN_ALL:
-- es el comportamiento que ya tenía el código al no reconocer un grupo, y
-- preferimos un usuario que ve de más a un ALTER TABLE que aborta el deploy.
UPDATE users
   SET work_group = 'ADMIN_ALL'
 WHERE work_group IS NULL
    OR work_group NOT IN ('ADMIN_ALL', 'VENTAS', 'ALMACEN', 'COMPRAS', 'TESORERIA');

-- 2) Un solo constraint, un solo vocabulario.
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_work_group;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_user_work_group;
ALTER TABLE users ADD CONSTRAINT chk_user_work_group
  CHECK (work_group IN ('ADMIN_ALL', 'VENTAS', 'ALMACEN', 'COMPRAS', 'TESORERIA'));

COMMENT ON COLUMN users.work_group IS
  'Grupo de trabajo: define qué pantallas ve el usuario. Vocabulario único: '
  'ADMIN_ALL | VENTAS | ALMACEN | COMPRAS | TESORERIA (ver middleware/permissions.ts)';

COMMIT;
