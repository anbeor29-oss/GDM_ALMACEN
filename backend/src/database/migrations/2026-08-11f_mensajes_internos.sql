-- ============================================================================
-- MENSAJERÍA INTERNA — recados entre la gente de la misma empresa
--
-- LO QUE SE REVISÓ ANTES DE DECIDIR LA FORMA
-- `users` ya tiene todo lo necesario: correo, nombre, company_id, grupo de
-- trabajo y si está activo. El "mismo dominio" del que se habló es, en los
-- datos, el mismo `company_id`: los usuarios de una empresa comparten dominio
-- de correo porque el alta los crea así (el cajero de un almacén hereda el
-- dominio de quien lo dio de alta). Filtrar por texto del correo sería frágil
-- —un contador externo con Gmail quedaría fuera de su propia empresa— así que
-- la frontera es la empresa, que además es la que ya respeta todo el sistema.
--
-- POR QUÉ TAN POCAS COLUMNAS
-- Esto no es un chat ni un correo: es el recado que hoy se grita entre el
-- almacén y la oficina, o que se manda por WhatsApp y se pierde. Sin adjuntos,
-- sin grupos, sin borradores. Cada una de esas cosas trae su propia pantalla y
-- su propia forma de fallar, y ninguna resuelve el problema de que "ya salió el
-- camión" no le llegue a quien factura.
--
-- EL REMITENTE SE CONGELA EN EL RENGLÓN
-- `de_nombre` y `de_email` se copian al enviar. Si mañana esa persona se da de
-- baja, el mensaje que recibiste sigue diciendo quién te lo mandó; con sólo la
-- llave foránea, se quedaría en blanco justo cuando hay que rastrear qué se
-- dijo y quién lo dijo.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mensajes_internos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  de_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  de_nombre     VARCHAR(200),
  de_email      VARCHAR(255),

  para_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  para_nombre   VARCHAR(200),
  para_email    VARCHAR(255),

  asunto        VARCHAR(150),
  cuerpo        TEXT NOT NULL,

  /* Respuesta a otro mensaje. ON DELETE SET NULL: si el original desaparece,
   * la respuesta no se lleva consigo lo que alguien contestó. */
  responde_a    UUID REFERENCES mensajes_internos(id) ON DELETE SET NULL,

  leido_at      TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

/* La consulta de todos los días: mi bandeja, lo nuevo arriba. */
CREATE INDEX IF NOT EXISTS ix_mensajes_bandeja
  ON mensajes_internos (company_id, para_user_id, created_at DESC);

/* Y la del contador del menú, que corre cada minuto en cada sesión abierta:
 * índice parcial para que sólo recorra lo que de verdad está sin leer. */
CREATE INDEX IF NOT EXISTS ix_mensajes_no_leidos
  ON mensajes_internos (para_user_id)
  WHERE leido_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_mensajes_enviados
  ON mensajes_internos (company_id, de_user_id, created_at DESC);

COMMENT ON TABLE mensajes_internos IS
  'Recados entre usuarios de la misma empresa. No es chat ni correo: sin '
  'adjuntos, sin grupos, sin borradores.';

COMMENT ON COLUMN mensajes_internos.de_nombre IS
  'Nombre del remitente congelado al enviar: si se da de baja, el mensaje '
  'sigue diciendo quién lo mandó.';
