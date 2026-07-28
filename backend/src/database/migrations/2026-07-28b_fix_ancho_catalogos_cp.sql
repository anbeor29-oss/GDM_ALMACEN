-- ============================================================================
-- Ensanchar las columnas de catálogo que el seed no puede llenar
-- Fecha: 2026-07-28
-- ============================================================================
-- POR QUÉ EXISTE ESTA MIGRACIÓN
--
-- En una base virgen, apply-cp-seed.js reventaba en su PRIMERA sentencia:
--
--   INSERT INTO sat_cp_clave_prod_serv (clave, descripcion, material_peligroso)
--   VALUES ('01010101', 'No existe en el catálogo', 'Fondos y Valores')
--   → ERROR: el valor es demasiado largo para el tipo character varying(2)
--
-- El generador del seed corrió las columnas: en material_peligroso, que debía
-- traer la bandera '0'/'1', quedó el texto de "palabras similares" del catálogo
-- del SAT. Es el mismo tipo de error que el de codigo_postal ↔ descripcion que
-- ya arregla fix-cp-swap.js.
--
-- El daño real no era el dato, era el arranque: start:prod encadena con && , así
-- que al fallar el seed el servidor NUNCA llegaba a escuchar, Render no obtenía
-- respuesta en /health y marcaba el deploy como fallido. La versión anterior
-- seguía sirviendo, por eso el sistema parecía sano mientras los deploys
-- fallaban en silencio.
--
-- El README decía "si falla por valor demasiado largo, correr antes
-- widen-sat-cp.js", pero ese script NO está en el repo: la instrucción no se
-- podía seguir. Por eso el arreglo vive aquí, como migración: corre siempre,
-- antes del seed, sin que nadie tenga que acordarse.
--
-- Se ensancha en lugar de limpiar el dato porque el seed es la fuente y se
-- vuelve a aplicar en cada base nueva; corregirlo aquí lo arreglaría hoy y
-- volvería a romperse mañana. El dato queda feo pero cabe, y ningún flujo lo
-- usa para decidir nada: material_peligroso real se lee de sat_cp_material_
-- peligroso, y el de la mercancía lo captura el usuario en cp_mercancias.
-- ============================================================================

-- Las once columnas se encontraron comparando, sentencia por sentencia, el
-- largo máximo que el seed intenta escribir contra el ancho declarado. No se
-- fueron descubriendo de una en una a golpe de deploy fallido.
BEGIN;

-- Corrimiento de columnas del generador: donde iba una bandera o una clave
-- quedó texto del catálogo.
ALTER TABLE sat_cp_clave_prod_serv       ALTER COLUMN material_peligroso TYPE VARCHAR(600);
ALTER TABLE sat_cp_colonia               ALTER COLUMN codigo_postal      TYPE VARCHAR(60);
ALTER TABLE sat_cp_municipio             ALTER COLUMN estado             TYPE VARCHAR(60);
ALTER TABLE sat_cp_localidad             ALTER COLUMN estado             TYPE VARCHAR(60);
ALTER TABLE sat_cp_config_autotransporte ALTER COLUMN remolque           TYPE VARCHAR(60);
ALTER TABLE sat_cp_config_autotransporte ALTER COLUMN numero_llantas     TYPE VARCHAR(10);

-- Claves que el SAT publica más largas de lo que asumió el schema original.
-- config_autotransporte.clave es llave primaria y llega a 'T2S1R2' (6): el
-- schema asumió 4 y se quedaban fuera las 21 configuraciones de tractocamión
-- con semirremolque y remolque.
ALTER TABLE sat_cp_config_autotransporte    ALTER COLUMN clave            TYPE VARCHAR(12);
ALTER TABLE sat_cp_clave_unidad_peso        ALTER COLUMN nombre           TYPE VARCHAR(160);
ALTER TABLE sat_cp_num_autorizacion_naviero ALTER COLUMN clave            TYPE VARCHAR(20);
ALTER TABLE sat_cp_estaciones               ALTER COLUMN clave            TYPE VARCHAR(16);
ALTER TABLE sat_cp_contenedor_maritimo      ALTER COLUMN clave            TYPE VARCHAR(8);
ALTER TABLE sat_cp_tipo_estacion            ALTER COLUMN clave_transporte TYPE VARCHAR(16);
ALTER TABLE sat_cp_tipo_permiso             ALTER COLUMN clave_transporte TYPE VARCHAR(16);

COMMENT ON COLUMN sat_cp_clave_prod_serv.material_peligroso IS
  'El seed del SAT deja aquí texto libre por un corrimiento de columnas. No usar para decidir si algo es peligroso: para eso está sat_cp_material_peligroso y la captura de la mercancía.';

COMMIT;
