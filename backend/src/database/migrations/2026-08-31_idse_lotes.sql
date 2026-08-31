-- ============================================================================
-- BITÁCORA DE LOTES IDSE — cada archivo de movimientos que se generó y subió al
-- IDSE, con el acuse que el portal devuelve.
--
-- Cada vez que el constructor arma un archivo IDSE se registra aquí un LOTE con
-- la foto de sus movimientos (trabajador, NSS, tipo, fecha, SBC, causa). No
-- reemplaza a la cola de pendientes: es el histórico de envíos, para tener a la
-- mano qué se mandó y —al adjuntarlo— la confirmación del IDSE.
--
-- El acuse (PDF del portal del IDSE) se guarda EN LA BASE: el disco de Render es
-- efímero, así que un archivo escrito ahí sería un secreto abandonado. Es chico
-- (unas decenas de KB) y así viaja con la empresa aunque la máquina se recicle.
-- ============================================================================

CREATE TABLE IF NOT EXISTS nomina_idse_lotes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  nombre_archivo    VARCHAR(120),                 -- el TXT que se descargó
  num_movimientos   INTEGER NOT NULL DEFAULT 0,
  registro_patronal VARCHAR(15),

  -- El acuse del portal del IDSE que sube el usuario (PDF). Nulo hasta que lo adjunta.
  acuse_pdf         BYTEA,
  acuse_nombre      VARCHAR(200),
  acuse_tipo        VARCHAR(120),
  acuse_subido_at   TIMESTAMP,

  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idse_lotes_empresa
  ON nomina_idse_lotes (company_id, created_at DESC);

-- La foto de cada movimiento del lote. Se guarda el dato tal como se envió (no una
-- referencia viva): si el trabajador cambia después, la bitácora sigue diciendo lo
-- que se mandó ese día.
CREATE TABLE IF NOT EXISTS nomina_idse_lote_movimientos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lote_id         UUID NOT NULL REFERENCES nomina_idse_lotes(id) ON DELETE CASCADE,
  empleado_id     UUID REFERENCES nomina_empleados(id) ON DELETE SET NULL,

  nombre_completo VARCHAR(250),
  nss             VARCHAR(11),
  num_empleado    VARCHAR(30),
  tipo            VARCHAR(15) NOT NULL,           -- ALTA / BAJA / MODIFICACION
  fecha           DATE NOT NULL,
  sbc             NUMERIC(12,2),
  causa_baja      VARCHAR(1),
  orden           SMALLINT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_idse_lote_mov_lote
  ON nomina_idse_lote_movimientos (lote_id);

COMMENT ON TABLE nomina_idse_lotes IS
  'Bitácora de archivos IDSE generados, con el acuse (PDF) que devuelve el portal.';
