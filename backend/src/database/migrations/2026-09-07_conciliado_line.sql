-- ═══════════════════════════════════════════════════════════════════════════
-- COTEJO BANCO ↔ CONTABILIDAD
--
-- Un movimiento del banco puede EMPATAR con un movimiento que YA está asentado en
-- la contabilidad (la cuenta 102 del banco), en vez de generar una póliza nueva.
-- Aquí se guarda cuál renglón del libro le empató, para no cotejarlo dos veces y
-- para poder deshacer el cotejo. `poliza_id` guarda la póliza (nueva o empatada) y
-- `concil_estado='conciliado'` distingue el que empató contra el libro.
-- ═══════════════════════════════════════════════════════════════════════════
-- Idempotente y autosuficiente en BD virgen (regla 26).

ALTER TABLE bancos_movimientos
  ADD COLUMN IF NOT EXISTS conciliado_line_id UUID REFERENCES journal_lines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bancos_movimientos_concil_line_ix
  ON bancos_movimientos (conciliado_line_id) WHERE conciliado_line_id IS NOT NULL;
