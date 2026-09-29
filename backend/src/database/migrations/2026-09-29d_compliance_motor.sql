-- ============================================================================
-- MOTOR DE CUMPLIMIENTO — programación, bitácora de ejecuciones y evidencia.
--
-- Amplía el tracker existente (opinion_cumplimiento + cumplimiento_config) con
-- lo que necesita el MOTOR que obtiene las opiniones/constancias solo:
--   1) PROGRAMACIÓN por empresa+tipo (modo, día del mes o cada-N-días, próxima).
--      SAT (32-D/CSF) se refresca el día 1; IMSS el día 17 (lo indicado).
--   2) BITÁCORA de cada intento (compliance_execution), con su estado TÉCNICO
--      SIN secretos — nunca contraseñas/e.firma en la bitácora.
--   3) Liga de la EVIDENCIA a la ejecución que la produjo + hash SHA-256.
--
-- Las credenciales siguen CIFRADAS en cumplimiento_config (bóveda SAT_VAULT_KEY);
-- se CONSERVAN porque facturación y descarga de XML corren a diario (decisión de
-- negocio), y el motor las reusa — nunca se guardan en claro ni se registran.
-- ============================================================================

-- 1. Programación en la config existente.
ALTER TABLE cumplimiento_config ADD COLUMN IF NOT EXISTS modo VARCHAR(12) NOT NULL DEFAULT 'MANUAL'
  CHECK (modo IN ('MANUAL','AUTOMATICO','AMBOS'));
ALTER TABLE cumplimiento_config ADD COLUMN IF NOT EXISTS dia_mes INT;           -- disparo mensual (SAT=1, IMSS=17); NULL si usa frecuencia_dias
ALTER TABLE cumplimiento_config ADD COLUMN IF NOT EXISTS frecuencia_dias INT;   -- alternativa: cada N días
ALTER TABLE cumplimiento_config ADD COLUMN IF NOT EXISTS ultima_ejecucion TIMESTAMPTZ;
ALTER TABLE cumplimiento_config ADD COLUMN IF NOT EXISTS proxima_ejecucion TIMESTAMPTZ;
ALTER TABLE cumplimiento_config ADD COLUMN IF NOT EXISTS ultimo_estado VARCHAR(30);

-- 2. Bitácora de ejecuciones del motor.
CREATE TABLE IF NOT EXISTS compliance_execution (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tipo          VARCHAR(10) NOT NULL CHECK (tipo IN ('SAT','IMSS','INFONAVIT','CSF')),
  -- Quién lo disparó: a mano, el programador, o vía la API de servicio.
  disparo       VARCHAR(10) NOT NULL DEFAULT 'MANUAL' CHECK (disparo IN ('MANUAL','SCHEDULER','API')),
  metodo        VARCHAR(10),   -- PORTAL | API | EFIRMA (copia de la config al momento)
  -- Estado TÉCNICO del intento (distinto del SENTIDO fiscal de la opinión):
  estado        VARCHAR(24) NOT NULL DEFAULT 'STARTED'
                  CHECK (estado IN ('STARTED','SUCCESS','ERROR','TIMEOUT','BLOCKED',
                                    'REQUIRES_USER_ACTION','SKIPPED','NO_DISPONIBLE')),
  http_status   INT,
  mensaje       TEXT,          -- diagnóstico legible SIN secretos
  resultado_id  UUID REFERENCES opinion_cumplimiento(id) ON DELETE SET NULL,
  duracion_ms   INT,
  iniciado_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  terminado_at  TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_compliance_exec_empresa
  ON compliance_execution(company_id, tipo, iniciado_at DESC);

-- 3. Liga de la evidencia a su ejecución + hash de integridad + origen.
ALTER TABLE opinion_cumplimiento ADD COLUMN IF NOT EXISTS sha256 VARCHAR(64);
ALTER TABLE opinion_cumplimiento ADD COLUMN IF NOT EXISTS execution_id UUID REFERENCES compliance_execution(id) ON DELETE SET NULL;
ALTER TABLE opinion_cumplimiento ADD COLUMN IF NOT EXISTS origen VARCHAR(10) NOT NULL DEFAULT 'MANUAL'
  CHECK (origen IN ('MANUAL','MOTOR'));
