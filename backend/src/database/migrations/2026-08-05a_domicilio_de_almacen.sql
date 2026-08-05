-- ============================================================================
-- DOMICILIO DEL ALMACÉN EN CAMPOS SEPARADOS
--
-- POR QUÉ
-- `warehouses.address` era un solo texto libre: "agustinos, 120, aguascalientes,
-- aguascalientes". Sirve para verlo en pantalla y para nada más. No se puede
-- filtrar por estado, no se puede saber si dos almacenes están en el mismo
-- municipio, y sobre todo no se puede reusar para un complemento Carta Porte,
-- donde el SAT exige colonia, municipio y estado como CLAVES de catálogo, no
-- como palabras.
--
-- Con el CP capturado, el catálogo SAT ya cargado resuelve colonia, municipio y
-- estado solo. Quien da de alta un almacén termina escribiendo calle y número.
--
-- `address` NO SE BORRA
-- Se conserva y se sigue llenando con el domicilio armado. Media docena de
-- pantallas y reportes leen esa columna; vaciarla los dejaría mostrando un
-- hueco. Aquí es la versión legible, y las columnas nuevas son la estructurada.
-- Los almacenes que ya existen se quedan con su texto y sin desglose: no se
-- intenta adivinarlo partiendo la cadena por comas, porque "agustinos, 120,
-- aguascalientes, aguascalientes" y "calle 5 de mayo 3, centro" no tienen la
-- misma forma, y un desglose inventado es peor que ninguno — se ve correcto y
-- nadie lo revisa.
-- ============================================================================

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS postal_code  VARCHAR(5),
  ADD COLUMN IF NOT EXISTS street       VARCHAR(200),
  ADD COLUMN IF NOT EXISTS ext_number   VARCHAR(30),
  ADD COLUMN IF NOT EXISTS int_number   VARCHAR(30),
  ADD COLUMN IF NOT EXISTS colonia      VARCHAR(150),
  ADD COLUMN IF NOT EXISTS municipio    VARCHAR(150),
  /* Clave SAT de dos o tres letras (AGU, JAL, NLE), no el nombre: es lo que
   * pide el Anexo 20 y lo que devuelve el catálogo. El nombre para leer se
   * resuelve al vuelo desde c_Estado. */
  ADD COLUMN IF NOT EXISTS estado       VARCHAR(5);

/* Buscar los almacenes de un estado o un municipio es la consulta natural en
 * cuanto hay más de tres bodegas. */
CREATE INDEX IF NOT EXISTS idx_warehouses_estado
  ON warehouses(company_id, estado) WHERE deleted_at IS NULL;

COMMENT ON COLUMN warehouses.address IS
  'Domicilio armado, para mostrar. Se llena solo a partir de los campos '
  'estructurados; los almacenes anteriores a 2026-08-05 conservan su captura libre.';
COMMENT ON COLUMN warehouses.estado IS
  'Clave SAT del estado (AGU, JAL, NLE…), no el nombre. Es lo que exige el Anexo 20.';
