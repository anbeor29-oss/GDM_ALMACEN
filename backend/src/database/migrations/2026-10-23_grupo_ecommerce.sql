-- ═══════════════════════════════════════════════════════════════════════════
-- Grupo de trabajo ECOMMERCE — la cuenta que SÓLO ve la tienda en línea
--
-- Un usuario con work_group='ECOMMERCE' entra directo a «Comercio Electrónico» y
-- no ve el resto de NEXO (facturación, nómina, contabilidad, XML, tablero). Así
-- se le puede dar la tienda a quien la administra sin exponerle el ERP fiscal.
-- El super admin de la plataforma sigue viendo todo (no usa grupos).
--
-- Igual que con CONTABILIDAD y CHECADOR: el grupo se declara en el código
-- (GROUP_MODULES, front y back), pero la base tiene su lista cerrada en dos
-- CHECK. Sin agregarlo aquí, el alta del usuario con work_group='ECOMMERCE' la
-- rechaza la base.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_work_group;
ALTER TABLE users ADD CONSTRAINT chk_users_work_group
  CHECK (work_group IS NULL OR work_group = ANY (ARRAY[
    'ADMIN_ALL','VENTAS','ALMACEN','COMPRAS','TESORERIA','PUNTO_VENTA',
    'RECURSOS_HUMANOS','CONTABILIDAD','CHECADOR','ECOMMERCE'
  ]));

ALTER TABLE user_companies DROP CONSTRAINT IF EXISTS chk_user_companies_work_group;
ALTER TABLE user_companies ADD CONSTRAINT chk_user_companies_work_group
  CHECK (work_group IS NULL OR work_group = ANY (ARRAY[
    'ADMIN_ALL','VENTAS','ALMACEN','COMPRAS','TESORERIA','PUNTO_VENTA',
    'RECURSOS_HUMANOS','CONTABILIDAD','CHECADOR','ECOMMERCE'
  ]));
