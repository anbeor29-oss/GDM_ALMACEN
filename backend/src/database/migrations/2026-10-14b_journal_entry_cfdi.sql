-- ============================================================================
-- CFDI asociados a una póliza (varios por póliza, sin pérdida)
--
-- Al migrar pólizas (p. ej. de Contalink/CTLK) una sola póliza puede traer VARIOS
-- CFDI relacionados (un cobro del día que salda 5 facturas). journal_lines.uuid_cfdi
-- solo liga UNO por renglón, así que para no perder los demás se guardan todos aquí.
-- Cuando la póliza trae un único CFDI, además se sella en los renglones para que la
-- vista «asiento por UUID» siga encontrándola desde la bóveda del SAT.
-- ============================================================================
CREATE TABLE IF NOT EXISTS journal_entry_cfdi (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id          UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  uuid              VARCHAR(40) NOT NULL,
  rfc               VARCHAR(13),
  tipo_comprobante  VARCHAR(8),          -- Ingreso | Egreso | Pago | ...
  documento         VARCHAR(60),         -- folio/serie que trae el origen, informativo
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Un mismo CFDI no se liga dos veces a la misma póliza (reimportar no duplica).
CREATE UNIQUE INDEX IF NOT EXISTS ux_jec_entry_uuid ON journal_entry_cfdi (entry_id, uuid);
CREATE INDEX IF NOT EXISTS ix_jec_company_uuid ON journal_entry_cfdi (company_id, uuid);
