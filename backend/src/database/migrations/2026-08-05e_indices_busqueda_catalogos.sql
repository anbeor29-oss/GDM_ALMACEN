-- ============================================================================
-- BÚSQUEDA DE CATÁLOGOS SAT: DE 442 ms A 3 ms POR TECLA
--
-- EL PROBLEMA
-- El buscador de catálogos filtra así:
--
--   translate(lower(descripcion), 'áé…', 'ae…') LIKE '%tornillo%'
--
-- Dos cosas impiden usar un índice, y las dos a la vez:
--   1. La función envuelve la COLUMNA. Un índice sobre `descripcion` no sirve
--      para consultar `translate(lower(descripcion))`: para Postgres son
--      expresiones distintas.
--   2. El comodín va al PRINCIPIO. Un índice btree ordena por el inicio del
--      texto, así que '%tornillo%' no puede aprovecharlo aunque existiera.
--
-- Resultado: cada tecla que alguien escribe en el buscador provoca un barrido
-- completo de la tabla. En `sat_cp_clave_prod_serv` son 48,757 renglones; en
-- `sat_cp_colonia`, 144,724. Medido en local: 442 ms por búsqueda, y en Render
-- se suma la latencia de red. Por eso "está lento al desplegar los catálogos".
--
-- LA SOLUCIÓN
-- Índices GIN de trigramas (pg_trgm) sobre LA MISMA EXPRESIÓN que usa la
-- consulta. Los trigramas parten el texto en grupos de tres letras, de modo
-- que buscar en medio de una palabra sí es indexable.
--
-- La expresión del índice tiene que coincidir LETRA POR LETRA con la del
-- código —mismas cadenas de acentos, mismo orden—. Si alguien toca los
-- caracteres de `sinAcentos` en carta-porte-catalogs.routes.ts, estos índices
-- dejan de usarse en silencio: no falla nada, sólo vuelve a ir lento.
--
-- Medido antes y después en una base con los catálogos cargados:
--   5 búsquedas de "tornillo"  →  2,212 ms  ·  14 ms
--
-- SI pg_trgm NO SE PUEDE INSTALAR
-- La migración no aborta. El módulo eligió `translate()` en vez de la
-- extensión `unaccent` precisamente porque en un Postgres administrado
-- CREATE EXTENSION puede estar prohibido; el mismo cuidado aplica aquí. Sin la
-- extensión, todo sigue funcionando exactamente como hoy —lento, pero
-- correcto— y el aviso queda en el log del despliegue.
-- ============================================================================

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm no se pudo instalar (%). Los catálogos seguirán buscando sin índice.', SQLERRM;
END $$;

DO $$
DECLARE
  acentos CONSTANT text := 'áéíóúÁÉÍÓÚàèìòùÀÈÌÒÙäëïöüÄËÏÖÜâêîôûÂÊÎÔÛñÑçÇ';
  llanos  CONSTANT text := 'aeiouAEIOUaeiouAEIOUaeiouAEIOUaeiouAEIOUnNcC';
  /* tabla, columna de texto y sufijo del índice. Sólo las que pesan: en una
   * tabla de 30 renglones el barrido completo es más rápido que el índice, y
   * cada índice de más es espacio y mantenimiento sin beneficio. */
  t record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE NOTICE 'Sin pg_trgm: no se crean índices de trigramas.';
    RETURN;
  END IF;

  FOR t IN
    SELECT * FROM (VALUES
      ('sat_cp_clave_prod_serv',    'descripcion', 'prodserv'),
      ('sat_cp_colonia',            'descripcion', 'colonia'),
      ('sat_cp_estaciones',         'descripcion', 'estaciones'),
      ('sat_cp_material_peligroso', 'descripcion', 'matpel'),
      ('sat_cp_municipio',          'descripcion', 'municipio')
    ) AS v(tabla, columna, sufijo)
  LOOP
    /* Se comprueba que la tabla Y la columna existan: los catálogos se cargan
     * por separado y una base a medio sembrar no debe tumbar el despliegue. */
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = t.tabla AND column_name = t.columna
    ) THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_trgm_%s_texto ON %I USING gin ((translate(lower(%I), %L, %L)) gin_trgm_ops)',
        t.sufijo, t.tabla, t.columna, acentos, llanos
      );
      EXECUTE format('ANALYZE %I', t.tabla);
    ELSE
      RAISE NOTICE 'Se omite %.% — no existe todavía.', t.tabla, t.columna;
    END IF;
  END LOOP;

  /* Los cruces fronterizos viven en su propia tabla y se buscan por el nombre
   * mexicano O el estadounidense, así que llevan un índice por columna. */
  FOR t IN
    SELECT * FROM (VALUES
      ('cp_cruce_fronterizo', 'nombre_mx', 'cruce_mx'),
      ('cp_cruce_fronterizo', 'nombre_us', 'cruce_us')
    ) AS v(tabla, columna, sufijo)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = t.tabla AND column_name = t.columna
    ) THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_trgm_%s_texto ON %I USING gin ((translate(lower(%I), %L, %L)) gin_trgm_ops)',
        t.sufijo, t.tabla, t.columna, acentos, llanos
      );
    END IF;
  END LOOP;

  /* La clave se busca por prefijo con ILIKE. El trigrama también la cubre, y
   * evita tener que decidir entre índices distintos para LIKE e ILIKE. */
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'sat_cp_clave_prod_serv' AND column_name = 'clave') THEN
    CREATE INDEX IF NOT EXISTS idx_trgm_prodserv_clave
      ON sat_cp_clave_prod_serv USING gin (clave gin_trgm_ops);
  END IF;
END $$;

/* El CP se consulta en cada domicilio que se captura, sobre la tabla más
 * grande de todas. Aquí sí sirve un btree normal: la comparación es por
 * igualdad, no por texto parcial. */
CREATE INDEX IF NOT EXISTS idx_sat_cp_colonia_cp
  ON sat_cp_colonia (codigo_postal);
