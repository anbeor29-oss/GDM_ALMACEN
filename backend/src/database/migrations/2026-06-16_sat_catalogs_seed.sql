-- ============================================================================
-- SEED de catálogos SAT (Anexo 20 — subconjunto operativo)
--
-- Se aplica idempotentemente en cada arranque (migrate-up.js). Usa
-- `ON CONFLICT DO NOTHING` para no duplicar en subsecuentes ejecuciones.
--
-- Cubre los catálogos MÍNIMOS para que el UI funcione:
--   · c_ClaveProdServ    · c_ClaveUnidad
--   · c_Impuesto         · c_TasaOCuota
--   · c_RegimenFiscal    · c_UsoCFDI
--   · c_Estado           · c_Moneda (183 ISO 4217 más usadas)
--   · c_FormaPago        · c_MetodoPago
--   · c_TipoRelacion     · c_MotivoCancelacion
-- ============================================================================

-- ─── ClaveProdServ (subset de arranque) ───
INSERT INTO sat_catalogs (catalog_name, catalog_key, description, is_active) VALUES
  ('c_ClaveProdServ', '01010101', 'No existe en el catálogo (genérico)', TRUE),
  ('c_ClaveProdServ', '43232408', 'Software de aplicación', TRUE),
  ('c_ClaveProdServ', '80111100', 'Servicios de educación y capacitación', TRUE),
  ('c_ClaveProdServ', '81111600', 'Servicios de administración de sistemas', TRUE),
  ('c_ClaveProdServ', '81111700', 'Servicios de programación de cómputo', TRUE),
  ('c_ClaveProdServ', '84111700', 'Servicios de telecomunicaciones', TRUE),
  ('c_ClaveProdServ', '86101200', 'Servicios de consultoría empresarial', TRUE)
ON CONFLICT (catalog_name, catalog_key) DO NOTHING;

-- ─── ClaveUnidad ───
INSERT INTO sat_catalogs (catalog_name, catalog_key, description, is_active) VALUES
  ('c_ClaveUnidad', 'H87', 'Pieza',              TRUE),
  ('c_ClaveUnidad', 'E48', 'Unidad de servicio', TRUE),
  ('c_ClaveUnidad', 'ACT', 'Actividad',          TRUE),
  ('c_ClaveUnidad', 'KGM', 'Kilogramo',          TRUE),
  ('c_ClaveUnidad', 'HUR', 'Hora',               TRUE),
  ('c_ClaveUnidad', 'MTR', 'Metro',              TRUE),
  ('c_ClaveUnidad', 'LTR', 'Litro',              TRUE),
  ('c_ClaveUnidad', 'DAY', 'Día',                TRUE),
  ('c_ClaveUnidad', 'MON', 'Mes',                TRUE),
  ('c_ClaveUnidad', 'ANN', 'Año',                TRUE)
ON CONFLICT (catalog_name, catalog_key) DO NOTHING;

-- ─── Impuesto ───
INSERT INTO sat_catalogs (catalog_name, catalog_key, description, is_active) VALUES
  ('c_Impuesto', 'IVA',  'Impuesto al Valor Agregado',                          TRUE),
  ('c_Impuesto', 'IEPS', 'Impuesto Especial sobre Producción y Servicios',      TRUE),
  ('c_Impuesto', 'ISR',  'Impuesto Sobre la Renta',                             TRUE),
  ('c_Impuesto', '002',  'IVA (clave SAT)',                                     TRUE),
  ('c_Impuesto', '003',  'IEPS (clave SAT)',                                    TRUE)
ON CONFLICT (catalog_name, catalog_key) DO NOTHING;

-- ─── TasaOCuota ───
INSERT INTO sat_catalogs (catalog_name, catalog_key, description, is_active) VALUES
  ('c_TasaOCuota', '0.16',     'Tasa IVA 16%',              TRUE),
  ('c_TasaOCuota', '0.08',     'Tasa IVA frontera 8%',      TRUE),
  ('c_TasaOCuota', '0',        'Tasa 0% / exento',          TRUE),
  ('c_TasaOCuota', '0.160000', 'Tasa IVA 16% (6 decimales)',TRUE),
  ('c_TasaOCuota', '0.10',     'Ret. ISR 10%',              TRUE),
  ('c_TasaOCuota', '0.106667', 'Ret. IVA 10.6667%',         TRUE),
  ('c_TasaOCuota', '0.0125',   'Ret. ISR RESICO 1.25%',     TRUE)
ON CONFLICT (catalog_name, catalog_key) DO NOTHING;

-- ─── RegimenFiscal ───
INSERT INTO sat_catalogs (catalog_name, catalog_key, description, is_active) VALUES
  ('c_RegimenFiscal', '601', 'General de Ley Personas Morales',                                       TRUE),
  ('c_RegimenFiscal', '603', 'Personas Morales con Fines no Lucrativos',                              TRUE),
  ('c_RegimenFiscal', '605', 'Sueldos y Salarios e Ingresos Asimilados a Salarios',                   TRUE),
  ('c_RegimenFiscal', '606', 'Arrendamiento',                                                         TRUE),
  ('c_RegimenFiscal', '607', 'Régimen de Enajenación o Adquisición de Bienes',                        TRUE),
  ('c_RegimenFiscal', '608', 'Demás ingresos',                                                        TRUE),
  ('c_RegimenFiscal', '610', 'Residentes en el Extranjero sin Establecimiento Permanente en México',  TRUE),
  ('c_RegimenFiscal', '611', 'Ingresos por Dividendos (socios y accionistas)',                        TRUE),
  ('c_RegimenFiscal', '612', 'Personas Físicas con Actividades Empresariales y Profesionales',        TRUE),
  ('c_RegimenFiscal', '614', 'Ingresos por intereses',                                                TRUE),
  ('c_RegimenFiscal', '615', 'Régimen de los ingresos por obtención de premios',                      TRUE),
  ('c_RegimenFiscal', '616', 'Sin obligaciones fiscales',                                             TRUE),
  ('c_RegimenFiscal', '620', 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos', TRUE),
  ('c_RegimenFiscal', '621', 'Incorporación Fiscal',                                                  TRUE),
  ('c_RegimenFiscal', '622', 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras',              TRUE),
  ('c_RegimenFiscal', '623', 'Opcional para Grupos de Sociedades',                                    TRUE),
  ('c_RegimenFiscal', '624', 'Coordinados',                                                           TRUE),
  ('c_RegimenFiscal', '625', 'Actividades Empresariales con ingresos a través de Plataformas Tecnológicas', TRUE),
  ('c_RegimenFiscal', '626', 'Régimen Simplificado de Confianza (RESICO)',                            TRUE)
ON CONFLICT (catalog_name, catalog_key) DO NOTHING;

-- ─── UsoCFDI ───
INSERT INTO sat_catalogs (catalog_name, catalog_key, description, is_active) VALUES
  ('c_UsoCFDI', 'G01',  'Adquisición de mercancías',                        TRUE),
  ('c_UsoCFDI', 'G02',  'Devoluciones, descuentos o bonificaciones',        TRUE),
  ('c_UsoCFDI', 'G03',  'Gastos en general',                                TRUE),
  ('c_UsoCFDI', 'I01',  'Construcciones',                                   TRUE),
  ('c_UsoCFDI', 'I02',  'Mobiliario y equipo de oficina por inversiones',   TRUE),
  ('c_UsoCFDI', 'I03',  'Equipo de transporte',                             TRUE),
  ('c_UsoCFDI', 'I04',  'Equipo de cómputo y accesorios',                   TRUE),
  ('c_UsoCFDI', 'I05',  'Dados, troqueles, moldes, matrices y herramental', TRUE),
  ('c_UsoCFDI', 'I06',  'Comunicaciones telefónicas',                       TRUE),
  ('c_UsoCFDI', 'I07',  'Comunicaciones satelitales',                       TRUE),
  ('c_UsoCFDI', 'I08',  'Otra maquinaria y equipo',                         TRUE),
  ('c_UsoCFDI', 'D01',  'Honorarios médicos, dentales y gastos hospitalarios', TRUE),
  ('c_UsoCFDI', 'D02',  'Gastos médicos por incapacidad o discapacidad',    TRUE),
  ('c_UsoCFDI', 'D03',  'Gastos funerales',                                 TRUE),
  ('c_UsoCFDI', 'D04',  'Donativos',                                        TRUE),
  ('c_UsoCFDI', 'D05',  'Intereses reales efectivamente pagados por créditos hipotecarios (casa habitación)', TRUE),
  ('c_UsoCFDI', 'D06',  'Aportaciones voluntarias al SAR',                  TRUE),
  ('c_UsoCFDI', 'D07',  'Primas por seguros de gastos médicos',             TRUE),
  ('c_UsoCFDI', 'D08',  'Gastos de transportación escolar obligatoria',     TRUE),
  ('c_UsoCFDI', 'D09',  'Depósitos en cuentas para el ahorro, primas que tengan como base planes de pensiones', TRUE),
  ('c_UsoCFDI', 'D10',  'Pagos por servicios educativos (colegiaturas)',    TRUE),
  ('c_UsoCFDI', 'S01',  'Sin efectos fiscales',                             TRUE),
  ('c_UsoCFDI', 'CP01', 'Pagos',                                            TRUE),
  ('c_UsoCFDI', 'CN01', 'Nómina',                                           TRUE)
ON CONFLICT (catalog_name, catalog_key) DO NOTHING;

-- ─── Estado (32 entidades federativas) ───
INSERT INTO sat_catalogs (catalog_name, catalog_key, description, is_active) VALUES
  ('c_Estado', 'AGU', 'Aguascalientes',       TRUE),
  ('c_Estado', 'BCN', 'Baja California',      TRUE),
  ('c_Estado', 'BCS', 'Baja California Sur',  TRUE),
  ('c_Estado', 'CAM', 'Campeche',             TRUE),
  ('c_Estado', 'CHP', 'Chiapas',              TRUE),
  ('c_Estado', 'CHH', 'Chihuahua',            TRUE),
  ('c_Estado', 'COA', 'Coahuila',             TRUE),
  ('c_Estado', 'COL', 'Colima',               TRUE),
  ('c_Estado', 'CMX', 'Ciudad de México',     TRUE),
  ('c_Estado', 'DUR', 'Durango',              TRUE),
  ('c_Estado', 'GUA', 'Guanajuato',           TRUE),
  ('c_Estado', 'GRO', 'Guerrero',             TRUE),
  ('c_Estado', 'HID', 'Hidalgo',              TRUE),
  ('c_Estado', 'JAL', 'Jalisco',              TRUE),
  ('c_Estado', 'MEX', 'Estado de México',     TRUE),
  ('c_Estado', 'MIC', 'Michoacán',            TRUE),
  ('c_Estado', 'MOR', 'Morelos',              TRUE),
  ('c_Estado', 'NAY', 'Nayarit',              TRUE),
  ('c_Estado', 'NLE', 'Nuevo León',           TRUE),
  ('c_Estado', 'OAX', 'Oaxaca',               TRUE),
  ('c_Estado', 'PUE', 'Puebla',               TRUE),
  ('c_Estado', 'QUE', 'Querétaro',            TRUE),
  ('c_Estado', 'ROO', 'Quintana Roo',         TRUE),
  ('c_Estado', 'SLP', 'San Luis Potosí',      TRUE),
  ('c_Estado', 'SIN', 'Sinaloa',              TRUE),
  ('c_Estado', 'SON', 'Sonora',               TRUE),
  ('c_Estado', 'TAB', 'Tabasco',              TRUE),
  ('c_Estado', 'TAM', 'Tamaulipas',           TRUE),
  ('c_Estado', 'TLA', 'Tlaxcala',             TRUE),
  ('c_Estado', 'VER', 'Veracruz',             TRUE),
  ('c_Estado', 'YUC', 'Yucatán',              TRUE),
  ('c_Estado', 'ZAC', 'Zacatecas',            TRUE)
ON CONFLICT (catalog_name, catalog_key) DO NOTHING;

-- ─── Moneda (subset ISO 4217 más usadas) ───
INSERT INTO sat_catalogs (catalog_name, catalog_key, description, is_active) VALUES
  ('c_Moneda', 'MXN', 'Peso Mexicano',           TRUE),
  ('c_Moneda', 'USD', 'Dólar americano',         TRUE),
  ('c_Moneda', 'EUR', 'Euro',                    TRUE),
  ('c_Moneda', 'CAD', 'Dólar canadiense',        TRUE),
  ('c_Moneda', 'GBP', 'Libra esterlina',         TRUE),
  ('c_Moneda', 'JPY', 'Yen japonés',             TRUE),
  ('c_Moneda', 'CHF', 'Franco suizo',            TRUE),
  ('c_Moneda', 'CNY', 'Yuan chino',              TRUE),
  ('c_Moneda', 'BRL', 'Real brasileño',          TRUE),
  ('c_Moneda', 'ARS', 'Peso argentino',          TRUE),
  ('c_Moneda', 'CLP', 'Peso chileno',            TRUE),
  ('c_Moneda', 'COP', 'Peso colombiano',         TRUE),
  ('c_Moneda', 'PEN', 'Sol peruano',             TRUE),
  ('c_Moneda', 'AUD', 'Dólar australiano',       TRUE),
  ('c_Moneda', 'NZD', 'Dólar neozelandés',       TRUE),
  ('c_Moneda', 'HKD', 'Dólar de Hong Kong',      TRUE),
  ('c_Moneda', 'SGD', 'Dólar de Singapur',       TRUE),
  ('c_Moneda', 'INR', 'Rupia india',             TRUE),
  ('c_Moneda', 'KRW', 'Won surcoreano',          TRUE),
  ('c_Moneda', 'SEK', 'Corona sueca',            TRUE),
  ('c_Moneda', 'NOK', 'Corona noruega',          TRUE),
  ('c_Moneda', 'DKK', 'Corona danesa',           TRUE),
  ('c_Moneda', 'RUB', 'Rublo ruso',              TRUE),
  ('c_Moneda', 'ZAR', 'Rand sudafricano',        TRUE),
  ('c_Moneda', 'XXX', 'Sin denominación',        TRUE)
ON CONFLICT (catalog_name, catalog_key) DO NOTHING;

-- ─── FormaPago ───
INSERT INTO sat_catalogs (catalog_name, catalog_key, description, is_active) VALUES
  ('c_FormaPago', '01', 'Efectivo',                    TRUE),
  ('c_FormaPago', '02', 'Cheque nominativo',           TRUE),
  ('c_FormaPago', '03', 'Transferencia electrónica',   TRUE),
  ('c_FormaPago', '04', 'Tarjeta de crédito',          TRUE),
  ('c_FormaPago', '05', 'Monedero electrónico',        TRUE),
  ('c_FormaPago', '06', 'Dinero electrónico',          TRUE),
  ('c_FormaPago', '08', 'Vales de despensa',           TRUE),
  ('c_FormaPago', '28', 'Tarjeta de débito',           TRUE),
  ('c_FormaPago', '29', 'Tarjeta de servicios',        TRUE),
  ('c_FormaPago', '99', 'Por definir',                 TRUE)
ON CONFLICT (catalog_name, catalog_key) DO NOTHING;

-- ─── MetodoPago ───
INSERT INTO sat_catalogs (catalog_name, catalog_key, description, is_active) VALUES
  ('c_MetodoPago', 'PUE', 'Pago en una sola exhibición',       TRUE),
  ('c_MetodoPago', 'PPD', 'Pago en parcialidades o diferido',  TRUE)
ON CONFLICT (catalog_name, catalog_key) DO NOTHING;

-- ─── TipoRelacion (para Notas de Crédito) ───
INSERT INTO sat_catalogs (catalog_name, catalog_key, description, is_active) VALUES
  ('c_TipoRelacion', '01', 'Nota de crédito de los documentos relacionados',            TRUE),
  ('c_TipoRelacion', '02', 'Nota de débito de los documentos relacionados',             TRUE),
  ('c_TipoRelacion', '03', 'Devolución de mercancía sobre facturas o traslados previos',TRUE),
  ('c_TipoRelacion', '04', 'Sustitución de los CFDI previos',                           TRUE),
  ('c_TipoRelacion', '05', 'Traslados de mercancías facturados previamente',            TRUE),
  ('c_TipoRelacion', '06', 'Factura generada por los traslados previos',                TRUE),
  ('c_TipoRelacion', '07', 'CFDI por aplicación de anticipo',                           TRUE)
ON CONFLICT (catalog_name, catalog_key) DO NOTHING;

-- ─── MotivoCancelacion (SAT 2022+) ───
INSERT INTO sat_catalogs (catalog_name, catalog_key, description, is_active) VALUES
  ('c_MotivoCancelacion', '01', 'Comprobante emitido con errores con relación',         TRUE),
  ('c_MotivoCancelacion', '02', 'Comprobante emitido con errores sin relación',         TRUE),
  ('c_MotivoCancelacion', '03', 'No se llevó a cabo la operación',                      TRUE),
  ('c_MotivoCancelacion', '04', 'Operación nominativa relacionada en una factura global', TRUE)
ON CONFLICT (catalog_name, catalog_key) DO NOTHING;
