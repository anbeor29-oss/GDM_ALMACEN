-- ============================================================================
-- Migración: catálogos adicionales del Complemento Carta Porte 3.1
--   · cp_vehiculos       — flota de la empresa
--   · cp_aseguradoras    — pólizas por tipo (RespCivil / MedAmbiente / Carga)
--   · cp_operadores      — figuras de transporte (choferes, propietarios, etc.)
-- Y el puente productos → mercancía CP:
--   · products.cp_bienes_transp (clave c_ClaveProdServCP del SAT)
--   · products.cp_clave_unidad  (clave c_ClaveUnidad SAT, subset carta porte)
--
-- Todas idempotentes: CREATE TABLE IF NOT EXISTS + ALTER ADD COLUMN IF NOT EXISTS.
-- ============================================================================
BEGIN;

-- ─── ASEGURADORAS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cp_aseguradoras (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  alias              VARCHAR(60) NOT NULL,
  tipo               VARCHAR(20) NOT NULL,      -- 'RespCivil' | 'MedAmbiente' | 'Carga'
  nombre_aseguradora VARCHAR(150) NOT NULL,
  num_poliza         VARCHAR(50)  NOT NULL,
  prima_seguro       NUMERIC(12,2),             -- solo aplica a Carga
  activo             BOOLEAN NOT NULL DEFAULT true,
  usos               INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, alias),
  CONSTRAINT ck_cp_aseg_tipo CHECK (tipo IN ('RespCivil','MedAmbiente','Carga'))
);
CREATE INDEX IF NOT EXISTS ix_cp_aseg_company ON cp_aseguradoras(company_id, activo);

-- ─── VEHÍCULOS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cp_vehiculos (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  alias                  VARCHAR(60) NOT NULL,
  perm_sct               VARCHAR(10) NOT NULL,   -- TPAF01, TPAF02, ...
  num_permiso_sct        VARCHAR(50) NOT NULL,
  config_vehicular       VARCHAR(4)  NOT NULL,   -- C2, C3, T3S2, ...
  peso_bruto_vehicular   NUMERIC(10,3) NOT NULL, -- toneladas
  placa_vm               VARCHAR(10) NOT NULL,
  anio_modelo_vm         INTEGER NOT NULL,
  -- Aseguradoras por defecto (puede ser NULL; se pueden capturar en el form)
  aseguradora_resp_civil_id UUID REFERENCES cp_aseguradoras(id) ON DELETE SET NULL,
  aseguradora_med_amb_id    UUID REFERENCES cp_aseguradoras(id) ON DELETE SET NULL,
  aseguradora_carga_id      UUID REFERENCES cp_aseguradoras(id) ON DELETE SET NULL,
  activo                 BOOLEAN NOT NULL DEFAULT true,
  usos                   INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, alias),
  UNIQUE (company_id, placa_vm)
);
CREATE INDEX IF NOT EXISTS ix_cp_veh_company ON cp_vehiculos(company_id, activo);

-- ─── OPERADORES (Figuras de transporte) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS cp_operadores (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  alias              VARCHAR(60) NOT NULL,
  tipo_figura        VARCHAR(2)  NOT NULL DEFAULT '01', -- 01=Operador, 02=Propietario, 03=Arrendador, 04=Notificado
  rfc                VARCHAR(13) NOT NULL,
  num_licencia       VARCHAR(20),                       -- obligatorio si tipo_figura='01'
  nombre             VARCHAR(300) NOT NULL,
  num_reg_id_trib    VARCHAR(40),
  residencia_fiscal  VARCHAR(3),
  activo             BOOLEAN NOT NULL DEFAULT true,
  usos               INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, alias),
  UNIQUE (company_id, rfc, tipo_figura)
);
CREATE INDEX IF NOT EXISTS ix_cp_op_company ON cp_operadores(company_id, activo);

-- ─── PUENTE PRODUCTOS → MERCANCÍAS DE CP ───────────────────────────────────
-- Un producto tuyo puede tener asociada su clave SAT CP (BienesTransp) y su
-- unidad de peso (ClaveUnidad — subset carta porte). Con esto el picker
-- "Clave prod/serv CP" puede tener una pestaña "Mis productos" que rellene
-- ambos campos + descripción de golpe.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS cp_bienes_transp VARCHAR(8),
  ADD COLUMN IF NOT EXISTS cp_clave_unidad  VARCHAR(3);

CREATE INDEX IF NOT EXISTS ix_products_cp_bienes
  ON products(company_id, cp_bienes_transp)
  WHERE cp_bienes_transp IS NOT NULL;

COMMIT;
