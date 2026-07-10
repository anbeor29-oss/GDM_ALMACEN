-- ============================================================================
-- CREDIT_NOTES — Notas de Crédito (CFDI tipo E — Egreso)
--
-- Esta tabla debió estar en schema.sql desde el inicio, pero se creó
-- manualmente en dev. La agrego como migración para que Render y cualquier
-- ambiente nuevo la tengan disponible.
--
-- Idempotente: usa IF NOT EXISTS en todo. Puede correrse N veces.
-- ============================================================================

CREATE TABLE IF NOT EXISTS credit_notes (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id     UUID REFERENCES companies(id) ON DELETE CASCADE,
    customer_id    UUID REFERENCES customers(id),
    invoice_id     UUID REFERENCES invoices(id),
    folio          INTEGER NOT NULL,
    serie          VARCHAR(25) DEFAULT 'NC',
    tipo_relacion  VARCHAR(2)  DEFAULT '01',      -- c_TipoRelacion SAT
    motivo         TEXT,
    subtotal       NUMERIC(15,2) NOT NULL DEFAULT 0,
    iva            NUMERIC(15,2) NOT NULL DEFAULT 0,
    total          NUMERIC(15,2) NOT NULL DEFAULT 0,
    currency       VARCHAR(3) DEFAULT 'MXN',
    date_issued    TIMESTAMP DEFAULT NOW(),
    status         VARCHAR(20) DEFAULT 'DRAFT',   -- DRAFT | STAMPED | CANCELLED
    xml_content    TEXT,
    uuid           VARCHAR(36),                    -- Folio Fiscal SAT
    pac_timestamp  TIMESTAMP,
    notes          TEXT,
    created_at     TIMESTAMP DEFAULT NOW(),
    updated_at     TIMESTAMP DEFAULT NOW(),
    deleted_at     TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cn_company  ON credit_notes (company_id);
CREATE INDEX IF NOT EXISTS idx_cn_customer ON credit_notes (customer_id);
CREATE INDEX IF NOT EXISTS idx_cn_invoice  ON credit_notes (invoice_id);

COMMENT ON TABLE  credit_notes       IS 'CFDI tipo E — Egreso (Notas de Crédito). Anexo 20 §4.2.';
COMMENT ON COLUMN credit_notes.tipo_relacion IS 'c_TipoRelacion SAT: 01=Nota de crédito, 02=Nota de débito, etc.';
COMMENT ON COLUMN credit_notes.motivo        IS 'Descripción libre de la razón de la NC — obligatorio SAT.';
