-- ============================================================================
-- CHECADOR — control de asistencia biométrico (Fase 0: bases)
--
-- Dos frentes con el MISMO backend:
--   · KIOSCO  — tablet fija; reconocimiento facial 1:N (sin login), en sitio.
--   · APP     — teléfono; para personal FUERA de la oficina (campo/comisión),
--               con hora + GPS y login del usuario (1:1).
--
-- POR QUÉ real[] Y NO pgvector
-- El match 1:N se hace contra los rostros de UNA empresa (decenas–cientos de
-- personas × 3 fotos). A esa escala, calcular la distancia en el backend es
-- instantáneo y NO exige la extensión pgvector (que obligaría a habilitarla en
-- Render). Si algún día son miles de rostros, se migra a vector como índice ANN.
--
-- TODO ES CONFIGURABLE (el usuario lo define, no el código)
-- Tolerancia de retardo (sólo horarios FIJOS), horario de comida, y sobre todo
-- las HORAS SEMANALES: 48 en 2026 por ley, que bajan a 40 escalonado desde 2027.
-- No se asume 48 en ningún cálculo: sale de checador_config.horas_semanales.
--
-- La asistencia NO reemplaza a la nómina: alimenta la PRENÓMINA (faltas/retardos
-- en checador_resumen_dia), que el motor de cálculo ya sabe procesar.
-- ============================================================================

-- 1. Config por empresa — los parámetros abiertos que define el usuario.
CREATE TABLE IF NOT EXISTS checador_config (
  company_id            UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  activo                BOOLEAN NOT NULL DEFAULT true,
  -- Tolerancia de retardo en minutos (sólo aplica a horarios FIJOS). NULL = sin
  -- gracia hasta que el usuario la defina.
  tolerancia_retardo_min INT,
  registra_comida       BOOLEAN NOT NULL DEFAULT false,
  -- Jornada máxima semanal vigente. 48 hoy (2026); se BAJA a 40 escalonado
  -- desde 2027 cambiando este valor, sin tocar código.
  horas_semanales       NUMERIC(4,1) NOT NULL DEFAULT 48,
  -- Radio permitido del KIOSCO (la tablet está fija en el centro). NO aplica a
  -- la app de campo: estar lejos de la oficina es válido (comisión), no se rechaza.
  radio_kiosco_m        INT NOT NULL DEFAULT 100,
  -- Umbral de coincidencia facial (distancia euclidiana de face-api ~0.6; menor = más estricto).
  umbral_distancia      REAL NOT NULL DEFAULT 0.6,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Turnos de la empresa (para horarios FIJOS: ej. matutino/vespertino/nocturno).
CREATE TABLE IF NOT EXISTS checador_turnos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  nombre        VARCHAR(80) NOT NULL,
  hora_entrada  TIME NOT NULL,
  comida_inicio TIME,               -- abierto: lo designa el usuario
  comida_fin    TIME,
  hora_salida   TIME NOT NULL,
  -- Días laborales del turno: 0=Dom … 6=Sáb. Se acepta trabajo en fines de semana.
  dias          INT[] NOT NULL DEFAULT '{1,2,3,4,5}',
  activo        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checador_turnos_empresa ON checador_turnos(company_id) WHERE activo;

-- 3. Horario del empleado — su TIPO y (si es FIJO) su turno base.
--    FIJO     = turno estable.
--    ROTATIVO = rola turnos → se asigna por fecha en checador_asignacion.
--    EXENTO   = personal de confianza (jefes/admin): NO registra, sin retardo/falta.
CREATE TABLE IF NOT EXISTS checador_empleado_horario (
  empleado_id        UUID PRIMARY KEY REFERENCES nomina_empleados(id) ON DELETE CASCADE,
  company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tipo               VARCHAR(12) NOT NULL DEFAULT 'FIJO'
                       CHECK (tipo IN ('FIJO','ROTATIVO','EXENTO')),
  turno_id           UUID REFERENCES checador_turnos(id) ON DELETE SET NULL,
  -- Override de tolerancia por persona (si NULL, usa checador_config).
  tolerancia_override INT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Asignación por fecha — el "rol" del rotativo, y el caso MIXTO (2 días oficina
--    + 3 de comisión): por día se dice qué turno y en qué modo se espera.
CREATE TABLE IF NOT EXISTS checador_asignacion (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,
  fecha       DATE NOT NULL,
  turno_id    UUID REFERENCES checador_turnos(id) ON DELETE SET NULL,
  modo        VARCHAR(10) NOT NULL DEFAULT 'OFICINA' CHECK (modo IN ('OFICINA','CAMPO')),
  UNIQUE (empleado_id, fecha)
);
CREATE INDEX IF NOT EXISTS idx_checador_asig_emp_fecha ON checador_asignacion(empleado_id, fecha);

-- 5. Rostros enrolados — las plantillas (embeddings) de cada persona (3 fotos).
--    Se guarda el DESCRIPTOR (arreglo de flotantes), no la foto cruda (LFPDPPP).
CREATE TABLE IF NOT EXISTS checador_rostro (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,
  descriptor  REAL[] NOT NULL,       -- embedding (face-api: 128 floats)
  dim         INT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checador_rostro_empresa ON checador_rostro(company_id);

-- 6. Eventos — cada checada (entrada/salida/comida). empleado_id NULL = no se
--    reconoció a nadie (queda para auditoría). NO se rechaza por estar lejos: se
--    registra el origen, la ubicación y el estado, y se clasifica.
CREATE TABLE IF NOT EXISTS checador_evento (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  empleado_id  UUID REFERENCES nomina_empleados(id) ON DELETE SET NULL,
  tipo         VARCHAR(20) NOT NULL
                 CHECK (tipo IN ('ENTRADA','SALIDA','COMIDA_INICIO','COMIDA_FIN')),
  ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  origen       VARCHAR(10) NOT NULL DEFAULT 'KIOSCO' CHECK (origen IN ('KIOSCO','APP')),
  lat          NUMERIC(10,7),
  lng          NUMERIC(10,7),
  distancia_m  NUMERIC(10,2),        -- metros al centro asignado (si aplica)
  confianza    REAL,                 -- 1 - distancia_facial (0..1), a mayor mejor
  estado       VARCHAR(16) NOT NULL DEFAULT 'A_TIEMPO'
                 CHECK (estado IN ('A_TIEMPO','RETARDO','TEMPRANO','FUERA_RANGO','NO_RECONOCIDO')),
  device       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checador_evento_emp_ts ON checador_evento(empleado_id, ts);
CREATE INDEX IF NOT EXISTS idx_checador_evento_empresa_ts ON checador_evento(company_id, ts);

-- 7. Resumen diario — lo que ALIMENTA la prenómina (faltas/retardos por día).
--    Lo puebla un job diario a partir de los eventos + el horario del empleado.
CREATE TABLE IF NOT EXISTS checador_resumen_dia (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  empleado_id           UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE CASCADE,
  fecha                 DATE NOT NULL,
  entrada               TIMESTAMPTZ,
  salida                TIMESTAMPTZ,
  comida_inicio         TIMESTAMPTZ,
  comida_fin            TIMESTAMPTZ,
  minutos_retardo       INT NOT NULL DEFAULT 0,
  minutos_salida_antes  INT NOT NULL DEFAULT 0,
  -- 'NINGUNA' | 'PARCIAL' | 'COMPLETA'
  tipo_ausencia         VARCHAR(10) NOT NULL DEFAULT 'NINGUNA'
                          CHECK (tipo_ausencia IN ('NINGUNA','PARCIAL','COMPLETA')),
  estado                VARCHAR(16) NOT NULL DEFAULT 'NORMAL'
                          CHECK (estado IN ('NORMAL','RETARDO','FALTA','SALIDA_ANTES','EXENTO','DESCANSO')),
  volcado_prenomina     BOOLEAN NOT NULL DEFAULT false,   -- ya se pasó a prenómina
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (empleado_id, fecha)
);
CREATE INDEX IF NOT EXISTS idx_checador_resumen_empresa_fecha ON checador_resumen_dia(company_id, fecha);

-- 8. Consentimiento biométrico (LFPDPPP) — quién aceptó y cómo.
CREATE TABLE IF NOT EXISTS checador_consentimiento (
  empleado_id UUID PRIMARY KEY REFERENCES nomina_empleados(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  aceptado    BOOLEAN NOT NULL DEFAULT false,
  fecha       DATE,
  metodo      VARCHAR(20) DEFAULT 'FIRMA_FISICA',  -- FIRMA_FISICA | EN_APP
  notas       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
