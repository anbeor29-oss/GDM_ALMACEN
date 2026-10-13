-- Enlace recibo de nómina ↔ movimiento bancario que lo pagó.
--
-- Para el modo "Nómina" de la Conciliación bancaria: listar los recibos timbrados
-- que están POR PAGAR y, al contabilizar el pago (cargo 210.01 Nómina por pagar /
-- abono Bancos), marcar los recibos pagados para que ya no reaparezcan.
--
-- ON DELETE SET NULL: si se borra el movimiento (o su estado de cuenta), el recibo
-- vuelve a quedar por pagar. Deshacer la contabilización también limpia el enlace.

ALTER TABLE nomina_recibos
  ADD COLUMN IF NOT EXISTS pagado_mov_id UUID REFERENCES bancos_movimientos(id) ON DELETE SET NULL;
ALTER TABLE nomina_recibos
  ADD COLUMN IF NOT EXISTS pagado_at TIMESTAMP;

-- Índice para listar rápido lo que está por pagar.
CREATE INDEX IF NOT EXISTS ix_nomina_recibos_por_pagar
  ON nomina_recibos (company_id)
  WHERE pagado_mov_id IS NULL;
