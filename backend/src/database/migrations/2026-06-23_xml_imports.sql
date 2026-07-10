-- Auditoría e idempotencia de imports de XML CFDI.
--
--  · Dedup por SHA-256 del contenido — el mismo archivo subido 2 veces NO duplica.
--  · UUID del CFDI también indexado para detectar "mismo CFDI, archivo diferente"
--    (por ejemplo si el usuario lo descargó dos veces del SAT con el mismo UUID).
--  · Guarda métricas de qué se creó (cuántos clientes / productos / nada).

CREATE TABLE IF NOT EXISTS xml_imports (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email        VARCHAR(255),
  ts                TIMESTAMP NOT NULL DEFAULT NOW(),
  -- Contenido del XML
  sha256            CHAR(64)  NOT NULL,
  cfdi_uuid         VARCHAR(36),
  emisor_rfc        VARCHAR(13),
  emisor_nombre     VARCHAR(255),
  receptor_rfc      VARCHAR(13),
  receptor_nombre   VARCHAR(255),
  fecha_emision     TIMESTAMP,
  total             NUMERIC(15, 2),
  -- Qué se creó al confirmar
  created_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_product_ids UUID[],
  status            VARCHAR(16) NOT NULL DEFAULT 'PREVIEW',
                    -- PREVIEW = solo se parseó | COMMITTED = se persistió | SKIPPED = duplicado
  notes             TEXT,
  -- Para detectar mismo archivo subido 2 veces por la misma empresa
  CONSTRAINT uq_xml_imports_sha_per_company UNIQUE (company_id, sha256)
);

CREATE INDEX IF NOT EXISTS idx_xml_imports_ts          ON xml_imports(ts DESC);
CREATE INDEX IF NOT EXISTS idx_xml_imports_cfdi_uuid   ON xml_imports(cfdi_uuid);
CREATE INDEX IF NOT EXISTS idx_xml_imports_company     ON xml_imports(company_id);

COMMENT ON TABLE xml_imports IS 'Bitácora de imports de XML — habilita dedup e historial fiscal';
