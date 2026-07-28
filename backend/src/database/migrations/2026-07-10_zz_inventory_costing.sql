-- ================================================================
-- INVENTARIO — Política de costos al recibir mercancía a costo distinto
--
-- Requerimiento del usuario: cuando ya hay existencia a precio X y llega
-- mercancía a precio Z, el sistema PREGUNTA cómo aplicar el costo:
--   · PROMEDIO (default) — prorratea: costo promedio ponderado
--   · ULTIMO             — aumenta en forma general: todo el stock se
--                          revalúa al costo de la última compra
--   · CAPAS              — respeta los precios: lo existente queda a X y
--                          lo nuevo entra a Z (capas FIFO; las salidas
--                          consumen primero la capa más antigua)
--
-- La política vive por empresa (inventory_costing_method) y puede
-- sobreescribirse por operación (el selector del wizard/recepción).
-- ================================================================
-- Nombre con prefijo zz_ para ordenar DESPUÉS de _purchase_orders (alfabético).

ALTER TABLE companies ADD COLUMN IF NOT EXISTS inventory_costing_method VARCHAR(10)
  NOT NULL DEFAULT 'PROMEDIO';
ALTER TABLE companies DROP CONSTRAINT IF EXISTS chk_inventory_costing;
ALTER TABLE companies ADD CONSTRAINT chk_inventory_costing
  CHECK (inventory_costing_method IN ('PROMEDIO', 'ULTIMO', 'CAPAS'));

COMMENT ON COLUMN companies.inventory_costing_method IS
  'PROMEDIO=prorratear (ponderado) · ULTIMO=revaluar todo al último costo · CAPAS=FIFO por capas de precio';

-- Capas de costo (solo se pueblan cuando la política efectiva es CAPAS)
CREATE TABLE IF NOT EXISTS stock_cost_layers (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id         UUID NOT NULL REFERENCES companies(id)  ON DELETE CASCADE,
  warehouse_id       UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id         UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  quantity_remaining NUMERIC(15,6) NOT NULL CHECK (quantity_remaining >= 0),
  unit_cost          NUMERIC(15,6) NOT NULL,
  received_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  movement_id        UUID REFERENCES inventory_movements(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cost_layers_fifo
  ON stock_cost_layers(warehouse_id, product_id, received_at)
  WHERE quantity_remaining > 0;

COMMENT ON TABLE stock_cost_layers IS
  'Capas FIFO de costo (política CAPAS): cada compra a precio distinto es una capa; las salidas consumen la más antigua primero';
