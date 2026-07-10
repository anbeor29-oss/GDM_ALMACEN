-- ================================================================
-- INVENTARIO — Fase 3: integración ventas ↔ inventario
-- Decisión D3 del plan: ¿venta sin existencia bloquea o solo alerta?
--   · false (default) = ALERTAR sin bloquear — no se para el mostrador;
--     se descuenta lo disponible y la diferencia queda anotada en el kardex.
--   · true = BLOQUEAR el timbrado si falta existencia (se valida ANTES de
--     gastar el timbre con el PAC).
-- ================================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS inventory_block_no_stock BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN companies.inventory_block_no_stock IS
  'D3 ALMACEN: true = bloquear timbrado sin existencia; false = alertar y descontar lo disponible';
