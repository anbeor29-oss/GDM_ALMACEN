-- ============================================================================
-- MOTOR INTELIGENTE DE CODIFICACIÓN POR RFC (spec E:\Banco\GDM_NEXO_Motor_Inteligente_Codificacion_RFC.md)
--
-- Memoria contable AISLADA por empresa (company_id = el RFC dueño de la memoria).
-- El motor LEE la historia (pólizas importadas/generadas + sus XML) y aprende qué
-- cuenta usa cada empresa por proveedor/concepto. NUNCA modifica pólizas: sólo
-- guarda patrones, reglas, decisiones y auditoría.
--
--   cod_patrones        evidencia estadística (se RECONSTRUYE al «Aprender»)
--   cod_reglas          reglas gobernadas por el usuario (propuesta→aprobada…), con versiones
--   cfdi_concepto_cuenta  codificación decidida factura por factura / concepto por concepto
--   cod_auditoria       bitácora de cada acción del motor y del usuario
-- ============================================================================

CREATE TABLE IF NOT EXISTS cod_patrones (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  direccion      VARCHAR(10) NOT NULL DEFAULT 'compras',     -- compras | ventas
  nivel          VARCHAR(12) NOT NULL,                       -- RFC_CLAVE | RFC_DESC | RFC | CLAVE
  rfc            VARCHAR(13) NOT NULL DEFAULT '',            -- contraparte ('' en nivel CLAVE)
  nombre         VARCHAR(300),
  clave          VARCHAR(20)  NOT NULL DEFAULT '',           -- ClaveProdServ ('' en nivel RFC)
  descripcion    VARCHAR(300) NOT NULL DEFAULT '',           -- descripción normalizada (RFC_DESC)
  cuenta_top     VARCHAR(40),
  muestras       INTEGER NOT NULL DEFAULT 0,                 -- conceptos observados
  consistencia   NUMERIC(6,4) NOT NULL DEFAULT 0,            -- muestras de la cuenta top / muestras
  distribucion   JSONB NOT NULL DEFAULT '[]'::jsonb,         -- [{cuenta, n, primera, ultima}]
  ejemplos       JSONB NOT NULL DEFAULT '[]'::jsonb,         -- [{entry_id, uuid, fecha, cuenta, fuente}]
  primera        DATE,
  ultima         DATE,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_cod_patrones_key
  ON cod_patrones (company_id, direccion, nivel, rfc, clave);

CREATE TABLE IF NOT EXISTS cod_reglas (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  direccion      VARCHAR(10) NOT NULL DEFAULT 'compras',
  rfc            VARCHAR(13) NOT NULL DEFAULT '',            -- '' = cualquier contraparte
  nombre         VARCHAR(300),
  clave          VARCHAR(20) NOT NULL DEFAULT '',            -- '' = cualquier producto del RFC
  cuenta_codigo  VARCHAR(40) NOT NULL,
  estado         VARCHAR(12) NOT NULL DEFAULT 'PROPUESTA'
                 CHECK (estado IN ('PROPUESTA','APROBADA','RECHAZADA','SUSPENDIDA','SUSTITUIDA')),
  origen         VARCHAR(12) NOT NULL DEFAULT 'HISTORIA'      -- HISTORIA | USUARIO
                 CHECK (origen IN ('HISTORIA','USUARIO')),
  muestras       INTEGER NOT NULL DEFAULT 0,
  consistencia   NUMERIC(6,4),
  primera        DATE,
  ultima         DATE,
  evidencia      JSONB NOT NULL DEFAULT '[]'::jsonb,
  version        INTEGER NOT NULL DEFAULT 1,
  sustituye_id   UUID REFERENCES cod_reglas(id) ON DELETE SET NULL,
  motivo         TEXT,
  aprobado_por   UUID REFERENCES users(id) ON DELETE SET NULL,
  aprobado_at    TIMESTAMP,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
-- Sólo UNA regla viva (propuesta/aprobada/suspendida) por llave; las demás quedan como historia.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cod_reglas_viva
  ON cod_reglas (company_id, direccion, rfc, clave)
  WHERE estado IN ('PROPUESTA','APROBADA','SUSPENDIDA');

CREATE TABLE IF NOT EXISTS cfdi_concepto_cuenta (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  uuid           VARCHAR(40) NOT NULL,
  idx            INTEGER NOT NULL,                           -- posición del concepto en el XML (0..n)
  clave          VARCHAR(20),
  descripcion    VARCHAR(300),
  importe        NUMERIC(18,2),
  cuenta_codigo  VARCHAR(40) NOT NULL,
  fuente         VARCHAR(20) NOT NULL DEFAULT 'USUARIO',     -- USUARIO | SUGERENCIA
  regla_id       UUID REFERENCES cod_reglas(id) ON DELETE SET NULL,
  confianza      VARCHAR(12),
  decidido_por   UUID REFERENCES users(id) ON DELETE SET NULL,
  decidido_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, uuid, idx)
);
CREATE INDEX IF NOT EXISTS ix_cfdi_concepto_cuenta_uuid ON cfdi_concepto_cuenta (company_id, uuid);

CREATE TABLE IF NOT EXISTS cod_auditoria (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  accion         VARCHAR(40) NOT NULL,      -- APRENDER | CODIFICAR | REGLA_APROBAR | REGLA_RECHAZAR | ...
  uuid           VARCHAR(40),
  regla_id       UUID,
  cuenta_sugerida VARCHAR(40),
  cuenta_final   VARCHAR(40),
  confianza      VARCHAR(12),
  motivo         TEXT,
  detalle        JSONB,
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_cod_auditoria_company ON cod_auditoria (company_id, created_at DESC);

-- El aprendizaje (y el candado anti-duplicidad del motor) buscan partidas por UUID.
CREATE INDEX IF NOT EXISTS ix_journal_lines_uuid_cfdi
  ON journal_lines (uuid_cfdi) WHERE uuid_cfdi IS NOT NULL;
