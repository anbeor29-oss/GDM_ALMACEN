/*
 * INPC — Índice Nacional de Precios al Consumidor (INEGI), serie mensual.
 *
 * POR QUÉ AQUÍ Y NO EN nomina_ejercicios
 * La UMA, los salarios mínimos, la UMI y las tarifas del Art. 96 ya viven
 * versionadas por año en `nomina_ejercicios` / `nomina_tarifa_isr` /
 * `nomina_subsidio` (se editan en Nómina → Parámetros). El INPC es otra cosa:
 * es MENSUAL y es de la contabilidad/fiscal (actualización de contribuciones y
 * recargos, Art. 17-A CFF), no de la nómina. Por eso tiene su propia tabla.
 *
 * ES NACIONAL, NO POR EMPRESA
 * El índice lo publica el INEGI para todo el país; una sola serie la leen todas
 * las empresas de la plataforma. Se actualiza desde la API del Banco de
 * Indicadores del INEGI (requiere un token gratuito en INEGI_TOKEN).
 */
CREATE TABLE IF NOT EXISTS fiscal_inpc (
  anio       INT           NOT NULL,
  mes        INT           NOT NULL CHECK (mes BETWEEN 1 AND 12),
  valor      NUMERIC(14,6) NOT NULL,
  base       TEXT,          -- p. ej. '2Q Jul 2018 = 100'
  fuente     TEXT,          -- 'INEGI API' | 'Captura manual'
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (anio, mes)
);

COMMENT ON TABLE fiscal_inpc IS
  'Índice Nacional de Precios al Consumidor (INEGI), serie mensual, NACIONAL (no por empresa). '
  'Se alimenta de la API del Banco de Indicadores del INEGI.';
