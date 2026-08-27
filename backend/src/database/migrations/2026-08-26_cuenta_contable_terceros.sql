-- ═══════════════════════════════════════════════════════════════════════════
-- La cuenta contable de cada tercero, guardada en su propio expediente
--
-- PARA QUÉ
-- La subcuenta de un cliente/proveedor (105-01-001, 201-01-002…) vive en
-- accounting_accounts amarrada por tercero_rfc. Pero el catálogo de terceros
-- (customers) no la conocía: había proveedores dados de alta y sin cuenta, y la
-- generación sólo miraba los CFDI recibidos, así que un proveedor capturado a
-- mano —sin factura todavía— nunca obtenía su número.
--
-- Aquí se guarda el CÓDIGO de su subcuenta en el propio expediente. Así la
-- pantalla de proveedores/clientes lo muestra, y la generación de subcuentas
-- puede partir del catálogo (no sólo de los comprobantes).
--
-- Es un ESPEJO del código que manda en accounting_accounts (ahí sigue la cuenta
-- real, con su tercero_rfc). Un tercero que sea cliente Y proveedor tiene dos
-- subcuentas (105 y 201); este campo guarda la del rol que se generó.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE customers ADD COLUMN IF NOT EXISTS cuenta_contable VARCHAR(40);
