-- ═══════════════════════════════════════════════════════════════════════════
-- Grupo de trabajo CHECADOR — la cuenta universal que SOLO checa
--
-- El personal checa en el kiosko/celular con una cuenta compartida; la CARA
-- identifica a cada quien. Esa cuenta no debe alcanzar nómina (sueldos, CURP)
-- ni siquiera el enrolamiento: sólo registrar su entrada/salida.
--
-- Igual que con CONTABILIDAD: el grupo se declara en el código (GROUP_MODULES),
-- pero la base tiene su lista cerrada en dos CHECK. Sin agregarlo aquí, el alta
-- (o la siembra) del usuario con work_group='CHECADOR' la rechaza la base.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_work_group;
ALTER TABLE users ADD CONSTRAINT chk_users_work_group
  CHECK (work_group IS NULL OR work_group = ANY (ARRAY[
    'ADMIN_ALL','VENTAS','ALMACEN','COMPRAS','TESORERIA','PUNTO_VENTA',
    'RECURSOS_HUMANOS','CONTABILIDAD','CHECADOR'
  ]));

ALTER TABLE user_companies DROP CONSTRAINT IF EXISTS chk_user_companies_work_group;
ALTER TABLE user_companies ADD CONSTRAINT chk_user_companies_work_group
  CHECK (work_group IS NULL OR work_group = ANY (ARRAY[
    'ADMIN_ALL','VENTAS','ALMACEN','COMPRAS','TESORERIA','PUNTO_VENTA',
    'RECURSOS_HUMANOS','CONTABILIDAD','CHECADOR'
  ]));
