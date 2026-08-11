-- ============================================================================
-- DESTINOS INTERNACIONALES — el ZIP dice en qué estado está
--
-- En un domicilio mexicano basta teclear el CP y el sistema resuelve colonia,
-- municipio y estado. En uno de Laredo, Texas, había que saberse la clave del
-- estado y teclearla a mano en un campo de tres letras. Quien captura una
-- Carta Porte a Estados Unidos no tiene por qué saber que Texas es TX y
-- Tennessee es TN — y cuando se equivoca, el CFDI se timbra con un domicilio
-- que no existe.
--
-- POR QUÉ RANGOS DE PREFIJO Y NO LA LISTA COMPLETA DE ZIPs
-- La tabla completa de códigos postales de Estados Unidos son ~41,000 renglones
-- que además cambian cada mes. Para lo único que se necesita aquí —saber el
-- ESTADO— basta con el prefijo: la USPS asigna los bloques por estado y esa
-- asignación es estable desde hace décadas. Son 90 renglones en vez de 41,000,
-- no hay que mantenerlos y responden igual de bien.
--
-- LO QUE ESTO **NO** RESUELVE
-- La ciudad. Saber que 78045 es Texas sale del prefijo; saber que es Laredo
-- exige la tabla completa. La ciudad se sigue capturando a mano, y la pantalla
-- lo dice en vez de dejar el campo vacío como si se hubiera olvidado.
--
-- CANADÁ ENTRA, PERO INCOMPLETO A PROPÓSITO
-- La primera letra del código postal canadiense identifica la provincia. La X
-- se reparte entre Territorios del Noroeste y Nunavut, así que NO se siembra:
-- un autocompletado que acierta la mitad de las veces es peor que ninguno,
-- porque nadie revisa lo que el sistema ya llenó.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sat_cp_zip_estado (
  pais           VARCHAR(3)  NOT NULL,
  prefijo_desde  VARCHAR(3)  NOT NULL,
  prefijo_hasta  VARCHAR(3)  NOT NULL,
  estado         VARCHAR(3)  NOT NULL,
  PRIMARY KEY (pais, prefijo_desde, prefijo_hasta)
);

CREATE INDEX IF NOT EXISTS ix_zip_estado_pais ON sat_cp_zip_estado(pais);

COMMENT ON TABLE sat_cp_zip_estado IS
  'Prefijo de código postal → estado/provincia, para domicilios extranjeros. '
  'Rangos, no lista completa: resuelve el estado, nunca la ciudad.';

/* La comparación es de texto sobre prefijos de la MISMA longitud
 * (3 para EUA, 1 para Canadá), así que el orden lexicográfico coincide con el
 * numérico y `BETWEEN` funciona sin convertir a entero — que además fallaría
 * con los ZIP que empiezan en cero, como el 00501 de Nueva York. */

-- ─── Estados Unidos: bloques ZIP3 de la USPS ───────────────────────────────
INSERT INTO sat_cp_zip_estado (pais, prefijo_desde, prefijo_hasta, estado) VALUES
  ('USA','005','005','NY'),  ('USA','006','007','PR'),  ('USA','008','008','VI'),
  ('USA','009','009','PR'),  ('USA','010','027','MA'),  ('USA','028','029','RI'),
  ('USA','030','038','NH'),  ('USA','039','049','ME'),  ('USA','050','059','VT'),
  ('USA','060','069','CT'),  ('USA','070','089','NJ'),  ('USA','100','149','NY'),
  ('USA','150','196','PA'),  ('USA','197','199','DE'),  ('USA','200','200','DC'),
  ('USA','201','201','VA'),  ('USA','202','205','DC'),  ('USA','206','212','MD'),
  ('USA','214','219','MD'),  ('USA','220','246','VA'),  ('USA','247','268','WV'),
  ('USA','270','289','NC'),  ('USA','290','299','SC'),  ('USA','300','319','GA'),
  ('USA','320','339','FL'),  ('USA','341','349','FL'),  ('USA','350','369','AL'),
  ('USA','370','385','TN'),  ('USA','386','397','MS'),  ('USA','398','399','GA'),
  ('USA','400','427','KY'),  ('USA','430','459','OH'),  ('USA','460','479','IN'),
  ('USA','480','499','MI'),  ('USA','500','528','IA'),  ('USA','530','549','WI'),
  ('USA','550','567','MN'),  ('USA','570','577','SD'),  ('USA','580','588','ND'),
  ('USA','590','599','MT'),  ('USA','600','629','IL'),  ('USA','630','658','MO'),
  ('USA','660','679','KS'),  ('USA','680','693','NE'),  ('USA','700','714','LA'),
  ('USA','716','729','AR'),  ('USA','730','732','OK'),  ('USA','733','733','TX'),
  ('USA','734','749','OK'),  ('USA','750','799','TX'),  ('USA','800','816','CO'),
  ('USA','820','831','WY'),  ('USA','832','838','ID'),  ('USA','840','847','UT'),
  ('USA','850','865','AZ'),  ('USA','870','884','NM'),  ('USA','885','885','TX'),
  ('USA','889','898','NV'),  ('USA','900','961','CA'),  ('USA','967','968','HI'),
  ('USA','970','979','OR'),  ('USA','980','994','WA'),  ('USA','995','999','AK')
ON CONFLICT (pais, prefijo_desde, prefijo_hasta) DO NOTHING;

/* Fuera quedan a propósito: 090-098 (AE), 340 (AA) y 962-966 (AP), que son
 * direcciones militares sin estado; y 969 (Guam / Marianas), que se reparte
 * entre dos territorios. Ninguno se adivina: la pantalla pide el estado. */

-- ─── Canadá: la primera letra del código postal ────────────────────────────
INSERT INTO sat_cp_zip_estado (pais, prefijo_desde, prefijo_hasta, estado) VALUES
  ('CAN','A','A','NL'),  ('CAN','B','B','NS'),  ('CAN','C','C','PE'),
  ('CAN','E','E','NB'),  ('CAN','G','J','QC'),  ('CAN','K','N','ON'),
  ('CAN','P','P','ON'),  ('CAN','R','R','MB'),  ('CAN','S','S','SK'),
  ('CAN','T','T','AB'),  ('CAN','V','V','BC'),  ('CAN','Y','Y','YT')
ON CONFLICT (pais, prefijo_desde, prefijo_hasta) DO NOTHING;

/* La X (Territorios del Noroeste / Nunavut) se omite por ambigua — ver el
 * encabezado. Ese código postal pide el territorio a mano. */

-- ─── El código postal extranjero no cabe en cinco dígitos ──────────────────
-- 'SW1A 1AA' (Londres) y 'K1A 0B1' (Ottawa) llevan letras y espacio. La
-- columna se dimensionó para el CP mexicano; se ensancha sin tocar nada más.
ALTER TABLE cp_lugares ALTER COLUMN codigo_postal TYPE VARCHAR(12);
