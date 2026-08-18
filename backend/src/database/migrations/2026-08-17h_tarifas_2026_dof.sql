/*
 * Parámetros fiscales 2026, cotejados contra el DOF.
 *
 * QUÉ HABÍA ANTES
 * Lo que copió el sistema anterior (NOM_COM_1) y quedó marcado "PENDIENTE de
 * cotejar". No eran las tarifas de 2026: la tabla mensual sembrada empezaba en
 * 0.01–746.04 con cuota 14.32, que es la del ejercicio 2023, y la UMA venía
 * revuelta —uma_diaria 113.14 (la de 2025) con uma_mensual 3,300.72 (la de
 * 2024)—. Con esa mezcla, 113.14 × 30.4 no daba la UMA mensual guardada, así
 * que las exenciones del Art. 93 y el tope de 25 UMA del Art. 28 LSS salían de
 * dos años distintos al mismo tiempo.
 *
 * DE DÓNDE SALE CADA NÚMERO
 *   · Tarifas del Art. 96 LISR → Anexo 8 de la RMF 2026, DOF 28/12/2025,
 *     apartado B, fracciones II (7 días), IV (15 días) y V (mensual).
 *     Factor de actualización 1.1321.
 *   · Subsidio al empleo → DECRETO que modifica el que otorga el subsidio para
 *     el empleo, DOF 31/12/2025, en vigor el 1 de enero de 2026.
 *   · UMA → INEGI, DOF 09/01/2026, vigente desde el 1 de febrero de 2026.
 *   · Salarios mínimos → CONASAMI, vigentes desde el 1 de enero de 2026.
 *
 * EL SUBSIDIO YA NO ES UNA TABLA, ES UN PORCENTAJE
 * Desde el decreto de 2024 el subsidio dejó de ser una escalera de once
 * renglones: es un solo importe para quien gana hasta cierto tope. El decreto
 * de 2026 lo define como un PORCENTAJE del valor mensual de la UMA —15.02%—,
 * no como una cantidad fija. Por eso aquí se guarda el porcentaje además del
 * importe: cuando el INEGI mueva la UMA, el importe se vuelve a derivar en
 * lugar de quedar congelado y silenciosamente mal.
 *
 * ENERO DE 2026 ES DISTINTO, Y ESTÁ EN EL DECRETO
 * El transitorio segundo manda usar 15.59% durante enero, porque la UMA se
 * actualiza hasta febrero. Un solo renglón por año no puede representar eso,
 * así que el subsidio gana vigencia por fechas. Sin esto, un finiquito o una
 * nómina retroactiva de enero se calcularía con el subsidio de febrero.
 */

/* ── Vigencia y porcentaje en el subsidio ────────────────────────────── */

ALTER TABLE nomina_subsidio
  ADD COLUMN IF NOT EXISTS vigente_desde  DATE,
  ADD COLUMN IF NOT EXISTS vigente_hasta  DATE,
  ADD COLUMN IF NOT EXISTS porcentaje_uma NUMERIC(7,4);

COMMENT ON COLUMN nomina_subsidio.vigente_desde IS
  'Primer día en que aplica este renglón. NULL = todo el ejercicio.';
COMMENT ON COLUMN nomina_subsidio.vigente_hasta IS
  'Último día en que aplica. NULL = hasta que termine el ejercicio.';
COMMENT ON COLUMN nomina_subsidio.porcentaje_uma IS
  'Porcentaje del valor MENSUAL de la UMA que manda el decreto. El importe de '
  'la columna subsidio es ese porcentaje ya aplicado; se guardan los dos para '
  'poder rederivarlo cuando el INEGI mueva la UMA.';


/* ── Tarifa del Art. 96 LISR — Anexo 8 RMF 2026, DOF 28/12/2025 ──────── */

DELETE FROM nomina_tarifa_isr WHERE anio = 2026;

/* Mensual — apartado B, fracción V. Es la que usa el motor: mensualiza la
 * base, busca el renglón y regresa el resultado a la escala del periodo, tal
 * como lo hacía el sistema anterior. */
INSERT INTO nomina_tarifa_isr
  (anio, periodicidad, renglon, limite_inferior, limite_superior, cuota_fija, porcentaje)
VALUES
  (2026,'MENSUAL', 1,      0.01,      844.59,      0.00,  1.92),
  (2026,'MENSUAL', 2,    844.60,     7168.51,     16.22,  6.40),
  (2026,'MENSUAL', 3,   7168.52,    12598.02,    420.95, 10.88),
  (2026,'MENSUAL', 4,  12598.03,    14644.64,   1011.68, 16.00),
  (2026,'MENSUAL', 5,  14644.65,    17533.64,   1339.14, 17.92),
  (2026,'MENSUAL', 6,  17533.65,    35362.83,   1856.84, 21.36),
  (2026,'MENSUAL', 7,  35362.84,    55736.68,   5665.16, 23.52),
  (2026,'MENSUAL', 8,  55736.69,   106410.50,  10457.09, 30.00),
  (2026,'MENSUAL', 9, 106410.51,   141880.66,  25659.23, 32.00),
  (2026,'MENSUAL',10, 141880.67,   425641.99,  37009.69, 34.00),
  (2026,'MENSUAL',11, 425642.00,        NULL, 133488.54, 35.00);

/* Semanal — apartado B, fracción II (pagos por periodo de 7 días).
 * El motor no la usa hoy, pero es la tarifa oficial para retener en nómina
 * semanal y queda cargada para poder cotejar contra ella. */
INSERT INTO nomina_tarifa_isr
  (anio, periodicidad, renglon, limite_inferior, limite_superior, cuota_fija, porcentaje)
VALUES
  (2026,'SEMANAL', 1,     0.01,    194.46,     0.00,  1.92),
  (2026,'SEMANAL', 2,   194.47,   1650.67,     3.71,  6.40),
  (2026,'SEMANAL', 3,  1650.68,   2900.87,    96.95, 10.88),
  (2026,'SEMANAL', 4,  2900.88,   3372.11,   232.96, 16.00),
  (2026,'SEMANAL', 5,  3372.12,   4037.32,   308.35, 17.92),
  (2026,'SEMANAL', 6,  4037.33,   8142.75,   427.56, 21.36),
  (2026,'SEMANAL', 7,  8142.76,  12834.08,  1304.45, 23.52),
  (2026,'SEMANAL', 8, 12834.09,  24502.45,  2407.86, 30.00),
  (2026,'SEMANAL', 9, 24502.46,  32669.91,  5908.35, 32.00),
  (2026,'SEMANAL',10, 32669.92,  98009.66,  8521.94, 34.00),
  (2026,'SEMANAL',11, 98009.67,      NULL, 30737.49, 35.00);

/* Quincenal — apartado B, fracción IV (pagos por periodo de 15 días). */
INSERT INTO nomina_tarifa_isr
  (anio, periodicidad, renglon, limite_inferior, limite_superior, cuota_fija, porcentaje)
VALUES
  (2026,'QUINCENAL', 1,      0.01,    416.70,     0.00,  1.92),
  (2026,'QUINCENAL', 2,    416.71,   3537.15,     7.95,  6.40),
  (2026,'QUINCENAL', 3,   3537.16,   6216.15,   207.75, 10.88),
  (2026,'QUINCENAL', 4,   6216.16,   7225.95,   499.20, 16.00),
  (2026,'QUINCENAL', 5,   7225.96,   8651.40,   660.75, 17.92),
  (2026,'QUINCENAL', 6,   8651.41,  17448.75,   916.20, 21.36),
  (2026,'QUINCENAL', 7,  17448.76,  27501.60,  2795.25, 23.52),
  (2026,'QUINCENAL', 8,  27501.61,  52505.25,  5159.70, 30.00),
  (2026,'QUINCENAL', 9,  52505.26,  70006.95, 12660.75, 32.00),
  (2026,'QUINCENAL',10,  70006.96, 210020.70, 18261.30, 34.00),
  (2026,'QUINCENAL',11, 210020.71,      NULL, 65866.05, 35.00);


/* ── Subsidio al empleo — DECRETO DOF 31/12/2025 ─────────────────────── */

DELETE FROM nomina_subsidio WHERE anio = 2026;

/* Enero: transitorio segundo — 15.59% de la UMA mensual VIGENTE EN 2025
 * (113.14 × 30.4 = 3,439.46), porque la UMA se actualiza hasta febrero.
 *   3,439.46 × 15.59% = 536.21 */
INSERT INTO nomina_subsidio
  (anio, periodicidad, renglon, limite_inferior, limite_superior, subsidio,
   porcentaje_uma, vigente_desde, vigente_hasta)
VALUES
  (2026,'MENSUAL', 1, 0.01, 11492.66, 536.21, 15.5900, '2026-01-01', '2026-01-31');

/* Febrero a diciembre: 15.02% de la UMA mensual de 2026 (3,566.22).
 *   3,566.22 × 15.02% = 535.65
 *
 * OJO CON ESTE NÚMERO. Los considerandos del decreto dicen "equivale a $536.22
 * mensuales", pero se publicaron el 31 de diciembre, antes de que el INEGI diera
 * la UMA de 2026 el 9 de enero: ese 536.22 sale de una UMA estimada de 117.43 y
 * la real quedó en 117.31. Lo que obliga el ARTÍCULO es el porcentaje —"la
 * cantidad que resulte de multiplicar el valor mensual de la UMA por 15.02%"—,
 * no la cifra de la exposición de motivos, así que aquí se guarda el resultado
 * real. Son 57 centavos al mes por trabajador; si el despacho prefiere el
 * 536.22, se cambia con un UPDATE de esta sola fila. */
INSERT INTO nomina_subsidio
  (anio, periodicidad, renglon, limite_inferior, limite_superior, subsidio,
   porcentaje_uma, vigente_desde, vigente_hasta)
VALUES
  (2026,'MENSUAL', 2, 0.01, 11492.66, 535.65, 15.0200, '2026-02-01', NULL);


/* ── UMA y salarios mínimos ──────────────────────────────────────────── */

/* La UMA que queda es la de 2026 (vigente desde el 1 de febrero), que es la
 * que aplica once de los doce meses. En enero seguía la de 2025 —113.14
 * diaria, 3,439.46 mensual—: si algún día hay que recalcular un finiquito de
 * enero, las exenciones del Art. 93 saldrían con la UMA de más. El subsidio sí
 * distingue enero porque el decreto lo manda expresamente. */
UPDATE nomina_ejercicios
   SET uma_diaria   = 117.31,
       uma_mensual  = 3566.22,
       smg_general  = 315.04,
       smg_frontera = 440.87,
       fuente =
         'Cotejado contra el DOF. Tarifas Art. 96 LISR: Anexo 8 RMF 2026, DOF 28/12/2025, '
         'apartado B fracciones II, IV y V (factor de actualización 1.1321). '
         'Subsidio al empleo: DECRETO DOF 31/12/2025 — 15.02% de la UMA mensual, '
         'tope de ingresos $11,492.66; transitorio segundo: 15.59% durante enero. '
         'UMA: INEGI, DOF 09/01/2026, vigente desde el 01/02/2026 — $117.31 diaria, '
         '$3,566.22 mensual, $42,794.64 anual (en enero regía la de 2025, $113.14). '
         'Salarios mínimos: CONASAMI, vigentes desde el 01/01/2026 — general $315.04 '
         '(+13%), Zona Libre de la Frontera Norte $440.87 (+5%).',
       confirmado    = true,
       confirmado_at = NOW(),
       updated_at    = NOW()
 WHERE anio = 2026;
