/*
 * Los catálogos de colonia, municipio y localidad traían las columnas cruzadas.
 *
 * QUÉ ESTABA MAL
 * En sat_cp_colonia, la columna `codigo_postal` guardaba el NOMBRE de la
 * colonia y `descripcion` el código postal:
 *
 *     clave=0015  descripcion=20900  codigo_postal=Puerta Norte
 *
 * En sat_cp_municipio y sat_cp_localidad, lo mismo entre `estado` y
 * `descripcion`: `estado` traía "Santo Domingo Tehuantepec" y `descripcion`
 * traía "OAX".
 *
 * CÓMO SE DESCUBRIÓ
 * El combo de colonias del expediente del trabajador nunca se llenaba. Buscar
 * el CP 20900 en `codigo_postal` daba cero filas —mientras la tabla tenía
 * 144,724 renglones— y al mirar los datos se vio que ahí vivían nombres como
 * "Y Griega" y "Zurumútaro". Aguascalientes reportaba UN municipio.
 *
 * A QUÉ AFECTABA
 * A todo lo que resuelve un domicilio: el autofill de Lugares de Carta Porte,
 * el importador de XML de CP —que traduce claves a nombres— y el PDF de
 * facturas, que imprime colonia y municipio. Ninguno compensaba el cruce:
 * todos leen `descripcion` esperando el nombre, así que todos devolvían vacío
 * o el dato equivocado.
 *
 * POR QUÉ NO SE PUEDE HACER CON UN UPDATE
 * La llave primaria es (clave, codigo_postal), y al voltear las columnas dos
 * filas distintas chocan a media tabla: Postgres verifica la unicidad renglón
 * por renglón, no al final. El primer intento murió con
 * "llave duplicada (clave, codigo_postal)=(0001, 01000)".
 *
 * Así que las filas mal puestas se sacan a una tabla aparte, se borran, y se
 * vuelven a meter ya volteadas. En ese momento la tabla no tiene ninguna de
 * ellas, y no hay con qué chocar.
 *
 * POR QUÉ ES CONDICIONAL
 * Sólo se tocan las filas con el patrón del error —el CP en `descripcion` y
 * algo que no es un CP en `codigo_postal`—, para que correr esto dos veces, o
 * sobre una base cargada bien, no las vuelva a cruzar. Un swap incondicional
 * desharía su propia corrección en la segunda corrida.
 */

/* ── Colonias ── */
CREATE TEMP TABLE _colonias_cruzadas ON COMMIT DROP AS
  SELECT clave, codigo_postal, descripcion
    FROM sat_cp_colonia
   WHERE descripcion ~ '^[0-9]{5}$'
     AND (codigo_postal IS NULL OR codigo_postal !~ '^[0-9]{5}$');

DELETE FROM sat_cp_colonia c
 USING _colonias_cruzadas t
 WHERE c.clave = t.clave AND c.codigo_postal = t.codigo_postal;

INSERT INTO sat_cp_colonia (clave, codigo_postal, descripcion)
  SELECT clave, descripcion, codigo_postal FROM _colonias_cruzadas
  ON CONFLICT (clave, codigo_postal) DO NOTHING;

/* ── Municipios ──
 * La clave de estado son dos a cuatro letras mayúsculas (AGU, OAX, CDMX); el
 * nombre de un municipio nunca lo es. */
CREATE TEMP TABLE _municipios_cruzados ON COMMIT DROP AS
  SELECT clave, estado, descripcion
    FROM sat_cp_municipio
   WHERE descripcion ~ '^[A-Z]{2,4}$'
     AND (estado IS NULL OR estado !~ '^[A-Z]{2,4}$');

DELETE FROM sat_cp_municipio m
 USING _municipios_cruzados t
 WHERE m.clave = t.clave AND m.estado = t.estado;

INSERT INTO sat_cp_municipio (clave, estado, descripcion)
  SELECT clave, descripcion, estado FROM _municipios_cruzados
  ON CONFLICT (clave, estado) DO NOTHING;

/* ── Localidades ── */
CREATE TEMP TABLE _localidades_cruzadas ON COMMIT DROP AS
  SELECT clave, estado, descripcion
    FROM sat_cp_localidad
   WHERE descripcion ~ '^[A-Z]{2,4}$'
     AND (estado IS NULL OR estado !~ '^[A-Z]{2,4}$');

DELETE FROM sat_cp_localidad l
 USING _localidades_cruzadas t
 WHERE l.clave = t.clave AND l.estado = t.estado;

INSERT INTO sat_cp_localidad (clave, estado, descripcion)
  SELECT clave, descripcion, estado FROM _localidades_cruzadas
  ON CONFLICT (clave, estado) DO NOTHING;

COMMENT ON COLUMN sat_cp_colonia.codigo_postal IS
  'El código postal de cinco dígitos. Estuvo cruzado con descripcion hasta la '
  'migración 2026-08-18e.';
COMMENT ON COLUMN sat_cp_colonia.descripcion IS
  'El nombre de la colonia.';
COMMENT ON COLUMN sat_cp_municipio.estado IS
  'La clave del estado (AGU, OAX, CDMX). Estuvo cruzada con descripcion.';
