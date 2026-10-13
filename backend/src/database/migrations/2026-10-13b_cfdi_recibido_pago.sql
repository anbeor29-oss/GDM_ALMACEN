-- Enlace factura recibida (compra) ↔ movimiento bancario que la pagó.
--
-- Para el modo "Proveedor" de la Conciliación: listar las facturas recibidas que
-- están POR PAGAR (sólo se les hizo el pasivo), elegir las que cuadran con el
-- egreso y, al contabilizar, marcarlas pagadas para que no reaparezcan ni queden
-- "volando" con el pasivo abierto. ON DELETE SET NULL: borrar el movimiento (o
-- deshacer la contabilización) las vuelve a dejar por pagar.

ALTER TABLE cfdi_recibidos
  ADD COLUMN IF NOT EXISTS pagado_mov_id UUID REFERENCES bancos_movimientos(id) ON DELETE SET NULL;
ALTER TABLE cfdi_recibidos
  ADD COLUMN IF NOT EXISTS pagado_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS ix_cfdi_recibidos_por_pagar
  ON cfdi_recibidos (company_id)
  WHERE pagado_mov_id IS NULL;
