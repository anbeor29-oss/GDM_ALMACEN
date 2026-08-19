/*
 * Las cuatro filas que el arreglo del catálogo no alcanzó a voltear.
 *
 * QUÉ QUEDÓ
 * La migración 2026-08-18e enderezó 144,720 colonias y 2,454 municipios, pero
 * en producción quedaron 3 colonias y 1 municipio con las columnas cruzadas.
 *
 * POR QUÉ QUEDARON
 * El arreglo saca las filas mal puestas, las borra y las reinserta volteadas
 * con `ON CONFLICT DO NOTHING`. Ese DO NOTHING existe para no tronar, pero
 * también se traga las que chocan ENTRE ELLAS: si dos filas distintas, al
 * voltearse, aterrizan en la misma (clave, codigo_postal), la segunda se
 * descarta en silencio. Cuatro de casi 150,000, pero descartadas sin avisar —
 * que es lo que hace peligroso al DO NOTHING.
 *
 * QUÉ SE HACE CON ELLAS
 * No se pueden reinsertar con su llave: ya está ocupada por la que sí entró.
 * Y no se pueden inventar: no sabemos cuál de las dos era la buena. Se BORRAN,
 * porque una fila con el CP en la columna del nombre no sirve para nada —no la
 * encuentra ninguna búsqueda— y en cambio sí ensucia las comprobaciones y
 * puede colarse en un combo con un nombre que es un número.
 *
 * Son cuatro renglones de un catálogo de 147,000: ninguna búsqueda por código
 * postal las estaba encontrando ya.
 */

DELETE FROM sat_cp_colonia
 WHERE descripcion ~ '^[0-9]{5}$'
   AND (codigo_postal IS NULL OR codigo_postal !~ '^[0-9]{5}$');

DELETE FROM sat_cp_municipio
 WHERE descripcion ~ '^[A-Z]{2,4}$'
   AND (estado IS NULL OR estado !~ '^[A-Z]{2,4}$');

DELETE FROM sat_cp_localidad
 WHERE descripcion ~ '^[A-Z]{2,4}$'
   AND (estado IS NULL OR estado !~ '^[A-Z]{2,4}$');
