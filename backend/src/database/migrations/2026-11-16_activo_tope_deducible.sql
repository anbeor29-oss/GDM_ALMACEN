-- ============================================================================
-- Tope deducible del MOI para automóviles (LISR art. 36, fracc. II).
--
-- La depreciación CONTABLE (NIF C-6) se calcula sobre el 100 % del MOI, pero la
-- parte DEDUCIBLE para ISR de un AUTOMÓVIL está topada: el MOI deducible no puede
-- exceder $175,000 (combustión) o $250,000 (eléctrico/híbrido). El excedente genera
-- una depreciación NO DEDUCIBLE que se concilia en la declaración anual.
--
-- `tope_deducible` es el MOI máximo deducible del activo:
--   · NULL  → sin tope (la depreciación es 100 % deducible: la regla general).
--   · >= 0  → el MOI se topa a este valor para la parte deducible (autos).
-- Es editable por activo (el usuario confirma/ajusta el tope sugerido).
-- No cambia el asiento contable (que sigue siendo sobre el MOI completo); sólo
-- alimenta la cédula fiscal y el cálculo de lo no deducible.
-- ============================================================================

ALTER TABLE activos_fijos
  ADD COLUMN IF NOT EXISTS tope_deducible NUMERIC(16,2)
  CHECK (tope_deducible IS NULL OR tope_deducible >= 0);

COMMENT ON COLUMN activos_fijos.tope_deducible IS
  'MOI máximo deducible para ISR (LISR 36-II autos: 175000 combustión / 250000 eléctrico). NULL = sin tope (100% deducible).';
