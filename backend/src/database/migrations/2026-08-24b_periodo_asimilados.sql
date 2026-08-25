-- Periodo especial de "Asimilados a salarios".
--
-- Marca un periodo especial cuyo cálculo cambia: al ingreso total se le aplica
-- la tarifa MENSUAL del ISR (Art. 96) y se retiene, SIN subsidio al empleo bajo
-- ninguna circunstancia y SIN cuotas del IMSS —el asimilado no tiene relación
-- laboral—. El resto de los periodos no se toca: la bandera es NULL/false.
ALTER TABLE nomina_periodos
  ADD COLUMN IF NOT EXISTS es_asimilados BOOLEAN NOT NULL DEFAULT false;
