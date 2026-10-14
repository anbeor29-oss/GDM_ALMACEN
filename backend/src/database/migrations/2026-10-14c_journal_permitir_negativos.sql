-- ============================================================================
-- Permitir cargos/abonos NEGATIVOS en las pólizas (pólizas de ajuste)
--
-- Los contadores registran ajustes/correcciones con un importe NEGATIVO del
-- MISMO lado (un cargo de −500, en vez de un abono de +500), para que el
-- movimiento bruto del renglón quede fiel al sistema de origen (Contalink/CPQ) y
-- al auxiliar. NEXO lo prohibía con `jl_no_negativos` (cargo>=0 AND abono>=0).
--
-- Se relaja: se quita esa regla y la de "no ambos positivos" se reemplaza por
-- "a lo más UN lado distinto de cero" (el renglón sigue siendo de una sola
-- columna, pero su importe puede ser negativo). El CUADRE (trigger: Σcargo =
-- Σabono) NO cambia: sigue exigiendo que la póliza cuadre, ahora con signo.
--
-- Nota: al generar el XML de Contabilidad Electrónica del SAT, los Debe/Haber se
-- netean a no-negativos (el SAT no admite negativos) — se maneja en código.
-- ============================================================================
ALTER TABLE journal_lines DROP CONSTRAINT IF EXISTS jl_no_negativos;
ALTER TABLE journal_lines DROP CONSTRAINT IF EXISTS jl_cargo_o_abono;

-- Un renglón es de UN solo lado: a lo más una de las dos columnas es distinta de 0
-- (cualquier signo). Dos columnas distintas de 0 a la vez sigue prohibido.
ALTER TABLE journal_lines
  ADD CONSTRAINT jl_un_solo_lado CHECK (NOT (cargo <> 0 AND abono <> 0));
