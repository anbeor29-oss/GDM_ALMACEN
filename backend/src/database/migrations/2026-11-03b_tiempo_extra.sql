-- Checador · Tiempo extraordinario — ETAPA 2/3 (motor de detección + cálculo + ISR).
--
-- Dos tablas:
--  1) nomina_te_parametros — parámetros LEGALES del tiempo extra POR EJERCICIO (no
--     se hardcodean: la reforma de jornada 2026 sube el tope semanal de TE por año,
--     y la tarifa doble/triple depende del límite vigente). El usuario los COTEJA
--     contra el DOF en Nómina → Parámetros.
--  2) nomina_tiempo_extra — un renglón por trabajador y día: minutos detectados,
--     autorizados y pagables, su clasificación doble/triple e importe, la parte
--     exenta/gravada de ISR y el estatus del flujo. Idempotente por (empresa,
--     empleado, fecha): reprocesar no duplica.

CREATE TABLE IF NOT EXISTS nomina_te_parametros (
  anio                 INTEGER PRIMARY KEY,
  -- Máximo de horas extra por SEMANA permitido (régimen transitorio reforma 2026:
  -- 9 en 2026-2027, 10 en 2028, 11 en 2029, 12 en 2030). Es un tope de ALERTA; no
  -- descarta trabajo prestado.
  tope_horas_semana    NUMERIC(5,2) NOT NULL,
  -- Umbral doble→triple: las primeras N horas extra de la semana se pagan DOBLE y
  -- el excedente TRIPLE (LFT Art. 67/68; clásicamente 9).
  horas_dobles_semana  NUMERIC(5,2) NOT NULL DEFAULT 9,
  -- Máximo de horas extra por DÍA (Art. 66) para la alerta.
  tope_horas_dia       NUMERIC(5,2) NOT NULL DEFAULT 3,
  -- Horas de la jornada diaria para calcular el valor-hora (salario diario / jornada).
  horas_jornada_dia    NUMERIC(5,2) NOT NULL DEFAULT 8,
  fuente               TEXT,
  confirmado           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Semilla 2026–2030 con el régimen transitorio del decreto de reforma de jornada
-- (DOF 01/05/2026). confirmado = FALSE: el usuario DEBE validar contra el DOF antes
-- de confiar en producción (así lo pide el .md). Idempotente.
INSERT INTO nomina_te_parametros (anio, tope_horas_semana, horas_dobles_semana, tope_horas_dia, horas_jornada_dia, fuente, confirmado)
VALUES
  (2026, 9,  9, 3, 8, 'Transitorios reforma de jornada (por validar DOF)', FALSE),
  (2027, 9,  9, 3, 8, 'Transitorios reforma de jornada (por validar DOF)', FALSE),
  (2028, 10, 9, 4, 8, 'Transitorios reforma de jornada (por validar DOF)', FALSE),
  (2029, 11, 9, 4, 8, 'Transitorios reforma de jornada (por validar DOF)', FALSE),
  (2030, 12, 9, 4, 8, 'Transitorios reforma de jornada (por validar DOF)', FALSE)
ON CONFLICT (anio) DO NOTHING;

CREATE TABLE IF NOT EXISTS nomina_tiempo_extra (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  empleado_id         UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,
  periodo_id          UUID REFERENCES nomina_periodos(id) ON DELETE SET NULL,
  fecha               DATE NOT NULL,
  semana_iso          INTEGER,                       -- para el acumulado/tope semanal
  turno_id            UUID REFERENCES checador_turnos(id) ON DELETE SET NULL,
  -- Trazabilidad de la detección (nunca se altera la checada original).
  hora_salida_prog    TEXT,
  hora_salida_real    TEXT,
  tolerancia_min      INTEGER NOT NULL DEFAULT 0,
  -- Tres cantidades separadas (lo pide el .md): detectado / autorizado / pagable.
  minutos_detectados  INTEGER NOT NULL DEFAULT 0,
  minutos_autorizados INTEGER,                        -- NULL = aún sin autorizar
  minutos_pagables    INTEGER NOT NULL DEFAULT 0,
  -- Cálculo monetario (se llena en el paso de cálculo).
  valor_hora          NUMERIC(14,4) NOT NULL DEFAULT 0,
  horas_dobles        NUMERIC(6,2)  NOT NULL DEFAULT 0,
  importe_dobles      NUMERIC(14,2) NOT NULL DEFAULT 0,
  horas_triples       NUMERIC(6,2)  NOT NULL DEFAULT 0,
  importe_triples     NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_bruto         NUMERIC(14,2) NOT NULL DEFAULT 0,
  exento_isr          NUMERIC(14,2) NOT NULL DEFAULT 0,
  gravado_isr         NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Flujo: DETECTADO → AUTORIZADO/RECHAZADO → ENVIADO (a nómina) → PAGADO/CANCELADO.
  estatus             TEXT NOT NULL DEFAULT 'DETECTADO',
  autorizado_por      UUID REFERENCES users(id) ON DELETE SET NULL,
  motivo              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, empleado_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_te_periodo ON nomina_tiempo_extra(company_id, periodo_id);
CREATE INDEX IF NOT EXISTS idx_te_empleado ON nomina_tiempo_extra(company_id, empleado_id, fecha);
