/*
 * Tasa de recargos por MORA, por año (Art. 21 CFF / Art. 11 LIF).
 *
 * Es la tasa MENSUAL que se suma por cada mes o fracción de atraso al pagar una
 * contribución extemporánea. La fija la Ley de Ingresos de la Federación cada año
 * (la de mora = la de prórroga + 50%). Estuvo en 1.47% durante años y subió a
 * 2.07% en 2026 (base LIF 1.38% + 50%). Se guarda por año para que un cálculo que
 * cruce el cambio sume la tasa correcta de cada mes.
 *
 * Global (nacional), no por empresa. Se puede ajustar con un UPDATE si la LIF
 * cambia a media temporada.
 */
CREATE TABLE IF NOT EXISTS fiscal_tasa_recargos (
  anio       INT           NOT NULL PRIMARY KEY,
  tasa_mora  NUMERIC(6,4)  NOT NULL,   -- % mensual, p. ej. 2.0700
  fuente     TEXT,
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

INSERT INTO fiscal_tasa_recargos (anio, tasa_mora, fuente) VALUES
  (2018, 1.4700, 'LIF — recargos por mora'),
  (2019, 1.4700, 'LIF — recargos por mora'),
  (2020, 1.4700, 'LIF — recargos por mora'),
  (2021, 1.4700, 'LIF — recargos por mora'),
  (2022, 1.4700, 'LIF — recargos por mora'),
  (2023, 1.4700, 'LIF — recargos por mora'),
  (2024, 1.4700, 'LIF — recargos por mora'),
  (2025, 1.4700, 'LIF — recargos por mora'),
  (2026, 2.0700, 'LIF 2026 (base 1.38% + 50%)')
ON CONFLICT (anio) DO NOTHING;
