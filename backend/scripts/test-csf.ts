/**
 * Test de extracción CSF — genera un PDF de prueba (PF) y lo pasa por el extractor.
 * Uso: npx ts-node scripts/test-csf.ts
 */

import PDFDocument from 'pdfkit';
import { extractCSFRaw, mapCSFToCustomer } from '../src/modules/csf/csf.service';
import { closePool } from '../src/config/database';

const TEXT = [
  'Cédula de Identificación Fiscal',
  'Datos de Identificación del Contribuyente',
  'RFC: BEOA730829LJ0',
  'CURP: BEOA730829HASRNN09',
  'Nombre (s): ANTONIO Primer Apellido: BERNAL Segundo Apellido: ORNELAS Fecha inicio de operaciones: 01/01/2010',
  'Régimen Personas Físicas con Actividades Empresariales y Profesionales Fecha Inicio del Régimen: 01/01/2010',
  'Datos del Domicilio Registrado',
  'Código Postal: 20126 Tipo de Vialidad: CALLE',
  'Nombre de Vialidad: AGUSTINOS Número Exterior: 120 Número Interior: 0',
  'Nombre de la Colonia: VILLA TERESA Nombre de la Localidad: AGUASCALIENTES',
  'Nombre del Municipio o Demarcación Territorial: AGUASCALIENTES',
  'Nombre de la Entidad Federativa: AGUASCALIENTES Entre Calle: SIN ASIGNAR',
].join('  ');

async function main() {
  // 1) Generar un PDF en memoria con ese texto
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: 'letter', margin: 50 });
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));
  doc.fontSize(10).text(TEXT, { width: 500 });
  doc.end();
  await done;
  const buffer = Buffer.concat(chunks);
  console.log(`PDF generado: ${buffer.length} bytes`);

  // 2) Extraer
  const raw = await extractCSFRaw(buffer);
  console.log('\n--- Raw extracted ---');
  console.log(raw);

  // 3) Mapear (incluye resolución régimen/estado contra catálogo SAT)
  const mapped = await mapCSFToCustomer(raw);
  console.log('\n--- Mapped to customer fields ---');
  console.log(mapped);

  await closePool();
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
