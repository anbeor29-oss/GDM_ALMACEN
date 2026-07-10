-- ============================================================================
-- Expansión de c_ClaveUnidad SAT — de 10 a ~120 claves.
--
-- El catálogo SAT tiene ~1,400 unidades. Aquí incluimos las más usadas en
-- facturación mexicana (embalaje, longitud, área, volumen, tiempo, digital…).
--
-- Idempotente: usa ON CONFLICT DO NOTHING.
-- ============================================================================

INSERT INTO sat_catalogs (catalog_name, catalog_key, description, is_active) VALUES
  -- ─── Unidades de pieza / conteo ───────────────────────────────────
  ('c_ClaveUnidad', 'H87', 'Pieza',                         TRUE),
  ('c_ClaveUnidad', 'EA',  'Elemento',                      TRUE),
  ('c_ClaveUnidad', 'XPK', 'Paquete',                       TRUE),
  ('c_ClaveUnidad', 'XBX', 'Caja',                          TRUE),
  ('c_ClaveUnidad', 'XCS', 'Estuche',                       TRUE),
  ('c_ClaveUnidad', 'XCT', 'Cartón',                        TRUE),
  ('c_ClaveUnidad', 'XPA', 'Cajón',                         TRUE),
  ('c_ClaveUnidad', 'XSA', 'Saco',                          TRUE),
  ('c_ClaveUnidad', 'XBG', 'Bolsa',                         TRUE),
  ('c_ClaveUnidad', 'XPU', 'Bandeja',                       TRUE),
  ('c_ClaveUnidad', 'XRO', 'Rollo',                         TRUE),
  ('c_ClaveUnidad', 'XBE', 'Fardo',                         TRUE),
  ('c_ClaveUnidad', 'XCH', 'Baúl',                          TRUE),
  ('c_ClaveUnidad', 'XCJ', 'Ataúd',                         TRUE),
  ('c_ClaveUnidad', 'DZN', 'Docena',                        TRUE),
  ('c_ClaveUnidad', 'XPI', 'Tubo/pipa',                     TRUE),
  ('c_ClaveUnidad', 'XPC', 'Paquete postal',                TRUE),
  ('c_ClaveUnidad', 'XPX', 'Tarima',                        TRUE),
  ('c_ClaveUnidad', 'XPO', 'Bolsa (pouch)',                 TRUE),
  ('c_ClaveUnidad', 'XLE', 'Enrejado',                      TRUE),

  -- ─── Servicios y actividades ──────────────────────────────────────
  ('c_ClaveUnidad', 'E48', 'Unidad de servicio',            TRUE),
  ('c_ClaveUnidad', 'ACT', 'Actividad',                     TRUE),
  ('c_ClaveUnidad', 'A9',  'Tarifa',                        TRUE),
  ('c_ClaveUnidad', 'E51', 'Trabajos',                      TRUE),

  -- ─── Peso / masa ──────────────────────────────────────────────────
  ('c_ClaveUnidad', 'KGM', 'Kilogramo',                     TRUE),
  ('c_ClaveUnidad', 'GRM', 'Gramo',                         TRUE),
  ('c_ClaveUnidad', 'MGM', 'Miligramo',                     TRUE),
  ('c_ClaveUnidad', 'TNE', 'Tonelada métrica',              TRUE),
  ('c_ClaveUnidad', 'LBR', 'Libra',                         TRUE),
  ('c_ClaveUnidad', 'ONZ', 'Onza',                          TRUE),
  ('c_ClaveUnidad', 'CGM', 'Centigramo',                    TRUE),
  ('c_ClaveUnidad', 'DTN', 'Deca tonelada',                 TRUE),

  -- ─── Longitud ─────────────────────────────────────────────────────
  ('c_ClaveUnidad', 'MTR', 'Metro',                         TRUE),
  ('c_ClaveUnidad', 'CMT', 'Centímetro',                    TRUE),
  ('c_ClaveUnidad', 'MMT', 'Milímetro',                     TRUE),
  ('c_ClaveUnidad', 'KMT', 'Kilómetro',                     TRUE),
  ('c_ClaveUnidad', 'DMT', 'Decímetro',                     TRUE),
  ('c_ClaveUnidad', 'INH', 'Pulgada',                       TRUE),
  ('c_ClaveUnidad', 'FOT', 'Pie',                           TRUE),
  ('c_ClaveUnidad', 'YRD', 'Yarda',                         TRUE),
  ('c_ClaveUnidad', 'SMI', 'Milla',                         TRUE),

  -- ─── Área ─────────────────────────────────────────────────────────
  ('c_ClaveUnidad', 'MTK', 'Metro cuadrado',                TRUE),
  ('c_ClaveUnidad', 'CMK', 'Centímetro cuadrado',           TRUE),
  ('c_ClaveUnidad', 'MMK', 'Milímetro cuadrado',            TRUE),
  ('c_ClaveUnidad', 'KMK', 'Kilómetro cuadrado',            TRUE),
  ('c_ClaveUnidad', 'HAR', 'Hectárea',                      TRUE),
  ('c_ClaveUnidad', 'FTK', 'Pie cuadrado',                  TRUE),
  ('c_ClaveUnidad', 'INK', 'Pulgada cuadrada',              TRUE),
  ('c_ClaveUnidad', 'YDK', 'Yarda cuadrada',                TRUE),

  -- ─── Volumen líquido ──────────────────────────────────────────────
  ('c_ClaveUnidad', 'LTR', 'Litro',                         TRUE),
  ('c_ClaveUnidad', 'MLT', 'Mililitro',                     TRUE),
  ('c_ClaveUnidad', 'HLT', 'Hectolitro',                    TRUE),
  ('c_ClaveUnidad', 'GLL', 'Galón US',                      TRUE),
  ('c_ClaveUnidad', 'GLI', 'Galón imperial',                TRUE),
  ('c_ClaveUnidad', 'BLL', 'Barril',                        TRUE),
  ('c_ClaveUnidad', 'OZA', 'Onza líquida',                  TRUE),

  -- ─── Volumen sólido ───────────────────────────────────────────────
  ('c_ClaveUnidad', 'MTQ', 'Metro cúbico',                  TRUE),
  ('c_ClaveUnidad', 'CMQ', 'Centímetro cúbico',             TRUE),
  ('c_ClaveUnidad', 'MMQ', 'Milímetro cúbico',              TRUE),
  ('c_ClaveUnidad', 'DMQ', 'Decímetro cúbico',              TRUE),
  ('c_ClaveUnidad', 'FTQ', 'Pie cúbico',                    TRUE),

  -- ─── Tiempo ───────────────────────────────────────────────────────
  ('c_ClaveUnidad', 'SEC', 'Segundo',                       TRUE),
  ('c_ClaveUnidad', 'MIN', 'Minuto',                        TRUE),
  ('c_ClaveUnidad', 'HUR', 'Hora',                          TRUE),
  ('c_ClaveUnidad', 'DAY', 'Día',                           TRUE),
  ('c_ClaveUnidad', 'WEE', 'Semana',                        TRUE),
  ('c_ClaveUnidad', 'MON', 'Mes',                           TRUE),
  ('c_ClaveUnidad', 'ANN', 'Año',                           TRUE),
  ('c_ClaveUnidad', 'D63', 'Libro',                         TRUE),

  -- ─── Digital / TI / telecomunicaciones ────────────────────────────
  ('c_ClaveUnidad', 'E34', 'Gigabyte',                      TRUE),
  ('c_ClaveUnidad', 'E33', 'Megabyte',                      TRUE),
  ('c_ClaveUnidad', 'E32', 'Kilobyte',                      TRUE),
  ('c_ClaveUnidad', '2P',  'Kilobyte (2P)',                 TRUE),
  ('c_ClaveUnidad', 'E35', 'Terabyte',                      TRUE),
  ('c_ClaveUnidad', 'E31', 'Byte',                          TRUE),
  ('c_ClaveUnidad', 'AD',  'Byte de bytes (mensajes)',      TRUE),
  ('c_ClaveUnidad', 'D75', 'Minuto de llamada',             TRUE),
  ('c_ClaveUnidad', 'D74', 'Kilómetro-hora',                TRUE),

  -- ─── Electricidad / energía ───────────────────────────────────────
  ('c_ClaveUnidad', 'KWH', 'Kilowatt hora',                 TRUE),
  ('c_ClaveUnidad', 'MWH', 'Megawatt hora',                 TRUE),
  ('c_ClaveUnidad', 'JOU', 'Joule',                         TRUE),
  ('c_ClaveUnidad', 'WTT', 'Watt',                          TRUE),
  ('c_ClaveUnidad', 'KWT', 'Kilowatt',                      TRUE),
  ('c_ClaveUnidad', 'AMP', 'Amperio',                       TRUE),
  ('c_ClaveUnidad', 'VLT', 'Voltio',                        TRUE),

  -- ─── Transporte / logística ───────────────────────────────────────
  ('c_ClaveUnidad', 'TNE_km', 'Tonelada-kilómetro',         TRUE),
  ('c_ClaveUnidad', 'KMT_h',  'Kilómetro-hora (velocidad)', TRUE),
  ('c_ClaveUnidad', 'NMI', 'Milla náutica',                 TRUE),
  ('c_ClaveUnidad', 'MTS', 'Metros lineales',               TRUE),
  ('c_ClaveUnidad', 'M3T', 'Metros cúbicos toneladas',      TRUE),

  -- ─── Farmacia / química ───────────────────────────────────────────
  ('c_ClaveUnidad', 'IU',  'Unidad internacional',          TRUE),
  ('c_ClaveUnidad', 'BOU', 'Botella',                       TRUE),
  ('c_ClaveUnidad', 'GB',  'Gramo por 100 (concentración)', TRUE),
  ('c_ClaveUnidad', 'A75', 'Miligramo por hora',            TRUE),
  ('c_ClaveUnidad', 'D40', 'Miliequivalente por litro',     TRUE),

  -- ─── Agricultura y ganadería ──────────────────────────────────────
  ('c_ClaveUnidad', 'LEF', 'Hoja',                          TRUE),
  ('c_ClaveUnidad', 'H88', 'Kilo por metro cuadrado',       TRUE),
  ('c_ClaveUnidad', 'BX',  'Bulto / caja',                  TRUE),
  ('c_ClaveUnidad', 'CS',  'Estuche/case',                  TRUE),
  ('c_ClaveUnidad', 'CE',  'Cabeza',                        TRUE),

  -- ─── Construcción ─────────────────────────────────────────────────
  ('c_ClaveUnidad', 'SP',  'Paquete de plataforma',         TRUE),
  ('c_ClaveUnidad', 'BG',  'Bulto',                         TRUE),
  ('c_ClaveUnidad', 'MP',  'Millares de piezas',            TRUE),
  ('c_ClaveUnidad', 'H85', 'Millares (miles)',              TRUE),

  -- ─── Textiles ─────────────────────────────────────────────────────
  ('c_ClaveUnidad', 'SET', 'Conjunto/Set',                  TRUE),
  ('c_ClaveUnidad', 'PR',  'Par',                           TRUE),
  ('c_ClaveUnidad', 'DP',  'Docena de pares',               TRUE),

  -- ─── Otros comunes ────────────────────────────────────────────────
  ('c_ClaveUnidad', 'MLD', 'Millón',                        TRUE),
  ('c_ClaveUnidad', 'MIL', 'Mil',                           TRUE),
  ('c_ClaveUnidad', 'HD',  'Cientos',                       TRUE),
  ('c_ClaveUnidad', 'GRO', 'Gruesa (144 unidades)',         TRUE),
  ('c_ClaveUnidad', 'E54', 'Viaje',                         TRUE),
  ('c_ClaveUnidad', 'DAD', 'Diario',                        TRUE),
  ('c_ClaveUnidad', 'DPT', 'Departamento',                  TRUE),
  ('c_ClaveUnidad', 'MTU', 'Metro tarifado',                TRUE),
  ('c_ClaveUnidad', 'AB',  'Unidad de pack a granel',       TRUE),
  ('c_ClaveUnidad', 'E52', 'Envío',                         TRUE),
  ('c_ClaveUnidad', 'E53', 'Boleto',                        TRUE),
  ('c_ClaveUnidad', 'X4A', 'Consumo',                       TRUE)
ON CONFLICT (catalog_name, catalog_key) DO NOTHING;
