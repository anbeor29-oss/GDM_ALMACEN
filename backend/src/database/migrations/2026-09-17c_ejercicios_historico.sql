/*
 * Histórico de indicadores anuales (UMA, salarios mínimos, UMI) — 8 años.
 *
 * Para tener la serie «a la orden» (2019–2026) en Nómina → Parámetros y en
 * Contabilidad → Indicadores. La UMA se actualiza el 1-feb, los salarios mínimos
 * y la UMI el 1-ene; ninguno tiene API limpia, así que se siembran a mano.
 *
 * NACEN SIN CONFIRMAR. Como el resto de los ejercicios, se marcan confirmado=false
 * hasta que alguien los coteje contra el DOF; la pantalla lo advierte. El 2026 ya
 * está cotejado (migración 2026-08-17h) y NO se toca — el ON CONFLICT lo respeta.
 *
 * VALORES (diarios; UMA mensual = diaria × 30.4):
 *   Año   UMA diaria  UMA mensual   SM general  SM frontera  UMI diaria
 *   2019    84.49      2,568.50       102.68      176.72        82.22
 *   2020    86.88      2,641.15       123.22      185.56        84.55
 *   2021    89.62      2,724.45       141.70      213.39        87.21
 *   2022    96.22      2,925.09       172.87      260.34        91.56
 *   2023   103.74      3,153.70       207.44      312.41        96.32
 *   2024   108.57      3,300.53       248.93      374.89       100.81
 *   2025   113.14      3,439.46       278.80      419.88       100.81
 *   (2026  117.31      3,566.22       315.04      440.87       100.81 — ya cotejado)
 */
INSERT INTO nomina_ejercicios
  (anio, uma_diaria, uma_mensual, umi_diaria, smg_general, smg_frontera, fuente, confirmado)
VALUES
  (2019,  84.49, 2568.50,  82.22, 102.68, 176.72, 'Sembrado histórico UMA/SM/UMI — PENDIENTE de cotejar contra el DOF.', false),
  (2020,  86.88, 2641.15,  84.55, 123.22, 185.56, 'Sembrado histórico UMA/SM/UMI — PENDIENTE de cotejar contra el DOF.', false),
  (2021,  89.62, 2724.45,  87.21, 141.70, 213.39, 'Sembrado histórico UMA/SM/UMI — PENDIENTE de cotejar contra el DOF.', false),
  (2022,  96.22, 2925.09,  91.56, 172.87, 260.34, 'Sembrado histórico UMA/SM/UMI — PENDIENTE de cotejar contra el DOF.', false),
  (2023, 103.74, 3153.70,  96.32, 207.44, 312.41, 'Sembrado histórico UMA/SM/UMI — PENDIENTE de cotejar contra el DOF.', false),
  (2024, 108.57, 3300.53, 100.81, 248.93, 374.89, 'Sembrado histórico UMA/SM/UMI — PENDIENTE de cotejar contra el DOF.', false),
  (2025, 113.14, 3439.46, 100.81, 278.80, 419.88, 'Sembrado histórico UMA/SM/UMI — PENDIENTE de cotejar contra el DOF.', false)
ON CONFLICT (anio) DO NOTHING;
