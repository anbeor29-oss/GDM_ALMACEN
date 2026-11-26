/*
 * Tasa de recargos por MORA de 2027 (Art. 21 CFF / Art. 11 LIF 2027).
 *
 * La LIF 2027 (DOF 13-11-2026) conserva la tasa de prórroga de 2026: 1.38 %
 * mensual sobre saldos insolutos (Art. 11, fr. I). La de mora es esa más 50 %,
 * así que 2027 se queda en 2.07 %, igual que 2026.
 *
 * Se siembra explícitamente aunque el cálculo tenga un fallback al año más
 * cercano: el papel de trabajo de un pago extemporáneo no debe depender de una
 * coincidencia. Si la LIF se modifica a media temporada, basta un UPDATE.
 *
 * Las parcialidades de la LIF 2027 (1.42 % hasta 12 meses, 1.63 % de 12 a 24 y
 * 1.97 % a más de 24 meses o pago diferido) tampoco cambiaron; no se guardan en
 * esta tabla porque el motor de actualización y recargos solo usa la de mora.
 */
INSERT INTO fiscal_tasa_recargos (anio, tasa_mora, fuente) VALUES
  (2027, 2.0700, 'LIF 2027 (base 1.38% + 50%) — DOF 13-11-2026')
ON CONFLICT (anio) DO NOTHING;
