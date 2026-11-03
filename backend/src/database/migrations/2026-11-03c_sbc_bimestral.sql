-- Checador/IMSS · ETAPA 4 — Salario variable / SBC bimestral.
--
-- La integración del SBC (LSS Art. 27) depende del CONCEPTO de percepción, con
-- límites y matices que NO se hardcodean: se guardan en una tabla CONFIGURABLE
-- que el usuario/contador valida. Aquí sólo un «integra SÍ/NO» por c_TipoPercepcion
-- del Anexo 20 (los límites finos —ahorro, despensa, alimentación/habitación— se
-- afinan en una etapa posterior; por eso cada renglón lleva nota).
--
-- Semilla con un criterio inicial del Art. 27 (INTEGRA = parte VARIABLE que suma al
-- SBC; EXCLUIDO = lo que no, o lo que va en el componente FIJO vía factor de
-- integración). confirmado=FALSE hasta que el usuario lo valide.

CREATE TABLE IF NOT EXISTS nomina_sbc_integracion (
  clave       TEXT PRIMARY KEY,          -- c_TipoPercepcion (Anexo 20)
  nombre      TEXT NOT NULL,
  integra     BOOLEAN NOT NULL,          -- ¿integra la parte VARIABLE del SBC?
  nota        TEXT,
  confirmado  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO nomina_sbc_integracion (clave, nombre, integra, nota) VALUES
  -- Variables que integran (criterio Art. 27, validar):
  ('012', 'Gratificaciones / bonos',      TRUE,  'Percepción variable integrable.'),
  ('046', 'Comisiones',                   TRUE,  'Percepción variable integrable.'),
  ('020', 'Prima dominical',              TRUE,  'Integrable (la parte pagada).'),
  ('010', 'Premios de puntualidad',       TRUE,  'Integra el EXCEDENTE del 10% del SBC (Art. 27-VIII).'),
  ('049', 'Premios de asistencia',        TRUE,  'Integra el EXCEDENTE del 10% del SBC (Art. 27-VIII).'),
  ('019', 'Horas extra',                  TRUE,  'Integra SÓLO el EXCEDENTE de los márgenes LFT (Art. 27-IX). Afinar.'),
  ('039', 'Otros ingresos gravados',      TRUE,  'Integrable salvo que la ley lo excluya.'),
  -- Excluidos / fijos (no integran la parte variable):
  ('003', 'PTU',                          FALSE, 'Excluido del SBC (Art. 27-II).'),
  ('002', 'Aguinaldo',                    FALSE, 'Va en el componente FIJO (factor de integración), no variable.'),
  ('021', 'Prima vacacional',             FALSE, 'Va en el componente FIJO (factor de integración), no variable.'),
  ('050', 'Viáticos comprobados',         FALSE, 'Instrumentos de trabajo / comprobados: excluido.'),
  ('029', 'Subsidio por incapacidad',     FALSE, 'Excluido.'),
  ('014', 'Cuotas sindicales (patrón)',   FALSE, 'Excluido.'),
  ('024', 'Seguro de retiro / vida',      FALSE, 'Excluido.'),
  ('028', 'Gastos médicos mayores',       FALSE, 'Excluido.'),
  ('006', 'Caja / fondo de ahorro',       FALSE, 'Excluido DENTRO del límite (Art. 27-I). Afinar excedente.'),
  ('015', 'Vales de despensa',            FALSE, 'Excluido DENTRO del 40% UMA (Art. 27-VI). Afinar excedente.'),
  ('047', 'Alimentación',                 FALSE, 'Excluido si el trabajador paga ≥20% UMA (Art. 27-V/VI). Afinar.'),
  ('048', 'Habitación',                   FALSE, 'Excluido si el trabajador paga ≥20% UMA. Afinar.')
ON CONFLICT (clave) DO NOTHING;

-- Bitácora de cálculos de SBC bimestral (para revisión/autorización antes de IDSE).
CREATE TABLE IF NOT EXISTS nomina_sbc_calculo (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  empleado_id     UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,
  anio            INTEGER NOT NULL,
  bimestre        INTEGER NOT NULL,                -- 1..6 (el ANALIZADO, inmediato anterior)
  dias_devengados INTEGER NOT NULL DEFAULT 0,
  variable_integrable NUMERIC(14,2) NOT NULL DEFAULT 0,
  promedio_variable   NUMERIC(14,4) NOT NULL DEFAULT 0,
  sdi_fijo        NUMERIC(14,4) NOT NULL DEFAULT 0,
  sbc_anterior    NUMERIC(14,4) NOT NULL DEFAULT 0,
  sbc_propuesto   NUMERIC(14,4) NOT NULL DEFAULT 0,
  fecha_aplicacion DATE,
  fecha_limite     DATE,
  estatus         TEXT NOT NULL DEFAULT 'POR_REVISAR',   -- POR_REVISAR/AUTORIZADO/APLICADO/RECHAZADO
  autorizado_por  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, empleado_id, anio, bimestre)
);
