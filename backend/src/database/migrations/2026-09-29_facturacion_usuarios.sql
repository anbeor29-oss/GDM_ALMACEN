-- ============================================================================
-- Facturación POR USUARIO (modelo nuevo) — reemplaza el cobro por paquete.
--
--   Renta = precio_usuario × usuarios facturables (sin contar checador)
--         + (timbres del mes por arriba de los incluidos) × timbre_extra
--
--   Defaults: $500/usuario · 2,000 timbres incluidos · $2.00 el excedente.
--   Prepago: la lista se genera el día 30; a quien entra después del día 1 se
--   le prorratea el primer mes. Suspensión de servicio si no paga.
-- ============================================================================

-- Config editable por el super admin (un solo renglón). El precio sube por
-- inflación (INPC) cambiando aquí, sin redesplegar.
CREATE TABLE IF NOT EXISTS facturacion_config (
  id                 INT PRIMARY KEY DEFAULT 1,
  precio_usuario_mxn NUMERIC(10,2) NOT NULL DEFAULT 500.00,
  timbres_incluidos  INT           NOT NULL DEFAULT 2000,
  timbre_extra_mxn   NUMERIC(10,2) NOT NULL DEFAULT 2.00,
  updated_at         TIMESTAMP DEFAULT NOW(),
  CONSTRAINT facturacion_config_una_fila CHECK (id = 1)
);
INSERT INTO facturacion_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- La factura mensual por empresa (una por periodo). Idempotente por (empresa, periodo).
CREATE TABLE IF NOT EXISTS facturacion_mensual (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id         UUID NOT NULL REFERENCES companies(id),
  periodo            DATE NOT NULL,                       -- primer día del mes
  usuarios           INT  NOT NULL DEFAULT 0,             -- facturables (sin checador)
  dias_cobrados      INT  NOT NULL,
  dias_mes           INT  NOT NULL,
  prorrateado        BOOLEAN NOT NULL DEFAULT FALSE,
  precio_usuario_mxn NUMERIC(10,2) NOT NULL,
  renta_mxn          NUMERIC(12,2) NOT NULL,
  timbres_usados     INT  NOT NULL DEFAULT 0,
  timbres_incluidos  INT  NOT NULL,
  timbres_extra      INT  NOT NULL DEFAULT 0,
  timbre_extra_mxn   NUMERIC(10,2) NOT NULL,
  extra_mxn          NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_mxn          NUMERIC(12,2) NOT NULL,
  status             VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE',  -- PENDIENTE | PAGADO | SUSPENDIDO
  factura_id         UUID,
  generado_at        TIMESTAMP DEFAULT NOW(),
  pagado_at          TIMESTAMP,
  suspendido_at      TIMESTAMP,
  UNIQUE (company_id, periodo)
);
CREATE INDEX IF NOT EXISTS idx_facturacion_mensual_periodo ON facturacion_mensual(periodo);
CREATE INDEX IF NOT EXISTS idx_facturacion_mensual_company ON facturacion_mensual(company_id);

-- Corte del servicio por falta de pago (día 5). Bandera separada de is_active
-- para no confundir "desactivada por el admin" con "suspendida por cobranza".
ALTER TABLE companies ADD COLUMN IF NOT EXISTS servicio_suspendido BOOLEAN DEFAULT FALSE;
