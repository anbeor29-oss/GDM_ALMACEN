-- ============================================================================
-- Mercancías transportadas (Carta Porte 3.1) — SEPARADAS de products.
--
-- CONTEXTO: la empresa emisora es transportista. Las mercancías son propiedad
-- del cliente remitente/destinatario, NO del emisor. Se registran para:
--   · Autocompletar futuras Cartas Porte del mismo cliente (plantilla).
--   · Bitácora histórica para inspecciones SAT (falta de datos = multas).
--
-- No tocamos `products` — ese sigue siendo inventario propio.
-- ============================================================================

-- Catálogo/plantilla — una fila por (empresa, claveSat, descripción, cliente).
CREATE TABLE IF NOT EXISTS cp_mercancias_catalog (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  clave_sat         VARCHAR(10) NOT NULL,       -- BienesTransp (8 dígitos usualmente)
  descripcion       TEXT NOT NULL,
  descripcion_norm  TEXT NOT NULL,              -- para dedup (UPPER + trim + espacios)
  clave_unidad      VARCHAR(6),                 -- XRO, XBX, KGM, etc.
  unidad_texto      TEXT,                       -- "KILOGRAMO" opcional
  peso_unitario_kg  NUMERIC(14,3),              -- pesoEnKg / cantidad
  valor_unitario    NUMERIC(14,2),              -- valorMercancia / cantidad
  moneda            VARCHAR(3) DEFAULT 'MXN',
  cliente_rfc       VARCHAR(13),                -- remitente o destinatario típico
  cliente_nombre    TEXT,
  veces_transportada INTEGER NOT NULL DEFAULT 1,
  ultima_vez        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, clave_sat, descripcion_norm, cliente_rfc)
);
CREATE INDEX IF NOT EXISTS ix_cp_merc_catalog_company ON cp_mercancias_catalog(company_id);
CREATE INDEX IF NOT EXISTS ix_cp_merc_catalog_cliente ON cp_mercancias_catalog(company_id, cliente_rfc);
CREATE INDEX IF NOT EXISTS ix_cp_merc_catalog_clave   ON cp_mercancias_catalog(company_id, clave_sat);

-- Bitácora — una fila por mercancía por viaje. Es el rastro fiscal.
CREATE TABLE IF NOT EXISTS cp_mercancias_movimiento (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id        UUID REFERENCES invoices(id) ON DELETE SET NULL,
  catalog_id        UUID REFERENCES cp_mercancias_catalog(id) ON DELETE SET NULL,
  uuid_cfdi         VARCHAR(64),                -- UUID del CFDI para dedup
  id_ccp            VARCHAR(64),                -- IdCCP del complemento CP
  clave_sat         VARCHAR(10) NOT NULL,
  descripcion       TEXT NOT NULL,
  cantidad          NUMERIC(14,3) NOT NULL,
  clave_unidad      VARCHAR(6),
  peso_kg           NUMERIC(14,3),
  valor_mercancia   NUMERIC(14,2),
  moneda            VARCHAR(3) DEFAULT 'MXN',
  remitente_rfc     VARCHAR(13),
  remitente_nombre  TEXT,
  destinatario_rfc  VARCHAR(13),
  destinatario_nombre TEXT,
  fecha_viaje       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_cp_merc_mov_company  ON cp_mercancias_movimiento(company_id);
CREATE INDEX IF NOT EXISTS ix_cp_merc_mov_invoice  ON cp_mercancias_movimiento(invoice_id);
CREATE INDEX IF NOT EXISTS ix_cp_merc_mov_uuid     ON cp_mercancias_movimiento(company_id, uuid_cfdi);
CREATE INDEX IF NOT EXISTS ix_cp_merc_mov_fecha    ON cp_mercancias_movimiento(company_id, fecha_viaje DESC);
