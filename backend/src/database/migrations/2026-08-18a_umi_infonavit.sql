/*
 * UMI — Unidad Mixta Infonavit.
 *
 * QUÉ ES Y POR QUÉ HACE FALTA
 * Los créditos del INFONAVIT otorgados en Veces Salario Mínimo (VSM) dejaron de
 * actualizarse con el salario mínimo en la reforma de 2016. Se creó la UMI
 * justamente para eso: para que las alzas del mínimo no inflaran la deuda del
 * trabajador. Desde entonces el descuento de un crédito en VSM se calcula con
 * la UMI, no con el salario mínimo.
 *
 * EL MOTOR LO ESTABA HACIENDO CON EL SALARIO MÍNIMO
 * `calcularInfonavit` multiplicaba por `smgDeZona()`. Con los valores de 2026
 * —mínimo $315.04 contra UMI $100.81— a un crédito de 2 VSM se le descontaban
 * $630.08 al mes en vez de $201.62: más del triple. Y el error crece cada año,
 * porque el mínimo sube 13% mientras la UMI lleva tres ejercicios congelada.
 *
 * VALOR 2026
 * $100.81 diarios — el mismo de 2024 y 2025. El INFONAVIT la congeló por tercer
 * año (0% de incremento) para proteger a los acreditados. Como no cambió, la
 * discrepancia entre las fuentes sobre si rige desde el 1 de enero o desde el
 * 1 de febrero no altera ningún cálculo de 2026.
 */

ALTER TABLE nomina_ejercicios
  ADD COLUMN IF NOT EXISTS umi_diaria NUMERIC(10,2);

COMMENT ON COLUMN nomina_ejercicios.umi_diaria IS
  'Unidad Mixta Infonavit. Base diaria del descuento de los créditos en VSM '
  'desde la reforma de 2016 — NO el salario mínimo.';

UPDATE nomina_ejercicios
   SET umi_diaria = 100.81,
       fuente = COALESCE(fuente, '') ||
         ' UMI: INFONAVIT, $100.81 diarios en 2026 (congelada, mismo valor que 2024 y 2025); '
         'es la base de los créditos en VSM desde la reforma de 2016.',
       updated_at = NOW()
 WHERE anio = 2026 AND umi_diaria IS NULL;
