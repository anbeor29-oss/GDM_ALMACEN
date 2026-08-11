-- ============================================================================
-- DESCARGA MASIVA DEL SAT — el motor que trae los XML que NOS emitieron
--
-- Base: DESCARGA_MASIVA_SAT_Y_SERVICIOS.md §9 (modelo de datos mínimo).
--
-- QUÉ RESUELVE, Y POR QUÉ NO BASTABA LO QUE YA HABÍA
-- El módulo de Auditoría pregunta por comprobante: "este UUID, ¿sigue vigente?".
-- Sirve para lo NUESTRO, que ya está en la base. Pero de lo que nos emitieron
-- —las facturas de proveedores— no sabemos ni siquiera cuáles existen. Eso sólo
-- se puede traer con el servicio de descarga masiva, que exige e.firma y trabaja
-- por lotes asíncronos: se pide, se espera, se recoge.
--
-- LAS CUATRO TABLAS SON EL ESTADO DE UN PROCESO LARGO
-- Una descarga de un año puede tardar horas y atravesar reinicios del servidor.
-- Sin estas tablas, un `npm restart` a media descarga perdería las solicitudes
-- ya aceptadas por el SAT —que no se pueden repetir sin que las rechace por
-- duplicadas— y habría que esperar a que venzan para volver a empezar.
--
-- SOBRE LA e.firma GUARDADA
-- La llave privada de la e.firma tiene efectos jurídicos de firma autógrafa
-- (§20 del documento). Aquí se guarda CIFRADA con AES-256-GCM y una llave
-- maestra que vive fuera de la base (SAT_VAULT_KEY). No se puede volver a
-- descargar por ninguna ruta: entra, se usa, y se borra cuando el trabajo
-- termina si así se pidió. El servicio del SAT obliga a firmar cada solicitud y
-- cada verificación, así que no hay forma de hacer esto sin conservarla
-- mientras el trabajo viva.
-- ============================================================================

-- ─── Credenciales: la e.firma cifrada ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS sat_credenciales (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rfc                   VARCHAR(13) NOT NULL,

  -- Lo que se leyó del certificado, para poder avisar ANTES de que falle
  numero_serie          VARCHAR(40),
  vigencia_desde        TIMESTAMP,
  vigencia_hasta        TIMESTAMP,

  -- Los archivos, cifrados. Nunca salen por una ruta HTTP.
  cer_cifrado           TEXT NOT NULL,
  key_cifrado           TEXT NOT NULL,
  password_cifrado      TEXT NOT NULL,

  estado                VARCHAR(16) NOT NULL DEFAULT 'ACTIVA'
                        CHECK (estado IN ('ACTIVA', 'VENCIDA', 'BORRADA')),
  borrar_al_terminar    BOOLEAN NOT NULL DEFAULT true,
  cargada_por           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Una e.firma vigente por empresa: dos serían dos verdades sobre quién firma.
  UNIQUE (company_id, rfc)
);

COMMENT ON TABLE sat_credenciales IS
  'e.firma cifrada con AES-256-GCM (llave maestra en SAT_VAULT_KEY, fuera de '
  'la base). No existe endpoint que la devuelva.';

-- ─── Trabajos: "tráeme lo recibido de enero" ───────────────────────────────
CREATE TABLE IF NOT EXISTS sat_trabajos (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rfc                   VARCHAR(13) NOT NULL,

  fecha_desde           DATE NOT NULL,
  fecha_hasta           DATE NOT NULL,
  direccion             VARCHAR(10) NOT NULL CHECK (direccion IN ('recibidos', 'emitidos')),
  tipo                  VARCHAR(10) NOT NULL DEFAULT 'CFDI'
                        CHECK (tipo IN ('CFDI', 'Metadata')),
  filtros               JSONB,

  estado                VARCHAR(20) NOT NULL DEFAULT 'CREADO'
                        CHECK (estado IN ('CREADO', 'EN_PROCESO', 'TERMINADO',
                                          'CON_ERRORES', 'CANCELADO')),
  particiones_total     INT NOT NULL DEFAULT 0,
  particiones_listas    INT NOT NULL DEFAULT 0,
  paquetes_total        INT NOT NULL DEFAULT 0,
  xml_total             INT NOT NULL DEFAULT 0,
  mensaje               TEXT,

  creado_por            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  iniciado_at           TIMESTAMP,
  terminado_at          TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_sat_trabajos_empresa
  ON sat_trabajos (company_id, created_at DESC);

-- ─── Particiones: cada solicitud que se le manda al SAT ────────────────────
CREATE TABLE IF NOT EXISTS sat_particiones (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trabajo_id            UUID NOT NULL REFERENCES sat_trabajos(id) ON DELETE CASCADE,

  desde                 TIMESTAMP NOT NULL,
  hasta                 TIMESTAMP NOT NULL,
  /* Profundidad de corte: 0 = el rango original, 1 = mitades, 2 = cuartos…
   * Sirve para frenar la partición antes de llegar a rangos absurdos. */
  profundidad           INT NOT NULL DEFAULT 0,

  /* Huella única de la solicitud (§5 "regla de no duplicidad"). El SAT rechaza
   * solicitudes idénticas repetidas, así que se comprueba ANTES de mandarla. */
  huella                VARCHAR(64) NOT NULL,

  estado                VARCHAR(24) NOT NULL DEFAULT 'PENDIENTE'
                        CHECK (estado IN ('PENDIENTE', 'SOLICITADA', 'EN_PROCESO',
                                          'TERMINADA', 'SIN_DATOS', 'DIVIDIDA',
                                          'VENCIDA', 'RECHAZADA', 'FALLIDA')),
  id_solicitud_sat      VARCHAR(64),
  codigo_sat            VARCHAR(16),
  mensaje_sat           TEXT,
  cfdi_contados         INT,

  intentos              INT NOT NULL DEFAULT 0,
  proxima_consulta_at   TIMESTAMP,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),

  /* Dos particiones del mismo trabajo no pueden pedir lo mismo. */
  UNIQUE (trabajo_id, huella)
);

CREATE INDEX IF NOT EXISTS ix_sat_particiones_pendientes
  ON sat_particiones (estado, proxima_consulta_at);

COMMENT ON COLUMN sat_particiones.huella IS
  'RFC + rango + dirección + tipo + filtros. Evita mandar dos veces la misma '
  'solicitud, que el SAT rechaza por duplicada.';

-- ─── Paquetes: los ZIP que el SAT deja listos ──────────────────────────────
CREATE TABLE IF NOT EXISTS sat_paquetes (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  particion_id          UUID NOT NULL REFERENCES sat_particiones(id) ON DELETE CASCADE,
  id_paquete_sat        VARCHAR(80) NOT NULL,

  estado                VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
                        CHECK (estado IN ('PENDIENTE', 'DESCARGANDO', 'DESCARGADO',
                                          'EXTRAIDO', 'VENCIDO', 'FALLIDO')),
  sha256                VARCHAR(64),
  bytes                 BIGINT,
  xml_extraidos         INT NOT NULL DEFAULT 0,
  intentos              INT NOT NULL DEFAULT 0,
  mensaje               TEXT,
  descargado_at         TIMESTAMP,
  /* El SAT vence los paquetes ~72 h después de generarlos (§6): por eso la
   * descarga tiene prioridad sobre crear solicitudes nuevas. */
  vence_at              TIMESTAMP,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE (particion_id, id_paquete_sat)
);

-- ─── El resultado: los comprobantes indexados ──────────────────────────────
CREATE TABLE IF NOT EXISTS cfdi_recibidos (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rfc_propietario       VARCHAR(13) NOT NULL,
  uuid                  VARCHAR(40) NOT NULL,

  direccion             VARCHAR(10) NOT NULL,
  tipo_comprobante      VARCHAR(2),
  serie                 VARCHAR(30),
  folio                 VARCHAR(40),
  fecha_emision         TIMESTAMP,
  fecha_timbrado        TIMESTAMP,

  rfc_emisor            VARCHAR(13),
  nombre_emisor         VARCHAR(300),
  rfc_receptor          VARCHAR(13),
  nombre_receptor       VARCHAR(300),

  subtotal              NUMERIC(18,2),
  descuento             NUMERIC(18,2),
  total                 NUMERIC(18,2),
  moneda                VARCHAR(3),
  tipo_cambio           NUMERIC(18,6),
  forma_pago            VARCHAR(3),
  metodo_pago           VARCHAR(3),
  uso_cfdi              VARCHAR(5),

  estado_sat            VARCHAR(20),
  xml                   TEXT,
  xml_sha256            VARCHAR(64),
  paquete_id            UUID REFERENCES sat_paquetes(id) ON DELETE SET NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),

  /* La llave del documento §9: un UUID no se repite en todo el país, pero el
   * mismo comprobante puede llegar en dos paquetes distintos —o volver a
   * descargarse—. Sin esto, cada re-descarga duplicaría el mes entero. */
  UNIQUE (company_id, rfc_propietario, uuid)
);

CREATE INDEX IF NOT EXISTS ix_cfdi_recibidos_mes
  ON cfdi_recibidos (company_id, fecha_emision DESC);
CREATE INDEX IF NOT EXISTS ix_cfdi_recibidos_emisor
  ON cfdi_recibidos (company_id, rfc_emisor);

COMMENT ON TABLE cfdi_recibidos IS
  'CFDI traídos del SAT por descarga masiva. Es la base de la pantalla de '
  'comprobantes recibidos del mes y, más adelante, de la contabilidad.';
