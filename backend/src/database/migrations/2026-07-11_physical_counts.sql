-- ================================================================
-- INVENTARIO — Fase 6 (M6): Inventario físico y conciliación (§11)
-- Conteo por almacén → captura de existencia física → comparación con el
-- sistema → autorización → ajuste automático al kardex.
-- ================================================================
-- Idempotente y autosuficiente en BD virgen (regla 26). Solo depende de
-- schema base + inventory_core. Fecha 07-11 la ordena después de todo lo del 07-10.

CREATE TABLE IF NOT EXISTS physical_counts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id)  ON DELETE CASCADE,
  warehouse_id  UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  folio         INT  NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN',       -- capturando conteo
                                  'CLOSED',     -- conciliado y ajustado
                                  'CANCELLED')),
  category      VARCHAR(100),                   -- conteo acotado a una categoría (§11)
  notes         TEXT,
  started_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  closed_at     TIMESTAMP,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_email VARCHAR(255),
  authorized_by UUID REFERENCES users(id) ON DELETE SET NULL,
  authorized_by_email VARCHAR(255),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE(company_id, folio)
);

CREATE INDEX IF NOT EXISTS idx_physical_counts_company ON physical_counts(company_id, status);

-- Solo un conteo ABIERTO por almacén a la vez (evita capturas solapadas)
CREATE UNIQUE INDEX IF NOT EXISTS uq_physical_count_open_per_warehouse
  ON physical_counts(warehouse_id) WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS physical_count_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  physical_count_id UUID NOT NULL REFERENCES physical_counts(id) ON DELETE CASCADE,
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  system_qty        NUMERIC(15,6) NOT NULL DEFAULT 0,  -- existencia del sistema al ABRIR (congelada)
  counted_qty       NUMERIC(15,6),                     -- lo que se contó físicamente (NULL = sin contar)
  avg_cost          NUMERIC(15,6) NOT NULL DEFAULT 0,  -- para valuar la diferencia
  -- difference = counted - system (positivo = sobrante, negativo = faltante)
  difference        NUMERIC(15,6) GENERATED ALWAYS AS
                      (COALESCE(counted_qty, system_qty) - system_qty) STORED,
  adjustment_movement_id UUID REFERENCES inventory_movements(id) ON DELETE SET NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE(physical_count_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_pci_count   ON physical_count_items(physical_count_id);
CREATE INDEX IF NOT EXISTS idx_pci_product ON physical_count_items(product_id);

COMMENT ON TABLE physical_counts IS
  'Inventario físico (§11): congela existencia del sistema al abrir; el cierre autorizado ajusta contra el stock ACTUAL vía applyMovement';
COMMENT ON COLUMN physical_count_items.system_qty IS
  'Existencia del sistema al momento de ABRIR el conteo — referencia para la diferencia declarada';
