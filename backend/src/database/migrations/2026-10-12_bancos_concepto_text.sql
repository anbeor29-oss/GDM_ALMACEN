-- 2026-10-12: el CONCEPTO de un movimiento bancario ahora lleva el DETALLE completo
-- del estado de cuenta (varias líneas: contraparte, referencia SPEI, etc.), no solo
-- una etiqueta genérica como "MOVIMIENTO BANCARIO". Pasa de VARCHAR(200) a TEXT para
-- que quepa (la lógica de retiro/depósito no cambia; se sigue leyendo la línea
-- principal del movimiento).
ALTER TABLE bancos_movimientos ALTER COLUMN concepto TYPE TEXT;
