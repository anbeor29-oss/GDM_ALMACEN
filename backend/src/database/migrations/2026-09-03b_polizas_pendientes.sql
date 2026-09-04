-- Pólizas del respaldo que NO se pudieron importar (por la razón que sea).
--
-- Requisito del usuario: "que todas las pólizas se suban; las que no sepas por
-- qué no entran, déjalas pendientes en una pantalla, para no perder información".
-- Aquí se guarda la póliza CRUDA (sus movimientos incluidos) y el motivo, para
-- revisarla y reintentar. Cuando una entra bien en un re-import, se borra de aquí.

CREATE TABLE IF NOT EXISTS contpaqi_polizas_pendientes (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  guid       TEXT NOT NULL,
  folio      TEXT,
  fecha      TEXT,
  concepto   TEXT,
  motivo     TEXT,
  datos      JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, guid)
);

COMMENT ON TABLE contpaqi_polizas_pendientes IS
  'Pólizas del respaldo que no se pudieron importar; se conservan crudas para no perder nada.';
