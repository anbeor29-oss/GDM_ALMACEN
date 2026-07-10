/**
 * Script: Seed SAT Catalogs (Anexo 20 - subconjunto demo)
 * Usage: npm run seed:catalogs
 *
 * Inserta un subconjunto de claves SAT para que la validación de productos
 * funcione en el demo. En producción se carga el catálogo completo del SAT.
 */

import { query, closePool } from '../src/config/database';
import logger from '../src/middleware/logger';

interface CatalogEntry {
  catalog_name: string;
  catalog_key: string;
  description: string;
}

const entries: CatalogEntry[] = [
  // c_ClaveProdServ (claves de producto/servicio usadas en el demo)
  { catalog_name: 'c_ClaveProdServ', catalog_key: '86101200', description: 'Servicios de consultoría empresarial' },
  { catalog_name: 'c_ClaveProdServ', catalog_key: '81111700', description: 'Servicios de programación de cómputo' },
  { catalog_name: 'c_ClaveProdServ', catalog_key: '84111700', description: 'Servicios de telecomunicaciones' },
  { catalog_name: 'c_ClaveProdServ', catalog_key: '81111600', description: 'Servicios de administración de sistemas' },
  { catalog_name: 'c_ClaveProdServ', catalog_key: '80111100', description: 'Servicios de educación y capacitación' },
  { catalog_name: 'c_ClaveProdServ', catalog_key: '01010101', description: 'No existe en el catálogo (genérico)' },
  { catalog_name: 'c_ClaveProdServ', catalog_key: '43232408', description: 'Software de aplicación' },

  // c_ClaveUnidad (unidades de medida)
  { catalog_name: 'c_ClaveUnidad', catalog_key: 'H87', description: 'Pieza' },
  { catalog_name: 'c_ClaveUnidad', catalog_key: 'E48', description: 'Unidad de servicio' },
  { catalog_name: 'c_ClaveUnidad', catalog_key: 'ACT', description: 'Actividad' },
  { catalog_name: 'c_ClaveUnidad', catalog_key: 'KGM', description: 'Kilogramo' },
  { catalog_name: 'c_ClaveUnidad', catalog_key: 'HUR', description: 'Hora' },
  { catalog_name: 'c_ClaveUnidad', catalog_key: 'MTR', description: 'Metro' },

  // c_Impuesto (el seed de productos usa la etiqueta 'IVA'/'IEPS')
  { catalog_name: 'c_Impuesto', catalog_key: 'IVA', description: 'Impuesto al Valor Agregado' },
  { catalog_name: 'c_Impuesto', catalog_key: 'IEPS', description: 'Impuesto Especial sobre Producción y Servicios' },
  { catalog_name: 'c_Impuesto', catalog_key: 'ISR', description: 'Impuesto Sobre la Renta' },
  { catalog_name: 'c_Impuesto', catalog_key: '002', description: 'IVA (clave SAT)' },
  { catalog_name: 'c_Impuesto', catalog_key: '003', description: 'IEPS (clave SAT)' },

  // c_TasaOCuota (tasas; validateSATTasaOCuota usa tasa.toString())
  { catalog_name: 'c_TasaOCuota', catalog_key: '0.16', description: 'Tasa IVA 16%' },
  { catalog_name: 'c_TasaOCuota', catalog_key: '0.08', description: 'Tasa IVA frontera 8%' },
  { catalog_name: 'c_TasaOCuota', catalog_key: '0', description: 'Tasa 0%' },
  { catalog_name: 'c_TasaOCuota', catalog_key: '0.160000', description: 'Tasa IVA 16% (6 decimales)' },

  // c_RegimenFiscal (regímenes fiscales SAT vigentes)
  { catalog_name: 'c_RegimenFiscal', catalog_key: '601', description: 'General de Ley Personas Morales' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '603', description: 'Personas Morales con Fines no Lucrativos' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '605', description: 'Sueldos y Salarios e Ingresos Asimilados a Salarios' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '606', description: 'Arrendamiento' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '607', description: 'Régimen de Enajenación o Adquisición de Bienes' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '608', description: 'Demás ingresos' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '610', description: 'Residentes en el Extranjero sin Establecimiento Permanente en México' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '611', description: 'Ingresos por Dividendos (socios y accionistas)' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '612', description: 'Personas Físicas con Actividades Empresariales y Profesionales' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '614', description: 'Ingresos por intereses' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '615', description: 'Régimen de los ingresos por obtención de premios' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '616', description: 'Sin obligaciones fiscales' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '620', description: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '621', description: 'Incorporación Fiscal' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '622', description: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '623', description: 'Opcional para Grupos de Sociedades' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '624', description: 'Coordinados' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '625', description: 'Régimen Actividades Empresariales con ingresos a través de Plataformas Tecnológicas' },
  { catalog_name: 'c_RegimenFiscal', catalog_key: '626', description: 'Régimen Simplificado de Confianza (RESICO)' },

  // c_UsoCFDI (claves vigentes CFDI 4.0)
  { catalog_name: 'c_UsoCFDI', catalog_key: 'G01', description: 'Adquisición de mercancías' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'G02', description: 'Devoluciones, descuentos o bonificaciones' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'G03', description: 'Gastos en general' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'I01', description: 'Construcciones' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'I02', description: 'Mobiliario y equipo de oficina por inversiones' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'I03', description: 'Equipo de transporte' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'I04', description: 'Equipo de cómputo y accesorios' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'I05', description: 'Dados, troqueles, moldes, matrices y herramental' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'I06', description: 'Comunicaciones telefónicas' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'I07', description: 'Comunicaciones satelitales' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'I08', description: 'Otra maquinaria y equipo' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'D01', description: 'Honorarios médicos, dentales y gastos hospitalarios' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'D02', description: 'Gastos médicos por incapacidad o discapacidad' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'D03', description: 'Gastos funerales' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'D04', description: 'Donativos' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'D05', description: 'Intereses reales efectivamente pagados por créditos hipotecarios (casa habitación)' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'D06', description: 'Aportaciones voluntarias al SAR' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'D07', description: 'Primas por seguros de gastos médicos' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'D08', description: 'Gastos de transportación escolar obligatoria' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'D09', description: 'Depósitos en cuentas para el ahorro, primas que tengan como base planes de pensiones' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'D10', description: 'Pagos por servicios educativos (colegiaturas)' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'S01', description: 'Sin efectos fiscales' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'CP01', description: 'Pagos' },
  { catalog_name: 'c_UsoCFDI', catalog_key: 'CN01', description: 'Nómina' },

  // c_Estado (entidades federativas de México)
  { catalog_name: 'c_Estado', catalog_key: 'AGU', description: 'Aguascalientes' },
  { catalog_name: 'c_Estado', catalog_key: 'BCN', description: 'Baja California' },
  { catalog_name: 'c_Estado', catalog_key: 'BCS', description: 'Baja California Sur' },
  { catalog_name: 'c_Estado', catalog_key: 'CAM', description: 'Campeche' },
  { catalog_name: 'c_Estado', catalog_key: 'CHP', description: 'Chiapas' },
  { catalog_name: 'c_Estado', catalog_key: 'CHH', description: 'Chihuahua' },
  { catalog_name: 'c_Estado', catalog_key: 'COA', description: 'Coahuila' },
  { catalog_name: 'c_Estado', catalog_key: 'COL', description: 'Colima' },
  { catalog_name: 'c_Estado', catalog_key: 'CMX', description: 'Ciudad de México' },
  { catalog_name: 'c_Estado', catalog_key: 'DUR', description: 'Durango' },
  { catalog_name: 'c_Estado', catalog_key: 'GUA', description: 'Guanajuato' },
  { catalog_name: 'c_Estado', catalog_key: 'GRO', description: 'Guerrero' },
  { catalog_name: 'c_Estado', catalog_key: 'HID', description: 'Hidalgo' },
  { catalog_name: 'c_Estado', catalog_key: 'JAL', description: 'Jalisco' },
  { catalog_name: 'c_Estado', catalog_key: 'MEX', description: 'Estado de México' },
  { catalog_name: 'c_Estado', catalog_key: 'MIC', description: 'Michoacán' },
  { catalog_name: 'c_Estado', catalog_key: 'MOR', description: 'Morelos' },
  { catalog_name: 'c_Estado', catalog_key: 'NAY', description: 'Nayarit' },
  { catalog_name: 'c_Estado', catalog_key: 'NLE', description: 'Nuevo León' },
  { catalog_name: 'c_Estado', catalog_key: 'OAX', description: 'Oaxaca' },
  { catalog_name: 'c_Estado', catalog_key: 'PUE', description: 'Puebla' },
  { catalog_name: 'c_Estado', catalog_key: 'QUE', description: 'Querétaro' },
  { catalog_name: 'c_Estado', catalog_key: 'ROO', description: 'Quintana Roo' },
  { catalog_name: 'c_Estado', catalog_key: 'SLP', description: 'San Luis Potosí' },
  { catalog_name: 'c_Estado', catalog_key: 'SIN', description: 'Sinaloa' },
  { catalog_name: 'c_Estado', catalog_key: 'SON', description: 'Sonora' },
  { catalog_name: 'c_Estado', catalog_key: 'TAB', description: 'Tabasco' },
  { catalog_name: 'c_Estado', catalog_key: 'TAM', description: 'Tamaulipas' },
  { catalog_name: 'c_Estado', catalog_key: 'TLA', description: 'Tlaxcala' },
  { catalog_name: 'c_Estado', catalog_key: 'VER', description: 'Veracruz' },
  { catalog_name: 'c_Estado', catalog_key: 'YUC', description: 'Yucatán' },
  { catalog_name: 'c_Estado', catalog_key: 'ZAC', description: 'Zacatecas' },
];

async function seedCatalogs() {
  try {
    logger.info('Seeding SAT catalogs (demo subset)...');

    let inserted = 0;
    for (const e of entries) {
      const result = await query(
        `INSERT INTO sat_catalogs (catalog_name, catalog_key, description, is_active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (catalog_name, catalog_key) DO NOTHING`,
        [e.catalog_name, e.catalog_key, e.description]
      );
      if (result.rowCount > 0) inserted++;
    }

    logger.info(`✅ SAT catalogs seeded: ${inserted} new entries (${entries.length} total)`);

    const counts = await query(
      `SELECT catalog_name, COUNT(*) FROM sat_catalogs GROUP BY catalog_name ORDER BY catalog_name`
    );
    counts.rows.forEach((r: any) => logger.info(`   ${r.catalog_name}: ${r.count}`));

    await closePool();
    process.exit(0);
  } catch (error) {
    logger.error('Error seeding SAT catalogs', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    await closePool();
    process.exit(1);
  }
}

seedCatalogs();
