-- ═══════════════════════════════════════════════════════════════════════════
-- El grupo de trabajo CONTABILIDAD, también en la base
--
-- PARA QUÉ
-- El grupo se declaró en GROUP_MODULES y GROUP_CAPABILITIES, pero la base tiene
-- su propia lista cerrada en dos CHECK. Sin esta migración el sistema deja
-- ELEGIR el grupo en la pantalla y la base lo rechaza al guardar: el usuario ve
-- un error genérico al dar de alta al contador y nada explica por qué.
--
-- Es el mismo tropiezo que ya se tuvo con VALID_WORK_GROUPS hardcodeado. La
-- lección que quedó: una lista de grupos escrita en dos lugares se desincroniza
-- —y el que se entera es quien está dando de alta a alguien.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_work_group;
ALTER TABLE users ADD CONSTRAINT chk_users_work_group
  CHECK (work_group IS NULL OR work_group = ANY (ARRAY[
    'ADMIN_ALL','VENTAS','ALMACEN','COMPRAS','TESORERIA','PUNTO_VENTA',
    'RECURSOS_HUMANOS','CONTABILIDAD'
  ]));

ALTER TABLE user_companies DROP CONSTRAINT IF EXISTS chk_user_companies_work_group;
ALTER TABLE user_companies ADD CONSTRAINT chk_user_companies_work_group
  CHECK (work_group IS NULL OR work_group = ANY (ARRAY[
    'ADMIN_ALL','VENTAS','ALMACEN','COMPRAS','TESORERIA','PUNTO_VENTA',
    'RECURSOS_HUMANOS','CONTABILIDAD'
  ]));
