-- ============================================================================
-- CONTRATO DE PRESTACIÓN DE SERVICIOS — aceptación de T&C firmada con e.firma
--
-- Grupo HCGM, S.A. de C.V. presta el servicio de facturación bajo un contrato
-- anclado en los Términos y Condiciones. El contratante lo firma con SU e.firma
-- (FIEL), igual que el manifiesto del PAC: misma validación de RFC, vigencia y
-- correspondencia .cer/.key, y la .key NUNCA se persiste.
--
-- Por qué se guarda el texto ÍNTEGRO y su hash, y no solo un "acepté":
--   · El texto de los T&C cambia con el tiempo. Guardar solo la versión dejaría
--     la duda de QUÉ decía el documento el día que se firmó.
--   · La firma es sobre el texto exacto; si el texto no se conserva, la firma
--     no se puede verificar después y no vale como prueba.
--   · contract_sha256 permite detectar cualquier alteración posterior.
--
-- Se permite historial (sin UNIQUE por empresa): cuando cambian los T&C, se
-- firma una versión nueva y la anterior se conserva. El vigente es el más
-- reciente por empresa.
-- ============================================================================

CREATE TABLE IF NOT EXISTS service_contracts (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    -- Documento firmado
    version          VARCHAR(16)  NOT NULL,        -- versión de los T&C aceptados
    contract_text    TEXT         NOT NULL,        -- texto íntegro que se firmó
    contract_sha256  VARCHAR(64)  NOT NULL,        -- hash del texto (anti-alteración)

    -- Quién firmó (extraído del certificado, no del formulario)
    signer_rfc       VARCHAR(13)  NOT NULL,
    signer_name      VARCHAR(255),
    cert_serial      VARCHAR(64),
    cert_valid_from  TIMESTAMP,
    cert_valid_to    TIMESTAMP,

    -- Prueba criptográfica
    signature_b64    TEXT         NOT NULL,        -- firma RSA-SHA256 en base64
    signed_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
    signed_by_user   UUID REFERENCES users(id),

    -- Evidencia de la aceptación
    ip               VARCHAR(64),
    user_agent       VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_service_contracts_company
    ON service_contracts(company_id, signed_at DESC);
