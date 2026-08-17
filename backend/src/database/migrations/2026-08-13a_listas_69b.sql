-- ============================================================================
-- LISTAS DEL ARTÍCULO 69-B DEL CFF — con quién NO conviene tener operaciones
--
-- QUÉ SON
-- El SAT publica los contribuyentes que presuntamente emitieron comprobantes
-- sin contar con activos, personal o infraestructura para prestar los servicios
-- que amparan. La lista tiene cuatro situaciones y la diferencia entre ellas es
-- todo:
--
--   · PRESUNTO   — el SAT lo señaló y el contribuyente tiene plazo para
--                  desvirtuar. Todavía no hay consecuencia.
--   · DESVIRTUADO— aclaró y salió. Sus comprobantes valen.
--   · DEFINITIVO — no aclaró. Sus comprobantes NO producen efecto fiscal, y
--                  quien los dedujo tiene 30 días para corregir o acreditar la
--                  materialidad de la operación.
--   · SENTENCIA FAVORABLE — un tribunal lo sacó.
--
-- Mezclarlas sería el peor error de este módulo: tratar a un presunto como
-- definitivo alarma sin motivo, y tratar a un definitivo como presunto deja
-- pasar el que sí cuesta dinero.
--
-- POR QUÉ LA LISTA ES GLOBAL Y NO POR EMPRESA
-- Es un padrón nacional: el mismo RFC está en la lista para todos. Guardarla
-- por empresa la duplicaría tantas veces como clientes tenga la plataforma y,
-- peor, permitiría que una empresa tuviera la lista de enero y otra la de
-- marzo. El CRUCE sí es por empresa; la lista, no.
--
-- DE DÓNDE SALEN LOS DATOS
-- Del archivo que publica el SAT. **No se inventa ni se deduce**: se carga. Un
-- señalamiento del 69-B tiene consecuencias fiscales serias y no puede salir de
-- una suposición del sistema.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sat_69b (
  rfc                 VARCHAR(13) PRIMARY KEY,
  nombre              VARCHAR(400),

  situacion           VARCHAR(24) NOT NULL
                      CHECK (situacion IN ('PRESUNTO', 'DESVIRTUADO',
                                           'DEFINITIVO', 'SENTENCIA_FAVORABLE')),

  -- Los oficios y fechas de cada etapa, tal como vienen en la publicación.
  oficio_presuncion   VARCHAR(120),
  fecha_presuncion    DATE,
  oficio_definitivo   VARCHAR(120),
  fecha_definitivo    DATE,
  publicacion_dof     DATE,

  /* Cuándo se cargó este renglón. Sirve para saber de qué corte es la lista:
   * una lista vieja da una falsa tranquilidad, y sin esta fecha no hay forma
   * de notarlo. */
  actualizado_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_sat_69b_situacion ON sat_69b (situacion);

COMMENT ON TABLE sat_69b IS
  'Padrón nacional del artículo 69-B del CFF, cargado del archivo que publica '
  'el SAT. Global, no por empresa: el mismo RFC está en la lista para todos.';

COMMENT ON COLUMN sat_69b.situacion IS
  'DEFINITIVO es el que quita efectos fiscales a los comprobantes. PRESUNTO '
  'todavía está en plazo de aclaración; DESVIRTUADO y SENTENCIA_FAVORABLE '
  'salieron de la lista.';

-- ----------------------------------------------------------------------------
-- Bitácora de cargas: qué archivo, cuándo y cuántos renglones.
--
-- Sin esto, "la lista está al día" es una creencia. Con esto es una fecha.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sat_69b_cargas (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  archivo       VARCHAR(300),
  renglones     INT NOT NULL DEFAULT 0,
  nuevos        INT NOT NULL DEFAULT 0,
  actualizados  INT NOT NULL DEFAULT 0,
  cargado_por   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
