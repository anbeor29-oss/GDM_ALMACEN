-- ============================================================================
-- GRUPOS DE TRABAJO — definen QUÉ PANTALLAS ve cada usuario.
--
-- Ortogonal a rol (SUPER_ADMIN/ADMIN/MANAGER/USER) y a las capacidades finas:
--   · rol        = nivel de autoridad
--   · work_group = qué módulos/pantallas aparecen en el menú
--   · capacidades = qué acciones puede hacer dentro de esas pantallas
--
-- Grupos:
--   ADMIN_ALL    → todo (default; ADMIN y SUPER_ADMIN operan así)
--   VENTAS       → punto de venta, facturas, clientes, notas de crédito
--   INVENTARIOS  → productos, inventario, almacenes, inventario físico
--   COMPRAS      → compras (XML), órdenes de compra
--   TESORERIA    → tesorería, proveedores
--
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS work_group VARCHAR(16) NOT NULL DEFAULT 'ADMIN_ALL';

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_user_work_group;
ALTER TABLE users ADD CONSTRAINT chk_user_work_group
  CHECK (work_group IN ('ADMIN_ALL', 'VENTAS', 'INVENTARIOS', 'COMPRAS', 'TESORERIA'));

COMMENT ON COLUMN users.work_group IS
  'Grupo de trabajo: define qué pantallas ve el usuario (ADMIN_ALL = todas)';

COMMIT;
