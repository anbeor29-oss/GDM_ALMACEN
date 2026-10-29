-- Nómina — PTU (Participación de los Trabajadores en las Utilidades), LFT 117-131.
-- El periodo de PTU es un ESPECIAL (como el aguinaldo), pero su cálculo es propio:
-- se reparte una cantidad entre los trabajadores con derecho, 50% por DÍAS TRABAJADOS
-- en el año y 50% por SALARIOS DEVENGADOS (Art. 123 LFT). No paga sueldo base, por eso
-- NO se corre por la prenómina normal. Se guarda la cantidad a repartir y, por
-- trabajador, los días/salario (auto pero editables) y si tiene derecho.

-- Marca el tipo del especial (PTU / AGUINALDO / …) para enrutar su pantalla.
ALTER TABLE nomina_periodos ADD COLUMN IF NOT EXISTS especial_clave TEXT;

-- Config del reparto por periodo de PTU.
CREATE TABLE IF NOT EXISTS nomina_ptu (
  periodo_id        UUID PRIMARY KEY REFERENCES nomina_periodos(id) ON DELETE CASCADE,
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cantidad_repartir NUMERIC(16,2) NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ajustes por trabajador (días del año y salario diario): auto al inicio, editables.
CREATE TABLE IF NOT EXISTS nomina_ptu_detalle (
  periodo_id      UUID NOT NULL REFERENCES nomina_periodos(id) ON DELETE CASCADE,
  empleado_id     UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  dias_trabajados NUMERIC(6,2),      -- NULL = usa el automático (por fechas del rango)
  salario_diario  NUMERIC(14,2),     -- NULL = usa el del expediente
  con_derecho     BOOLEAN,           -- NULL = automático (con derecho salvo < 60 días); true/false = elección manual
  PRIMARY KEY (periodo_id, empleado_id)
);
