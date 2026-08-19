/*
 * Las cuotas patronales del IMSS, para poder provisionarlas.
 *
 * PARA QUÉ
 * Contabilidad necesita saber cuánto va a costar la nómina ADEMÁS de lo que se
 * le paga al trabajador. La cuota obrera se retiene —sale del sueldo—, pero la
 * patronal es dinero de la empresa que hay que reservar cada periodo.
 *
 * POR QUÉ EN UNA TABLA Y NO EN EL CÓDIGO
 * La cuota de Cesantía y Vejez del patrón NO es una tasa: es una escala por
 * rango de salario que sube cada año desde 2023 y hasta 2030, por la reforma de
 * pensiones de 2020. Ponerla en el código obligaría a un despliegue cada enero,
 * y el enero que se olvide provisionaría de menos sin avisar. Aquí se captura y
 * se coteja igual que la tarifa del ISR.
 *
 * LAS RAMAS Y SUS ARTÍCULOS
 *   · Enfermedad y maternidad, cuota fija    Art. 106 Fr. I   — % de la UMA
 *   · Enfermedad, excedente de 3 UMA         Art. 106 Fr. II
 *   · Prestaciones en dinero                 Art. 107
 *   · Gastos médicos de pensionados          Art. 25
 *   · Invalidez y vida                       Art. 147
 *   · Guarderías y prestaciones sociales     Art. 211
 *   · Retiro                                 Art. 168 Fr. I
 *   · Cesantía y vejez                       Art. 168 Fr. II  — la escala
 *   · Riesgos de trabajo                     Art. 71-73       — prima de CADA
 *                                                               empresa, ya está
 *                                                               en companies
 *   · INFONAVIT                              Art. 29 Fr. II Ley INFONAVIT
 */

CREATE TABLE IF NOT EXISTS nomina_cuotas_imss (
  anio            INTEGER PRIMARY KEY,

  /* Cuota fija de enfermedad y maternidad: porcentaje de la UMA por día
   * cotizado. No depende del salario del trabajador. */
  em_cuota_fija_pct        NUMERIC(7,4) NOT NULL,

  /* Excedente sobre tres UMA — sólo aplica a lo que pase de ese tope. */
  em_excedente_patron_pct  NUMERIC(7,4) NOT NULL,
  em_excedente_obrero_pct  NUMERIC(7,4) NOT NULL,

  em_dinero_patron_pct     NUMERIC(7,4) NOT NULL,
  em_dinero_obrero_pct     NUMERIC(7,4) NOT NULL,

  em_pensionados_patron_pct NUMERIC(7,4) NOT NULL,
  em_pensionados_obrero_pct NUMERIC(7,4) NOT NULL,

  iv_patron_pct            NUMERIC(7,4) NOT NULL,
  iv_obrero_pct            NUMERIC(7,4) NOT NULL,

  guarderias_pct           NUMERIC(7,4) NOT NULL,
  retiro_pct               NUMERIC(7,4) NOT NULL,

  /* Cesantía y vejez: la del obrero es fija; la del patrón sale de la escala. */
  cv_obrero_pct            NUMERIC(7,4) NOT NULL,

  infonavit_pct            NUMERIC(7,4) NOT NULL,

  fuente        TEXT,
  confirmado    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/*
 * La escala de Cesantía y Vejez del PATRÓN.
 *
 * Cada renglón es un rango de salario base de cotización expresado en veces la
 * UMA. El primero es el salario mínimo, que conserva la tasa base y no sube.
 */
CREATE TABLE IF NOT EXISTS nomina_cuotas_cv_patron (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anio          INTEGER NOT NULL REFERENCES nomina_cuotas_imss(anio) ON DELETE CASCADE,
  renglon       INTEGER NOT NULL,
  /* En VECES la UMA. El límite superior nulo es el último renglón. */
  desde_uma     NUMERIC(7,2) NOT NULL,
  hasta_uma     NUMERIC(7,2),
  /* true en el renglón del salario mínimo, que no se mide en UMA. */
  es_minimo     BOOLEAN NOT NULL DEFAULT FALSE,
  patron_pct    NUMERIC(7,4) NOT NULL,

  CONSTRAINT nomina_cuotas_cv_rango_ck CHECK (hasta_uma IS NULL OR hasta_uma >= desde_uma)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nomina_cuotas_cv
  ON nomina_cuotas_cv_patron (anio, renglon);


/* ── 2026 ────────────────────────────────────────────────────────────
 * Tasas del Título Segundo de la LSS, que no han cambiado desde 1997, y la
 * escala de CV del Artículo Décimo Noveno Transitorio de la reforma de 2020,
 * en su CUARTO escalón (2026). El obrero se queda en 1.125% todo el camino. */

INSERT INTO nomina_cuotas_imss (
  anio,
  em_cuota_fija_pct, em_excedente_patron_pct, em_excedente_obrero_pct,
  em_dinero_patron_pct, em_dinero_obrero_pct,
  em_pensionados_patron_pct, em_pensionados_obrero_pct,
  iv_patron_pct, iv_obrero_pct,
  guarderias_pct, retiro_pct, cv_obrero_pct, infonavit_pct,
  fuente, confirmado
) VALUES (
  2026,
  20.40,  1.10, 0.40,
   0.70,  0.25,
   1.05,  0.375,
   1.75,  0.625,
   1.00,  2.00, 1.125, 5.00,
  'Ley del Seguro Social: Art. 106 Fr. I y II, 107, 25, 147, 211 y 168 Fr. I y II. '
  'INFONAVIT: Art. 29 Fr. II de su Ley. La escala de Cesantía y Vejez del patrón '
  'viene del Artículo Décimo Noveno Transitorio de la reforma de 2020 (DOF 16/12/2020), '
  'cuarto escalón — 2026: de 3.150% en el salario mínimo a 7.513% arriba de 4 UMA. '
  'Sube cada año hasta 11.875% en 2030.',
  TRUE
) ON CONFLICT (anio) DO NOTHING;

DELETE FROM nomina_cuotas_cv_patron WHERE anio = 2026;

INSERT INTO nomina_cuotas_cv_patron (anio, renglon, desde_uma, hasta_uma, es_minimo, patron_pct)
VALUES
  (2026, 1, 0.00, NULL, TRUE,  3.1500),   -- salario mínimo: no sube
  (2026, 2, 1.01, 1.50, FALSE, 3.6760),
  (2026, 3, 1.51, 2.00, FALSE, 4.8510),
  (2026, 4, 2.01, 2.50, FALSE, 5.5560),
  (2026, 5, 2.51, 3.00, FALSE, 6.0260),
  (2026, 6, 3.01, 3.50, FALSE, 6.3610),
  (2026, 7, 3.51, 4.00, FALSE, 6.6130),
  (2026, 8, 4.01, NULL, FALSE, 7.5130);

COMMENT ON TABLE nomina_cuotas_imss IS
  'Las tasas del IMSS por ejercicio. Se capturan y se cotejan como la tarifa '
  'del ISR: cambian por ley y no deben vivir en el código.';
COMMENT ON TABLE nomina_cuotas_cv_patron IS
  'La escala de Cesantía y Vejez del PATRÓN por rango de SBC en UMA. Sube cada '
  'año desde 2023 hasta 2030 por la reforma de pensiones de 2020.';
