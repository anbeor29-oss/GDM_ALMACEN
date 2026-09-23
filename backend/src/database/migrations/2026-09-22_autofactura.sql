-- ============================================================================
-- AUTOFACTURACIÓN (Anexo 20 / RMF Sección 2.7.3) — «Comprobación de erogaciones»
--
-- El ADQUIRENTE (nuestra empresa) expide el CFDI POR CUENTA del ENAJENANTE
-- (vendedor persona física del sector primario, arrendador, minero, artesano,
-- vehículos usados, desperdicios, arte, antigüedades) que NO emite su propia
-- factura. En el CFDI resultante el EMISOR es el enajenante y el RECEPTOR es la
-- empresa adquirente — al revés que una factura normal.
--
-- Si el enajenante NO tiene RFC, el CFDI va con el RFC genérico nacional
-- (XAXX010101000) registrando su NOMBRE y CURP (RMF 2.7.3). El régimen típico
-- del sector primario es el 622 (AGAPES).
--
-- OJO — el TIMBRADO real NO es el de emisión normal: requiere el «rol de
-- facturación a través del adquirente» ante el SAT y un PAC con servicio de
-- adquirentes. Por eso aquí sólo se CAPTURA y se PREVISUALIZA (estado BORRADOR);
-- el timbrado queda gated hasta activar ese rol + PAC (ver autofactura.service).
-- ============================================================================

-- 1. Registro de ENAJENANTES (los vendedores por los que emitimos).
CREATE TABLE IF NOT EXISTS autofactura_enajenantes (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  nombre         VARCHAR(254) NOT NULL,
  -- CURP: obligatoria cuando NO hay RFC (identifica a la persona física ante SAT).
  curp           VARCHAR(18),
  -- RFC del enajenante; NULL = se usará el genérico nacional al construir el CFDI.
  rfc            VARCHAR(13),
  -- Régimen fiscal del ENAJENANTE en el CFDI (622 AGAPES para sector primario).
  regimen_fiscal VARCHAR(3) NOT NULL DEFAULT '622',
  -- CP del domicilio fiscal del enajenante (para DomicilioFiscalReceptor NO; va
  -- en el propio Emisor no lleva CP, pero se guarda para el registro/roles SAT).
  cp_fiscal      VARCHAR(5),
  -- Sector/actividad de la RMF 2.7.3: primario | arrendamiento | minero |
  -- artesano | vehiculos | desperdicios | arte | antiguedades.
  sector         VARCHAR(20) NOT NULL DEFAULT 'primario',
  -- CLABE opcional para el pago de la erogación.
  clabe          VARCHAR(18),
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_autofact_enaj_empresa ON autofactura_enajenantes(company_id) WHERE activo;
-- Sin duplicar por CURP dentro de la empresa (cuando hay CURP).
CREATE UNIQUE INDEX IF NOT EXISTS uq_autofact_enaj_curp
  ON autofactura_enajenantes(company_id, curp) WHERE curp IS NOT NULL;

-- 2. COMPROBANTES (cada erogación = un CFDI que emitimos por el enajenante).
CREATE TABLE IF NOT EXISTS autofactura_comprobantes (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enajenante_id  UUID NOT NULL REFERENCES autofactura_enajenantes(id) ON DELETE RESTRICT,
  fecha          DATE NOT NULL,
  serie          VARCHAR(25),
  folio          VARCHAR(40),
  -- Conceptos capturados (clave SAT, cantidad, unidad, descripción, valor…).
  conceptos      JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal       NUMERIC(14,2) NOT NULL DEFAULT 0,
  iva            NUMERIC(14,2) NOT NULL DEFAULT 0,
  ret_iva        NUMERIC(14,2) NOT NULL DEFAULT 0,
  ret_isr        NUMERIC(14,2) NOT NULL DEFAULT 0,
  total          NUMERIC(14,2) NOT NULL DEFAULT 0,
  forma_pago     VARCHAR(2) NOT NULL DEFAULT '03',   -- 03 transferencia
  metodo_pago    VARCHAR(3) NOT NULL DEFAULT 'PUE',
  uso_cfdi       VARCHAR(4) NOT NULL DEFAULT 'G03',   -- gastos en general (receptor adquirente)
  -- BORRADOR (capturado, sin timbrar) · TIMBRADO · CANCELADO.
  estado         VARCHAR(10) NOT NULL DEFAULT 'BORRADOR',
  uuid           VARCHAR(36),
  xml            TEXT,
  -- El JSON CFDI 4.0 ya armado (previsualización / lo que se mandaría a timbrar).
  json_cfdi      JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_autofact_comp_empresa ON autofactura_comprobantes(company_id, fecha);
CREATE INDEX IF NOT EXISTS idx_autofact_comp_enaj    ON autofactura_comprobantes(enajenante_id);
-- Idempotencia por UUID una vez timbrado (no dos veces el mismo folio fiscal).
CREATE UNIQUE INDEX IF NOT EXISTS uq_autofact_comp_uuid
  ON autofactura_comprobantes(company_id, uuid) WHERE uuid IS NOT NULL;
