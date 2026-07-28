-- ============================================================================
-- Migración: Carta Porte 3.1 — capa internacional y multimodal
-- Fecha: 2026-07-27
-- Base: CARTA_PORTE_INTERNACIONAL.md (HCGM Advisors, v1.0)
-- ============================================================================
-- Principio de diseño (§2 del documento): NO se crea un módulo separado. Se
-- conserva la estructura nacional y se le cuelgan las capas que faltan:
--
--   1. Comercio exterior      → columnas nuevas en carta_porte + colección
--                               cp_regimenes_aduaneros
--   2. Selector modal         → carta_porte.medio_transporte ('01'..'04')
--   3. Bloque por modalidad   → cp_ferroviario / cp_maritimo / cp_aereo
--   4. Doc. aduanera          → cp_mercancia_doc_aduanera (por mercancía,
--                               NO a nivel carta porte — §6.3)
--   5. Participantes y
--      domicilios extranjeros → ensanchado de cp_figuras + cp_lugares.pais
--   6. Cruces fronterizos     → cp_cruce_fronterizo (catálogo propio, §8.1)
--
-- Idempotente: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS y los
-- seeds con ON CONFLICT DO NOTHING.
--
-- Los catálogos SAT de las modalidades (tipo_carro, contenedor, config_maritima,
-- codigo_transporte_aereo, derechos_de_paso, tipo_de_servicio, tipo_de_trafico,
-- estaciones, num_autorizacion_naviero) YA existen y están sembrados desde
-- 2026-07-18_carta_porte.sql — aquí solo se consumen.
-- ============================================================================

BEGIN;

-- ─── 1. Cabecera: selector modal y comercio exterior ───────────────────────
-- medio_transporte es exclusivo (§7): una carta porte lleva un solo nodo modal.
-- Default '01' porque todo lo ya capturado es autotransporte nacional.
ALTER TABLE carta_porte ADD COLUMN IF NOT EXISTS medio_transporte    VARCHAR(2) NOT NULL DEFAULT '01';
ALTER TABLE carta_porte ADD COLUMN IF NOT EXISTS pais_transportista  VARCHAR(3);
ALTER TABLE carta_porte ADD COLUMN IF NOT EXISTS cruce_fronterizo    VARCHAR(10);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_carta_porte_medio') THEN
    ALTER TABLE carta_porte
      ADD CONSTRAINT ck_carta_porte_medio CHECK (medio_transporte IN ('01','02','03','04'));
  END IF;
END $$;

COMMENT ON COLUMN carta_porte.medio_transporte IS
  '01 Autotransporte · 02 Marítimo · 03 Aéreo · 04 Ferroviario (c_CveTransporte)';

-- ─── 2. Regímenes aduaneros como colección (§4.5) ──────────────────────────
-- El SAT admite varios regímenes por operación; carta_porte.regimen_aduanero
-- (columna vieja, un solo valor) se conserva para no romper lo ya capturado,
-- pero el builder de XML lee de esta tabla.
CREATE TABLE IF NOT EXISTS cp_regimenes_aduaneros (
  id               SERIAL PRIMARY KEY,
  carta_porte_id   INTEGER    NOT NULL REFERENCES carta_porte(id) ON DELETE CASCADE,
  regimen_aduanero VARCHAR(4) NOT NULL,
  orden            INTEGER    NOT NULL DEFAULT 0,
  UNIQUE (carta_porte_id, regimen_aduanero)
);
CREATE INDEX IF NOT EXISTS ix_cp_regimenes_cp ON cp_regimenes_aduaneros(carta_porte_id);

-- Migrar el valor único que ya estuviera capturado a la colección.
INSERT INTO cp_regimenes_aduaneros (carta_porte_id, regimen_aduanero, orden)
SELECT id, regimen_aduanero, 0 FROM carta_porte
WHERE regimen_aduanero IS NOT NULL AND regimen_aduanero <> ''
ON CONFLICT (carta_porte_id, regimen_aduanero) DO NOTHING;

-- ─── 3. Documentación aduanera por mercancía (§6.2, §6.3) ──────────────────
-- Va colgada de la mercancía, no de la carta porte: una misma carta porte
-- puede llevar mercancías con pedimentos distintos, mercancías nacionales
-- junto a extranjeras, y varios documentos para una sola mercancía.
CREATE TABLE IF NOT EXISTS cp_mercancia_doc_aduanera (
  id                 SERIAL PRIMARY KEY,
  mercancia_id       INTEGER    NOT NULL REFERENCES cp_mercancias(id) ON DELETE CASCADE,
  tipo_documento     VARCHAR(2) NOT NULL,   -- c_DocumentoAduanero; '01' = Pedimento
  num_pedimento      VARCHAR(21),           -- solo cuando tipo_documento = '01'
  ident_doc_aduanero VARCHAR(36),           -- cuando tipo_documento <> '01'
  rfc_impo           VARCHAR(13),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_cp_doc_aduanera_merc ON cp_mercancia_doc_aduanera(mercancia_id);

-- El SAT exige uno u otro identificador, nunca ambos ni ninguno.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cp_doc_aduanera_ident') THEN
    ALTER TABLE cp_mercancia_doc_aduanera ADD CONSTRAINT ck_cp_doc_aduanera_ident CHECK (
      (tipo_documento =  '01' AND num_pedimento IS NOT NULL AND ident_doc_aduanero IS NULL) OR
      (tipo_documento <> '01' AND ident_doc_aduanero IS NOT NULL AND num_pedimento IS NULL)
    );
  END IF;
END $$;

-- ─── 4. Transporte ferroviario (§9) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cp_ferroviario (
  id                SERIAL PRIMARY KEY,
  carta_porte_id    INTEGER    NOT NULL REFERENCES carta_porte(id) ON DELETE CASCADE,
  tipo_de_servicio  VARCHAR(4) NOT NULL,        -- c_TipoDeServicio (TS01..TS04)
  tipo_de_trafico   VARCHAR(4) NOT NULL,        -- c_TipoDeTrafico  (TT01..TT04)
  nombre_aseg       VARCHAR(150),
  num_poliza_seguro VARCHAR(30),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (carta_porte_id)
);

CREATE TABLE IF NOT EXISTS cp_ferroviario_derechos_paso (
  id                   SERIAL PRIMARY KEY,
  ferroviario_id       INTEGER       NOT NULL REFERENCES cp_ferroviario(id) ON DELETE CASCADE,
  tipo_derecho_de_paso VARCHAR(6)    NOT NULL,  -- c_DerechosDePaso
  kilometraje_pagado   NUMERIC(16,6) NOT NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_cp_ferro_dp ON cp_ferroviario_derechos_paso(ferroviario_id);

CREATE TABLE IF NOT EXISTS cp_ferroviario_carros (
  id                    SERIAL PRIMARY KEY,
  ferroviario_id        INTEGER       NOT NULL REFERENCES cp_ferroviario(id) ON DELETE CASCADE,
  tipo_carro            VARCHAR(4)    NOT NULL,   -- c_TipoCarro
  matricula_carro       VARCHAR(10)   NOT NULL,
  guia_carro            VARCHAR(36)   NOT NULL,
  toneladas_netas_carro NUMERIC(16,6) NOT NULL,
  orden                 INTEGER       NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_cp_ferro_carros ON cp_ferroviario_carros(ferroviario_id);

-- El contenedor cuelga del carro, no del nodo ferroviario (§9.3).
CREATE TABLE IF NOT EXISTS cp_ferroviario_contenedores (
  id                    SERIAL PRIMARY KEY,
  carro_id              INTEGER       NOT NULL REFERENCES cp_ferroviario_carros(id) ON DELETE CASCADE,
  tipo_contenedor       VARCHAR(4)    NOT NULL,   -- c_Contenedor (ferroviario)
  peso_contenedor_vacio NUMERIC(16,6) NOT NULL,
  peso_neto_mercancia   NUMERIC(16,6) NOT NULL,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_cp_ferro_cont ON cp_ferroviario_contenedores(carro_id);

-- ─── 5. Transporte marítimo (§10) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cp_maritimo (
  id                        SERIAL PRIMARY KEY,
  carta_porte_id            INTEGER    NOT NULL REFERENCES carta_porte(id) ON DELETE CASCADE,
  perm_sct                  VARCHAR(6),
  num_permiso_sct           VARCHAR(50),
  nombre_aseg               VARCHAR(150),
  num_poliza_seguro         VARCHAR(30),
  tipo_embarcacion          VARCHAR(4),           -- c_ConfigMaritima
  matricula                 VARCHAR(10) NOT NULL,
  numero_omi                VARCHAR(10) NOT NULL, -- p.ej. IMO1234567
  anio_embarcacion          INTEGER,
  nombre_embarc             VARCHAR(50),
  nacionalidad_embarc       VARCHAR(3),
  unidades_arq_bruto        NUMERIC(16,6),
  tipo_carga                VARCHAR(4),           -- c_ClaveTipoCarga
  num_cert_itc              VARCHAR(20)  NOT NULL,
  eslora                    NUMERIC(16,6),
  manga                     NUMERIC(16,6),
  calado                    NUMERIC(16,6),
  linea_naviera             VARCHAR(100),
  nombre_agente_naviero     VARCHAR(300) NOT NULL,
  num_autorizacion_naviero  VARCHAR(10),          -- c_NumAutorizacionNaviero
  num_viaje                 VARCHAR(10),
  num_conocimiento_embarque VARCHAR(20),
  permiso_temp_navegacion   VARCHAR(10),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (carta_porte_id)
);

CREATE TABLE IF NOT EXISTS cp_maritimo_contenedores (
  id                      SERIAL PRIMARY KEY,
  maritimo_id             INTEGER     NOT NULL REFERENCES cp_maritimo(id) ON DELETE CASCADE,
  matricula_contenedor    VARCHAR(10) NOT NULL,
  tipo_contenedor         VARCHAR(6)  NOT NULL,   -- c_ContenedorMaritimo
  num_precinto            VARCHAR(20),
  -- Enlace al tramo de autotransporte que recoge el contenedor en puerto.
  id_ccp_relacionado      VARCHAR(36),
  placa_vm_ccp            VARCHAR(7),
  fecha_certificacion_ccp DATE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_cp_marit_cont ON cp_maritimo_contenedores(maritimo_id);

-- ─── 6. Transporte aéreo (§11) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cp_aereo (
  id                       SERIAL PRIMARY KEY,
  carta_porte_id           INTEGER     NOT NULL REFERENCES carta_porte(id) ON DELETE CASCADE,
  perm_sct                 VARCHAR(6)  NOT NULL,
  num_permiso_sct          VARCHAR(50) NOT NULL,
  matricula_aeronave       VARCHAR(10),
  nombre_aseg              VARCHAR(150),
  num_poliza_seguro        VARCHAR(30),
  numero_guia              VARCHAR(23) NOT NULL,  -- guía aérea (AWB)
  lugar_contrato           VARCHAR(150),
  codigo_transportista     VARCHAR(6)  NOT NULL,  -- c_CodigoTransporteAereo
  rfc_embarcador           VARCHAR(13),
  num_reg_id_trib_embarc   VARCHAR(40),
  residencia_fiscal_embarc VARCHAR(3),
  nombre_embarcador        VARCHAR(300),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (carta_porte_id)
);

-- ─── 7. Domicilios y participantes extranjeros (§5.2, §5.3, §12) ───────────
-- Un domicilio de EUA no cabe en las claves cortas del catálogo mexicano:
-- "Bexar County" o "Harris" no entran en VARCHAR(4). Se ensancha para que
-- quepa tanto la clave SAT como el nombre libre extranjero.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'cp_figuras' AND column_name = 'colonia'
                AND character_maximum_length < 60) THEN
    EXECUTE 'ALTER TABLE cp_figuras ALTER COLUMN colonia   TYPE VARCHAR(60)';
    EXECUTE 'ALTER TABLE cp_figuras ALTER COLUMN municipio TYPE VARCHAR(60)';
  END IF;
END $$;

ALTER TABLE cp_figuras       ADD COLUMN IF NOT EXISTS localidad VARCHAR(60);
ALTER TABLE cp_figuras       ADD COLUMN IF NOT EXISTS num_interior VARCHAR(60);
ALTER TABLE cp_figuras       ADD COLUMN IF NOT EXISTS referencia VARCHAR(500);

-- El código postal extranjero no siempre son 5 dígitos (Canadá usa "K1A 0B1").
ALTER TABLE cp_ubicaciones   ALTER COLUMN codigo_postal TYPE VARCHAR(12);
ALTER TABLE cp_figuras       ALTER COLUMN codigo_postal TYPE VARCHAR(12);

-- Estado extranjero: MEX usa 3 letras (AGU), EUA y Canadá 2 (TX, ON).
-- VARCHAR(3) ya alcanza; se deja como está.

-- Los lugares frecuentes deben poder guardar una dirección de EUA.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cp_lugares') THEN
    EXECUTE 'ALTER TABLE cp_lugares ALTER COLUMN codigo_postal TYPE VARCHAR(12)';
  END IF;
END $$;

-- ─── 8. Catálogo propio de cruces fronterizos (§8.1) ───────────────────────
-- NO es un catálogo del SAT: es una ayuda de captura. El XML sigue viajando
-- con las claves oficiales (vía, país, régimen); esto solo evita que el
-- usuario teclee "Nuevo Laredo" cada vez.
CREATE TABLE IF NOT EXISTS cp_cruce_fronterizo (
  clave      VARCHAR(10) PRIMARY KEY,
  nombre_mx  VARCHAR(80) NOT NULL,
  estado_mx  VARCHAR(3)  NOT NULL,
  nombre_us  VARCHAR(80) NOT NULL,
  estado_us  VARCHAR(3)  NOT NULL,
  activo     BOOLEAN     NOT NULL DEFAULT TRUE
);

INSERT INTO cp_cruce_fronterizo (clave, nombre_mx, estado_mx, nombre_us, estado_us) VALUES
  ('NLD-LRD', 'Nuevo Laredo',   'TAM', 'Laredo',          'TX'),
  ('CJS-ELP', 'Ciudad Juárez',  'CHH', 'El Paso',         'TX'),
  ('TIJ-OTM', 'Tijuana',        'BCN', 'Otay Mesa',       'CA'),
  ('REY-PHR', 'Reynosa',        'TAM', 'Hidalgo/Pharr',   'TX'),
  ('MAT-BRO', 'Matamoros',      'TAM', 'Brownsville',     'TX'),
  ('NOG-NOG', 'Nogales',        'SON', 'Nogales',         'AZ'),
  ('PDN-EGP', 'Piedras Negras', 'COA', 'Eagle Pass',      'TX'),
  ('MXL-CAL', 'Mexicali',       'BCN', 'Calexico',        'CA')
ON CONFLICT (clave) DO NOTHING;

-- ─── 9. Países (c_Pais) ────────────────────────────────────────────────────
-- El SAT toma este catálogo de ISO 3166-1 alfa-3 sin modificarlo, así que las
-- claves de abajo son las del estándar. Se siembran los socios comerciales de
-- México; si hace falta el catálogo completo, se reemplaza por el CSV oficial
-- del SAT con el mismo ON CONFLICT.
CREATE TABLE IF NOT EXISTS sat_cp_pais (
  clave       VARCHAR(3) PRIMARY KEY,
  descripcion VARCHAR(80) NOT NULL
);

INSERT INTO sat_cp_pais (clave, descripcion) VALUES
  ('MEX','México'),              ('USA','Estados Unidos'),      ('CAN','Canadá'),
  ('GTM','Guatemala'),           ('BLZ','Belice'),              ('SLV','El Salvador'),
  ('HND','Honduras'),            ('NIC','Nicaragua'),           ('CRI','Costa Rica'),
  ('PAN','Panamá'),              ('COL','Colombia'),            ('VEN','Venezuela'),
  ('ECU','Ecuador'),             ('PER','Perú'),                ('BOL','Bolivia'),
  ('CHL','Chile'),               ('ARG','Argentina'),           ('URY','Uruguay'),
  ('PRY','Paraguay'),            ('BRA','Brasil'),              ('CUB','Cuba'),
  ('DOM','República Dominicana'),('ESP','España'),              ('PRT','Portugal'),
  ('FRA','Francia'),             ('DEU','Alemania'),            ('ITA','Italia'),
  ('GBR','Reino Unido'),         ('IRL','Irlanda'),             ('NLD','Países Bajos'),
  ('BEL','Bélgica'),             ('CHE','Suiza'),               ('AUT','Austria'),
  ('SWE','Suecia'),              ('NOR','Noruega'),             ('DNK','Dinamarca'),
  ('FIN','Finlandia'),           ('POL','Polonia'),             ('CZE','Chequia'),
  ('HUN','Hungría'),             ('ROU','Rumania'),             ('TUR','Turquía'),
  ('RUS','Rusia'),               ('CHN','China'),               ('JPN','Japón'),
  ('KOR','Corea del Sur'),       ('TWN','Taiwán'),              ('HKG','Hong Kong'),
  ('SGP','Singapur'),            ('MYS','Malasia'),             ('THA','Tailandia'),
  ('VNM','Vietnam'),             ('IDN','Indonesia'),           ('PHL','Filipinas'),
  ('IND','India'),               ('PAK','Pakistán'),            ('BGD','Bangladés'),
  ('ARE','Emiratos Árabes Unidos'),('SAU','Arabia Saudita'),    ('ISR','Israel'),
  ('EGY','Egipto'),              ('ZAF','Sudáfrica'),           ('MAR','Marruecos'),
  ('NGA','Nigeria'),             ('AUS','Australia'),           ('NZL','Nueva Zelanda')
ON CONFLICT (clave) DO NOTHING;

-- ─── 10. Estados por país (c_Estado con dimensión de país) ─────────────────
-- sat_catalogs.c_Estado es una lista plana sin país: sirve para el CFDI, que
-- solo emite domicilios mexicanos. Meterle Texas ahí ensuciaría el catálogo
-- fiscal. Se usa una tabla aparte con PK (clave, pais), igual que ya hacen
-- sat_cp_municipio y sat_cp_localidad con (clave, estado).
--
-- Claves: México en ISO 3166-2 de 3 letras (AGU, NLE); EUA y Canadá con los
-- códigos de dos letras de USPS y Canada Post, que es lo que el SAT adopta.
CREATE TABLE IF NOT EXISTS sat_cp_estado (
  clave       VARCHAR(3)  NOT NULL,
  pais        VARCHAR(3)  NOT NULL,
  descripcion VARCHAR(80) NOT NULL,
  PRIMARY KEY (clave, pais)
);
CREATE INDEX IF NOT EXISTS ix_sat_cp_estado_pais ON sat_cp_estado(pais);

-- México: se copian de donde ya viven, para no tener dos verdades.
INSERT INTO sat_cp_estado (clave, pais, descripcion)
SELECT catalog_key, 'MEX', description FROM sat_catalogs WHERE catalog_name = 'c_Estado'
ON CONFLICT (clave, pais) DO NOTHING;

INSERT INTO sat_cp_estado (clave, pais, descripcion) VALUES
  ('AL','USA','Alabama'),        ('AK','USA','Alaska'),         ('AZ','USA','Arizona'),
  ('AR','USA','Arkansas'),       ('CA','USA','California'),     ('CO','USA','Colorado'),
  ('CT','USA','Connecticut'),    ('DE','USA','Delaware'),       ('DC','USA','District of Columbia'),
  ('FL','USA','Florida'),        ('GA','USA','Georgia'),        ('HI','USA','Hawaii'),
  ('ID','USA','Idaho'),          ('IL','USA','Illinois'),       ('IN','USA','Indiana'),
  ('IA','USA','Iowa'),           ('KS','USA','Kansas'),         ('KY','USA','Kentucky'),
  ('LA','USA','Louisiana'),      ('ME','USA','Maine'),          ('MD','USA','Maryland'),
  ('MA','USA','Massachusetts'),  ('MI','USA','Michigan'),       ('MN','USA','Minnesota'),
  ('MS','USA','Mississippi'),    ('MO','USA','Missouri'),       ('MT','USA','Montana'),
  ('NE','USA','Nebraska'),       ('NV','USA','Nevada'),         ('NH','USA','New Hampshire'),
  ('NJ','USA','New Jersey'),     ('NM','USA','New Mexico'),     ('NY','USA','New York'),
  ('NC','USA','North Carolina'), ('ND','USA','North Dakota'),   ('OH','USA','Ohio'),
  ('OK','USA','Oklahoma'),       ('OR','USA','Oregon'),         ('PA','USA','Pennsylvania'),
  ('RI','USA','Rhode Island'),   ('SC','USA','South Carolina'), ('SD','USA','South Dakota'),
  ('TN','USA','Tennessee'),      ('TX','USA','Texas'),          ('UT','USA','Utah'),
  ('VT','USA','Vermont'),        ('VA','USA','Virginia'),       ('WA','USA','Washington'),
  ('WV','USA','West Virginia'),  ('WI','USA','Wisconsin'),      ('WY','USA','Wyoming'),
  ('PR','USA','Puerto Rico'),
  ('AB','CAN','Alberta'),        ('BC','CAN','British Columbia'), ('MB','CAN','Manitoba'),
  ('NB','CAN','New Brunswick'),  ('NL','CAN','Newfoundland and Labrador'),
  ('NS','CAN','Nova Scotia'),    ('ON','CAN','Ontario'),        ('PE','CAN','Prince Edward Island'),
  ('QC','CAN','Quebec'),         ('SK','CAN','Saskatchewan'),   ('NT','CAN','Northwest Territories'),
  ('NU','CAN','Nunavut'),        ('YT','CAN','Yukon')
ON CONFLICT (clave, pais) DO NOTHING;

COMMIT;
