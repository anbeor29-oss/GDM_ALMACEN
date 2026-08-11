-- ============================================================================
-- AUDITORÍA — lo que el SAT dice de nuestros comprobantes
--
-- Timbrar deja el CFDI en nuestra base con estado "timbrado". Lo que el SAT
-- diga de él después ya no lo sabemos: una cancelación solicitada por el
-- receptor, un plazo que venció, un comprobante que allá aparece cancelado y
-- aquí sigue cobrándose. Esa diferencia se descubre en la revisión anual, con
-- el contador enfrente, y para entonces ya no hay margen.
--
-- Esta tabla guarda la ÚLTIMA respuesta del SAT por comprobante, más el
-- veredicto: si coincide con lo que creemos aquí o no.
--
-- POR QUÉ UNA TABLA APARTE Y NO COLUMNAS EN invoices
-- Se auditan tres documentos distintos —facturas, notas de crédito y
-- complementos de pago—, y mañana también los XML recibidos de proveedores.
-- Columnas en cada tabla obligarían a repetir la misma media docena de campos
-- cuatro veces y a que cada consulta supiera de dónde leerlas. Aquí el
-- comprobante se identifica por su UUID, que es como lo identifica el SAT.
--
-- NO ES BITÁCORA: se guarda el último estado, no el histórico. Un CFDI cambia
-- de estado dos o tres veces en su vida; conservar 200 revisiones idénticas
-- por comprobante haría lenta la única consulta que importa —"¿qué está mal
-- hoy?"— para responder una que nadie hace.
-- ============================================================================

CREATE TABLE IF NOT EXISTS auditoria_cfdi (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id           UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Qué documento es y dónde vive
  doc_type             VARCHAR(16) NOT NULL
                       CHECK (doc_type IN ('invoice', 'credit_note', 'payment')),
  doc_id               UUID NOT NULL,
  uuid                 VARCHAR(40) NOT NULL,
  serie_folio          VARCHAR(60),

  -- Lo que contestó el SAT, tal cual
  estado_sat           VARCHAR(30),        -- Vigente / Cancelado / No Encontrado
  es_cancelable        VARCHAR(40),
  estatus_cancelacion  VARCHAR(60),        -- 'En proceso' = esperando al receptor
  codigo_estatus       VARCHAR(120),
  validacion_efos      VARCHAR(30),        -- 100 = el emisor NO está en listas 69-B
  resumen              TEXT,

  -- Lo que creíamos aquí, y el veredicto
  estado_local         VARCHAR(20),
  discrepancia         BOOLEAN NOT NULL DEFAULT false,

  error_consulta       TEXT,               -- el SAT no respondió: no dice nada del CFDI
  revisiones           INT NOT NULL DEFAULT 0,
  primera_revision     TIMESTAMP NOT NULL DEFAULT NOW(),
  ultima_revision      TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Un comprobante, un renglón: el UUID es único en todo el país.
  UNIQUE (company_id, uuid)
);

/* La consulta que se hace todo el tiempo es "¿qué no cuadra?". Un índice
 * parcial sobre las discrepancias la responde sin recorrer toda la tabla, que
 * con el tiempo tendrá un renglón por cada CFDI que la empresa haya emitido. */
CREATE INDEX IF NOT EXISTS idx_auditoria_discrepancias
  ON auditoria_cfdi (company_id, ultima_revision DESC)
  WHERE discrepancia = true;

/* Y la que hace el cron: a quién le toca revisión. */
CREATE INDEX IF NOT EXISTS idx_auditoria_ultima_revision
  ON auditoria_cfdi (company_id, ultima_revision);

CREATE INDEX IF NOT EXISTS idx_auditoria_doc
  ON auditoria_cfdi (doc_type, doc_id);

COMMENT ON TABLE auditoria_cfdi IS
  'Último estado de cada CFDI ante el SAT, y si coincide con el estado local.';

COMMENT ON COLUMN auditoria_cfdi.validacion_efos IS
  'Respuesta del SAT sobre listas del 69-B del CFF. "100" significa que el '
  'emisor NO aparece en la lista definitiva de operaciones inexistentes.';

COMMENT ON COLUMN auditoria_cfdi.discrepancia IS
  'true = lo que dice el SAT no coincide con el estado que tenemos aquí. '
  'Es la única columna que hay que mirar todos los días.';
