-- Despachos contables: el DESPACHO (la firma) que administra a sus empresas cliente
-- y donde se FIJAN LOS PRECIOS del servicio. Hasta hoy el «despacho» era, de hecho,
-- la emisora de cobro (empresa_cobro_id) y el precio era único global. Ahora el
-- despacho es una entidad propia:
--
--   · Agrupa a sus empresas cliente (companies.despacho_id).
--   · Tiene su propio precio por usuario y escalón de timbres (NULL = hereda el
--     global de facturacion_config). Así un despacho grande puede pactar otro precio.
--   · Puede tener una emisora predeterminada (cuál de las emisoras de cobro timbra
--     sus facturas por omisión); el cobro se sigue pudiendo emitir eligiendo emisora.
--
-- No se toca el timbrado de las ventas propias de cada empresa; es sólo el cobro del
-- servicio desde el super admin.

CREATE TABLE IF NOT EXISTS despachos_contables (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre                    TEXT NOT NULL,
  -- Precios del despacho. NULL = hereda el global (facturacion_config).
  precio_usuario_mxn        NUMERIC(12,2),
  timbres_incluidos         INTEGER,
  timbre_extra_mxn          NUMERIC(12,4),
  timbres_por_usuario       INTEGER,
  timbre_extra_por_usuario  NUMERIC(12,4),
  -- Emisora de cobro predeterminada del despacho (una de las companies con es_emisor_cobro).
  emisora_predeterminada_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  notas                     TEXT,
  activo                    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                TIMESTAMPTZ
);

-- A qué despacho pertenece cada empresa (NULL = sin despacho / «Sin despacho» en el árbol).
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS despacho_id UUID REFERENCES despachos_contables(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_companies_despacho ON companies(despacho_id) WHERE deleted_at IS NULL;

-- Seed: UN solo despacho interno «GRUPO HCGM». Toma como emisora predeterminada a
-- GHC1707275Y0 y mete en él a TODAS las empresas activas (las 24 + las propias,
-- incluida SERVICIOS ADMINISTRATIVOS JOMAR / SAJ10120859A). Así queda un único
-- despacho interno y JOMAR dentro de GRUPO HCGM (CUARTO del pedido). Idempotente:
-- si ya existe un despacho con ese nombre no se duplica.
DO $$
DECLARE
  v_despacho UUID;
  v_ghc      UUID;
BEGIN
  SELECT id INTO v_ghc FROM companies WHERE UPPER(rfc) = 'GHC1707275Y0' AND deleted_at IS NULL LIMIT 1;

  SELECT id INTO v_despacho FROM despachos_contables WHERE lower(nombre) = 'grupo hcgm' AND deleted_at IS NULL LIMIT 1;
  IF v_despacho IS NULL THEN
    INSERT INTO despachos_contables (nombre, emisora_predeterminada_id, notas)
    VALUES ('GRUPO HCGM', v_ghc, 'Despacho interno de GRUPO HCGM. Hereda el precio global salvo que se fije uno propio.')
    RETURNING id INTO v_despacho;
  END IF;

  -- Todas las empresas activas sin despacho quedan bajo GRUPO HCGM (incluye las
  -- emisoras propias y JOMAR). No se tocan las que ya tengan un despacho asignado.
  UPDATE companies
     SET despacho_id = v_despacho, updated_at = NOW()
   WHERE deleted_at IS NULL AND is_active = TRUE AND despacho_id IS NULL;
END $$;
