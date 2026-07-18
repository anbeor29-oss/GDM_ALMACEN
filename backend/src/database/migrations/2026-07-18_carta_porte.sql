-- ============================================================================
-- Migración: Complemento Carta Porte 3.1
-- Fecha: 2026-07-18
-- Objeto: crear las 7 tablas operativas + 34 tablas de catálogo SAT
-- ============================================================================
-- Notas de diseño:
--   * Idempotente: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
--   * FK a invoices con ON DELETE CASCADE cuando el hijo no tiene sentido
--     sin el padre (ubicaciones, mercancías, autotransporte, remolques,
--     figuras). NO se cascadea desde catálogos SAT — solo NO ACTION.
--   * Los catálogos usan la clave del SAT como PK VARCHAR — se seedean
--     con generate-carta-porte-seed.py.
--   * carta_porte.invoice_id es UNIQUE: una factura tiene 0 o 1 CP.
-- ============================================================================

BEGIN;

-- ─── 1. Tabla de versiones de catálogos (auditoría) ────────────────────────
CREATE TABLE IF NOT EXISTS catalog_versions (
  id            SERIAL PRIMARY KEY,
  catalog_name  VARCHAR(64)  NOT NULL,
  source_file   VARCHAR(120) NOT NULL,
  sha256        VARCHAR(64)  NOT NULL UNIQUE,
  record_count  INTEGER      NOT NULL,
  loaded_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_catalog_versions_name ON catalog_versions(catalog_name);

-- ─── 2. Catálogos SAT del complemento Carta Porte 3.1 ──────────────────────
-- (Estructura mínima: clave + descripción + campos específicos donde el XSD
--  los exige. Los datos se cargan con generate-carta-porte-seed.py.)

CREATE TABLE IF NOT EXISTS sat_cp_clave_prod_serv (
  clave              VARCHAR(8) PRIMARY KEY,
  descripcion        TEXT NOT NULL,
  material_peligroso VARCHAR(2)   -- '0','1','0/1' según el catálogo
);

CREATE TABLE IF NOT EXISTS sat_cp_clave_unidad_peso (
  clave       VARCHAR(3) PRIMARY KEY,
  nombre      VARCHAR(80),
  descripcion TEXT
);

CREATE TABLE IF NOT EXISTS sat_cp_config_autotransporte (
  clave           VARCHAR(4) PRIMARY KEY,
  descripcion     TEXT NOT NULL,
  numero_ejes     VARCHAR(3),
  numero_llantas  VARCHAR(3),
  remolque        VARCHAR(2)
);

CREATE TABLE IF NOT EXISTS sat_cp_sub_tipo_rem (
  clave       VARCHAR(6) PRIMARY KEY,
  descripcion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sat_cp_tipo_permiso (
  clave            VARCHAR(6) PRIMARY KEY,
  descripcion      TEXT NOT NULL,
  clave_transporte VARCHAR(4)
);

CREATE TABLE IF NOT EXISTS sat_cp_tipo_embalaje (
  clave       VARCHAR(4) PRIMARY KEY,
  descripcion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sat_cp_material_peligroso (
  clave              VARCHAR(4) PRIMARY KEY,
  descripcion        TEXT NOT NULL,
  clase_o_div        VARCHAR(10),
  peligro_secundario VARCHAR(20),
  nombre_tecnico     TEXT
);

CREATE TABLE IF NOT EXISTS sat_cp_figura_transporte (
  clave       VARCHAR(2) PRIMARY KEY,
  descripcion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sat_cp_parte_transporte (
  clave       VARCHAR(4) PRIMARY KEY,
  descripcion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sat_cp_tipo_estacion (
  clave            VARCHAR(4) PRIMARY KEY,
  descripcion      TEXT NOT NULL,
  clave_transporte VARCHAR(4)
);

CREATE TABLE IF NOT EXISTS sat_cp_cve_transporte (
  clave       VARCHAR(4) PRIMARY KEY,
  descripcion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sat_cp_documento_aduanero (
  clave       VARCHAR(4) PRIMARY KEY,
  descripcion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sat_cp_regimen_aduanero (
  clave       VARCHAR(4) PRIMARY KEY,
  descripcion TEXT NOT NULL,
  impoexpo    VARCHAR(20)
);

-- Geográficos (los "gigantes tres" — datos ya presentes en catCFDI-v4)
CREATE TABLE IF NOT EXISTS sat_cp_colonia (
  clave         VARCHAR(4)  NOT NULL,
  codigo_postal VARCHAR(10) NOT NULL,
  descripcion   TEXT        NOT NULL,
  PRIMARY KEY (clave, codigo_postal)
);
CREATE INDEX IF NOT EXISTS ix_sat_cp_colonia_cp ON sat_cp_colonia(codigo_postal);

CREATE TABLE IF NOT EXISTS sat_cp_localidad (
  clave       VARCHAR(4) NOT NULL,
  estado      VARCHAR(3) NOT NULL,
  descripcion TEXT       NOT NULL,
  PRIMARY KEY (clave, estado)
);

CREATE TABLE IF NOT EXISTS sat_cp_municipio (
  clave       VARCHAR(4) NOT NULL,
  estado      VARCHAR(3) NOT NULL,
  descripcion TEXT       NOT NULL,
  PRIMARY KEY (clave, estado)
);

-- Multimodal — cargados pero deshabilitados por defecto en UI
CREATE TABLE IF NOT EXISTS sat_cp_clave_tipo_carga       (clave VARCHAR(4) PRIMARY KEY, descripcion TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sat_cp_config_maritima        (clave VARCHAR(4) PRIMARY KEY, descripcion TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sat_cp_contenedor_maritimo    (clave VARCHAR(4) PRIMARY KEY, descripcion TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sat_cp_codigo_transporte_aereo(clave VARCHAR(6) PRIMARY KEY, nacionalidad VARCHAR(60), nombre_aerolinea TEXT);
CREATE TABLE IF NOT EXISTS sat_cp_tipo_de_servicio       (clave VARCHAR(4) PRIMARY KEY, descripcion TEXT NOT NULL, contenedor VARCHAR(4));
CREATE TABLE IF NOT EXISTS sat_cp_derechos_de_paso       (clave VARCHAR(6) PRIMARY KEY, descripcion TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sat_cp_tipo_carro             (clave VARCHAR(4) PRIMARY KEY, descripcion TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sat_cp_contenedor             (clave VARCHAR(4) PRIMARY KEY, descripcion TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sat_cp_tipo_de_trafico        (clave VARCHAR(4) PRIMARY KEY, descripcion TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sat_cp_tipo_materia           (clave VARCHAR(4) PRIMARY KEY, descripcion TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sat_cp_registro_istmo         (clave VARCHAR(4) PRIMARY KEY, descripcion TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sat_cp_estaciones             (clave VARCHAR(6) PRIMARY KEY, descripcion TEXT NOT NULL, clave_transporte VARCHAR(4));
CREATE TABLE IF NOT EXISTS sat_cp_num_autorizacion_naviero(clave VARCHAR(10) PRIMARY KEY, descripcion TEXT);

-- Farmacéuticos (medicamentos controlados)
CREATE TABLE IF NOT EXISTS sat_cp_sector_cofepris        (clave VARCHAR(4) PRIMARY KEY, descripcion TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sat_cp_forma_farmaceutica     (clave VARCHAR(4) PRIMARY KEY, descripcion TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sat_cp_condiciones_especiales (clave VARCHAR(4) PRIMARY KEY, descripcion TEXT NOT NULL);

-- ─── 3. Tabla principal: carta_porte ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS carta_porte (
  id                 SERIAL PRIMARY KEY,
  invoice_id         UUID    NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  version            VARCHAR(4)  NOT NULL DEFAULT '3.1',
  transp_internac    VARCHAR(2)  NOT NULL DEFAULT 'No',   -- 'Si' | 'No'
  entrada_salida_merc VARCHAR(10),                        -- 'Entrada'|'Salida' si internac='Si'
  pais_origen_destino VARCHAR(3),
  via_entrada_salida  VARCHAR(4),                         -- referencia a c_CveTransporte
  total_dist_rec     NUMERIC(16,6) NOT NULL,
  registro_istmo     VARCHAR(2),                          -- 'Si'|'No' — opcional
  ubicacion_polo_origen  VARCHAR(4),
  ubicacion_polo_destino VARCHAR(4),
  regimen_aduanero   VARCHAR(4),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id)
);
CREATE INDEX IF NOT EXISTS ix_carta_porte_invoice ON carta_porte(invoice_id);

-- ─── 4. Ubicaciones (origen/destino) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS cp_ubicaciones (
  id                    SERIAL PRIMARY KEY,
  carta_porte_id        INTEGER NOT NULL REFERENCES carta_porte(id) ON DELETE CASCADE,
  tipo_ubicacion        VARCHAR(10) NOT NULL,      -- 'Origen' | 'Destino'
  id_ubicacion          VARCHAR(10) NOT NULL,      -- OR001... / DE001...
  rfc_remitente_destinatario VARCHAR(13) NOT NULL,
  nombre_remitente_destinatario VARCHAR(300),
  num_reg_id_trib       VARCHAR(40),
  residencia_fiscal     VARCHAR(3),
  num_estacion          VARCHAR(6),                -- para tren/aéreo/marítimo
  nombre_estacion       VARCHAR(120),
  navegacion_trafico    VARCHAR(20),
  fecha_hora_salida_llegada TIMESTAMPTZ NOT NULL,
  tipo_estacion         VARCHAR(4),
  distancia_recorrida   NUMERIC(16,6),             -- solo en Destino
  -- Domicilio
  calle                 VARCHAR(200),
  num_exterior          VARCHAR(60),
  num_interior          VARCHAR(60),
  colonia               VARCHAR(4),                -- FK lógica a sat_cp_colonia
  localidad             VARCHAR(4),
  referencia            VARCHAR(500),
  municipio             VARCHAR(4),
  estado                VARCHAR(3) NOT NULL,
  pais                  VARCHAR(3) NOT NULL DEFAULT 'MEX',
  codigo_postal         VARCHAR(10) NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_cp_ubicaciones_cp ON cp_ubicaciones(carta_porte_id);

-- ─── 5. Mercancías ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cp_mercancias (
  id                  SERIAL PRIMARY KEY,
  carta_porte_id      INTEGER NOT NULL REFERENCES carta_porte(id) ON DELETE CASCADE,
  bienes_transp       VARCHAR(8)  NOT NULL,        -- referencia c_ClaveProdServCP
  descripcion         TEXT NOT NULL,
  cantidad            NUMERIC(16,6) NOT NULL,
  clave_unidad        VARCHAR(3)  NOT NULL,        -- referencia c_ClaveUnidad (CFDI)
  unidad              VARCHAR(50),
  dimensiones         VARCHAR(50),
  material_peligroso  VARCHAR(2),                  -- 'Si'|'No'
  cve_material_peligroso VARCHAR(4),               -- si es peligroso
  embalaje            VARCHAR(4),                  -- si es peligroso
  descrip_embalaje    TEXT,
  peso_en_kg          NUMERIC(16,6) NOT NULL,
  valor_mercancia     NUMERIC(16,6),
  moneda              VARCHAR(3),
  fraccion_arancelaria VARCHAR(10),
  uuid_comercio_ext   VARCHAR(36),
  tipo_materia        VARCHAR(4),
  descripcion_materia TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_cp_mercancias_cp ON cp_mercancias(carta_porte_id);

-- ─── 6. Autotransporte ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cp_autotransporte (
  id                    SERIAL PRIMARY KEY,
  carta_porte_id        INTEGER NOT NULL REFERENCES carta_porte(id) ON DELETE CASCADE,
  perm_sct              VARCHAR(6) NOT NULL,       -- c_TipoPermiso
  num_permiso_sct       VARCHAR(50) NOT NULL,
  config_vehicular      VARCHAR(4) NOT NULL,       -- c_ConfigAutotransporte
  peso_bruto_vehicular  NUMERIC(16,6) NOT NULL,
  placa_vm              VARCHAR(7)  NOT NULL,
  anio_modelo_vm        INTEGER     NOT NULL,
  -- Seguros
  asegura_resp_civil    VARCHAR(150) NOT NULL,
  poliza_resp_civil     VARCHAR(50)  NOT NULL,
  asegura_med_ambiente  VARCHAR(150),
  poliza_med_ambiente   VARCHAR(50),
  asegura_carga         VARCHAR(150),
  poliza_carga          VARCHAR(50),
  prima_seguro          NUMERIC(16,6),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (carta_porte_id)
);

-- ─── 7. Remolques ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cp_remolques (
  id                 SERIAL PRIMARY KEY,
  autotransporte_id  INTEGER NOT NULL REFERENCES cp_autotransporte(id) ON DELETE CASCADE,
  sub_tipo_rem       VARCHAR(6) NOT NULL,          -- c_SubTipoRem
  placa              VARCHAR(7) NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_cp_remolques_at ON cp_remolques(autotransporte_id);

-- ─── 8. Figuras de transporte (operador, propietario, arrendatario) ───────
CREATE TABLE IF NOT EXISTS cp_figuras (
  id                    SERIAL PRIMARY KEY,
  carta_porte_id        INTEGER NOT NULL REFERENCES carta_porte(id) ON DELETE CASCADE,
  tipo_figura           VARCHAR(2)  NOT NULL,      -- c_FiguraTransporte
  rfc_figura            VARCHAR(13) NOT NULL,
  num_licencia          VARCHAR(16),                -- solo operador
  nombre_figura         VARCHAR(300),
  num_reg_id_trib       VARCHAR(40),
  residencia_fiscal_fig VARCHAR(3),
  -- Partes de transporte (solo si aplica)
  parte_transporte      VARCHAR(4),
  -- Domicilio (solo obligatorio para propietario/arrendatario extranjero)
  calle                 VARCHAR(200),
  num_exterior          VARCHAR(60),
  colonia               VARCHAR(4),
  municipio             VARCHAR(4),
  estado                VARCHAR(3),
  pais                  VARCHAR(3),
  codigo_postal         VARCHAR(10),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_cp_figuras_cp ON cp_figuras(carta_porte_id);

COMMIT;
