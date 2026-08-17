-- ============================================================================
-- 69-B — LO QUE ENSEÑÓ EL ARCHIVO DE VERDAD
--
-- La tabla se dimensionó a ojo y el importador nunca se había corrido contra la
-- publicación real del SAT. Al hacerlo —14,540 renglones, 4.7 MB— reventó con
-- un 22001 "value too long", y midiendo el archivo salieron los anchos reales:
--
--   · Nombre del contribuyente ......... 587 caracteres  (la columna tenía 400)
--     No es un nombre largo: es el texto "Información suprimida atendiendo a lo
--     resuelto en el oficio 500-68-… conforme a los artículos …", que el SAT
--     pone en lugar del nombre cuando hay una suspensión.
--
--   · Oficio de definitivos ............ 148 caracteres  (la columna tenía 120)
--     Tampoco es un oficio largo: son VARIOS oficios concatenados con "//",
--     porque a un contribuyente lo pueden publicar como definitivo más de una
--     vez, y la publicación acumula todos.
--
-- POR QUÉ TEXT Y NO UN VARCHAR MÁS GRANDE
-- Porque el ancho no lo decidimos nosotros: lo decide una publicación que
-- cambia cada mes y que ya demostró que crece. Poner VARCHAR(600) sería repetir
-- el mismo error con otro número y volver a reventar el día que el SAT
-- concatene un oficio más. En Postgres TEXT no cuesta nada frente a VARCHAR(n):
-- es el mismo tipo por dentro, sin la comprobación de longitud.
--
-- El RFC se queda en VARCHAR(13) a propósito: ése sí tiene un largo definido
-- por ley, y que un renglón traiga algo más largo significa que el archivo está
-- mal, no que la columna esté corta.
-- ============================================================================

ALTER TABLE sat_69b ALTER COLUMN nombre            TYPE TEXT;
ALTER TABLE sat_69b ALTER COLUMN oficio_presuncion TYPE TEXT;
ALTER TABLE sat_69b ALTER COLUMN oficio_definitivo TYPE TEXT;

/* La fecha que se guarda tiene que ser la de la etapa en la que está el
 * contribuyente: enseñar la publicación de "presuntos" junto a un DEFINITIVO
 * es enseñar una fecha que ya no es la que importa. Se agrega la de sentencia
 * favorable, que hasta ahora no se guardaba y es la que dice desde cuándo salió
 * de la lista. */
ALTER TABLE sat_69b ADD COLUMN IF NOT EXISTS oficio_sentencia TEXT;

COMMENT ON COLUMN sat_69b.oficio_definitivo IS
  'Oficio(s) de definitivos, tal como los publica el SAT. Pueden venir varios '
  'concatenados con "//" cuando al contribuyente lo publicaron más de una vez.';

COMMENT ON COLUMN sat_69b.publicacion_dof IS
  'Fecha de publicación en el DOF de la etapa en la que está el contribuyente. '
  'Cuando la publicación trae varias fechas, se guarda la MÁS RECIENTE: es la '
  'que fija su situación actual.';
