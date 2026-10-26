/*
 * probar-farsystems-pdf — genera un PDF de muestra con el formato FarSystems
 * (datos de ejemplo, sin BD) para revisar el layout. Uso:
 *   npx ts-node -T scripts/probar-farsystems-pdf.ts [ruta-salida.pdf]
 */
import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import { renderFacturaFarsystems } from '../src/modules/cfdi/pdf-farsystems';

const out = process.argv[2] || 'farsystems-muestra.pdf';

const invoice: any = {
  serie: 'FA', folio: 433, cfdi_type: 'I', currency: 'MXN', exchange_rate: 1,
  payment_form: '03', payment_method: 'PUE', cfdi_use: 'S01',
  subtotal: 5300, discount: 0, tax_transferred: 848, total: 6148,
  cfdi_uuid: 'FFFFFFFF-271B-4D61-9888-8F22D4057DDC',
  items: [
    { clave_sat: '84111700', description: 'Hra de consultoria', unit_code: 'E48', quantity: 10, unit_price: 500, tax_amount: 800, subtotal: 5000 },
    { clave_sat: '50202306', description: 'Coca cola de 500 ml', unit_code: 'H87', quantity: 10, unit_price: 10, tax_amount: 16, subtotal: 100 },
    { clave_sat: '50202306', description: 'Coca cola de 1 lt', unit_code: 'H87', quantity: 10, unit_price: 20, tax_amount: 32, subtotal: 200 },
  ],
};
const company: any = {
  business_name: 'FAR SYSTEMS', rfc: 'FSY050118BU8', street: 'CALLE 61 POR 42 Y 44',
  ext_number: '', neighborhood: 'Francisco de Montejo II', municipality: 'Mérida',
  state: 'Yucatán', postal_code: '97203', fiscal_regime: '601', phone: '999 655 20 84',
  csd_no_certificado: '30001000000400002434',
};
const customer: any = {
  business_name: 'PUBLICO EN GENERAL', rfc: 'XAXX010101000', fiscal_regime: '616',
  street: 'Calle 61 por 42 y 44 Francisco de Montejo II', municipality: 'Mérida',
  state: 'Yucatán', postal_code: '97203',
};
const cat = { regE: 'General de Ley Personas Morales', regR: 'Sin obligaciones fiscales', uso: 'Sin efectos fiscales' };
const t: any = {
  uuid: invoice.cfdi_uuid, noCertificado: '30001000000400002434', noCertificadoSat: '30001000000400002495',
  fechaTimbrado: '2022-04-09T10:02:30', rfcProvCertif: 'SAT970701NN3',
  selloCfd: 'cGSmcbBBGacM2DJ5uFYGp3zEFzaDAbo8MxVGLqTbKpbtrDieqX4duFniChpPCiqZ0PuTT'.repeat(3),
  selloSat: 'IPR9+EsTo/Es+uN+Cfdi/dE+PruEbA+1B4OEV+bLUSchyDjh2mkKOaIhpPCiqZ0PuTT'.repeat(3),
};

const doc = new PDFDocument({ size: 'letter', margin: 40, bufferPages: true });
const chunks: Buffer[] = [];
doc.on('data', (b: Buffer) => chunks.push(b));
doc.on('end', () => {
  const buf = Buffer.concat(chunks);
  fs.writeFileSync(out, buf);
  // eslint-disable-next-line no-console
  console.log(`OK: ${out} (${buf.length} bytes, ${(doc as any).bufferedPageRange().count} página[s])`);
});

renderFacturaFarsystems(doc as any, { company, customer, invoice, cat, logoBuf: null, t, qrPng: null });
doc.end();
