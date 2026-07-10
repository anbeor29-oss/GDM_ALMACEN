-- ============================================================================
-- MANIFIESTO SW — constancia de autorización del emisor al PAC
--
-- El SAT exige que cada contribuyente autorice expresamente a su proveedor
-- de certificación (PCCFDI). SW lo llama "manifiesto". Esta tabla guarda la
-- constancia firmada electrónicamente con la e.firma (FIEL) del contribuyente:
-- el texto íntegro, la firma RSA-SHA256 y los datos del certificado firmante.
--
-- Se permite historial (sin UNIQUE): el vigente es el más reciente por empresa.
-- La .key de la e.firma NUNCA se persiste — solo se usa en memoria al firmar.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sw_manifests (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    manifest_text    TEXT NOT NULL,           -- texto íntegro que se firmó
    signer_rfc       VARCHAR(13) NOT NULL,    -- RFC extraído del certificado
    signer_name      VARCHAR(255),            -- CN del certificado (nombre/razón)
    cert_serial      VARCHAR(64),             -- número de serie de la e.firma
    cert_valid_from  TIMESTAMP,
    cert_valid_to    TIMESTAMP,
    signature_b64    TEXT NOT NULL,           -- firma RSA-SHA256 en base64
    signed_at        TIMESTAMP NOT NULL DEFAULT NOW(),
    signed_by_user   UUID REFERENCES users(id),
    status           VARCHAR(16) NOT NULL DEFAULT 'SIGNED'
        CHECK (status IN ('SIGNED', 'SENT', 'ACCEPTED'))
);

CREATE INDEX IF NOT EXISTS idx_sw_manifests_company
  ON sw_manifests (company_id, signed_at DESC);

COMMENT ON TABLE sw_manifests IS
  'Constancias del manifiesto PAC firmadas con e.firma (FIEL) del emisor';
