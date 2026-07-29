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

-- Cada ensanche va GUARDADO por la existencia de su columna.
--
-- La primera versión llevaba doce ALTER TABLE a pelo. En base virgen funciona,
-- porque las migraciones de Carta Porte crean esas tablas antes. En la base de
-- producción de facturación NO: ahí los despliegues de CP habían fallado,
-- faltaba alguna de esas tablas, y el ALTER moría con "relation does not
-- exist". Como start:prod encadena con &&, migrate-up salía con código 1 y el
-- servidor nunca arrancaba — Render lo reporta como "Exited with status 1
-- while running your code".
--
-- Una migración que corre sobre bases en estados distintos no puede dar por
-- hecho lo que hay. Si la columna aún no existe no hay nada que ensanchar: la
-- migración que la cree ya la creará con el ancho correcto.
DO $$
DECLARE
  objetivo RECORD;
BEGIN
  FOR objetivo IN
    SELECT * FROM (VALUES
      -- Corrimiento de columnas del generador: donde iba una bandera o una
      -- clave quedó texto del catálogo.
      ('sat_cp_clave_prod_serv',       'material_peligroso', 'VARCHAR(600)'),
      ('sat_cp_colonia',               'codigo_postal',      'VARCHAR(60)'),
      ('sat_cp_municipio',             'estado',             'VARCHAR(60)'),
      ('sat_cp_localidad',             'estado',             'VARCHAR(60)'),
      ('sat_cp_config_autotransporte', 'remolque',           'VARCHAR(60)'),
      ('sat_cp_config_autotransporte', 'numero_llantas',     'VARCHAR(10)'),
      -- Claves que el SAT publica más largas de lo que asumió el schema.
      -- config_autotransporte.clave es llave primaria y llega a 'T2S1R2' (6):
      -- el schema asumió 4 y dejaba fuera las 21 configuraciones de
      -- tractocamión con semirremolque y remolque.
      ('sat_cp_config_autotransporte',    'clave',            'VARCHAR(12)'),
      ('sat_cp_clave_unidad_peso',        'nombre',           'VARCHAR(160)'),
      ('sat_cp_num_autorizacion_naviero', 'clave',            'VARCHAR(20)'),
      ('sat_cp_estaciones',               'clave',            'VARCHAR(16)'),
      ('sat_cp_contenedor_maritimo',      'clave',            'VARCHAR(8)'),
      ('sat_cp_tipo_estacion',            'clave_transporte', 'VARCHAR(16)'),
      ('sat_cp_tipo_permiso',             'clave_transporte', 'VARCHAR(16)')
    ) AS t(tabla, columna, tipo)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = objetivo.tabla AND column_name = objetivo.columna
    ) THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE %s',
                     objetivo.tabla, objetivo.columna, objetivo.tipo);
    ELSE
      RAISE NOTICE '[ancho-cp] %.% aún no existe — se omite',
                   objetivo.tabla, objetivo.columna;
    END IF;
  END LOOP;
END $$;

-- El COMMENT también va guardado: sobre una tabla inexistente aborta igual que
-- un ALTER, y sería absurdo tumbar un arranque por un comentario.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'sat_cp_clave_prod_serv' AND column_name = 'material_peligroso'
  ) THEN
    COMMENT ON COLUMN sat_cp_clave_prod_serv.material_peligroso IS
      'El seed del SAT deja aquí texto libre por un corrimiento de columnas. No usar para decidir si algo es peligroso: para eso está sat_cp_material_peligroso y la captura de la mercancía.';
  END IF;
END $$;

COMMIT;
