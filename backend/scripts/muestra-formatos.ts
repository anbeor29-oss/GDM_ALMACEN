/**
 * muestra-formatos — genera un PDF de muestra de CADA formato de factura, con
 * datos inventados y SIN tocar la base.
 *
 * Para qué sirve: los formatos se diseñan mirándolos. Antes había que timbrar
 * una factura de prueba, bajar el PDF y abrirlo para ver si una columna se
 * encimaba. Con esto se ven los seis de un jalón, y la misma factura de
 * ejemplo en todos, que es la única forma de compararlos de verdad.
 *
 *   npx ts-node scripts/muestra-formatos.ts [carpeta-destino]
 *
 * Los datos son INVENTADOS a propósito (RFC de la lista de pruebas del SAT,
 * sellos recortados). Nunca lee una factura real: un PDF de muestra no debe
 * poder confundirse con un comprobante.
 */

import './_entorno-postizo';   // PRIMERO: ver el comentario de ese archivo

import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { renderFacturaFarsystems } from '../src/modules/cfdi/pdf-farsystems';
import { renderFacturaGncys } from '../src/modules/cfdi/pdf-gncys';
import { renderFacturaLineal } from '../src/modules/cfdi/pdf-lineal';
import { renderFacturaBandas } from '../src/modules/cfdi/pdf-bandas';
import { renderFacturaPropio } from '../src/modules/cfdi/pdf.service';
import { getTema, FORMATOS_PDF } from '../src/modules/cfdi/pdf-temas';
import { drawPageNumbers, buildQrSatPng } from '../src/modules/cfdi/pdf-helpers';

const SELLO =
  'N6Pio+SF8euyPQ+HBdzjyEFBcE2VXiu2IAlrODwIGAvO7TjwhrDQ745iNgB+IzaglF396cpRBFRVeyCQAVSJl1j5Jw+TNK4KbRb5Yaf' +
  'oDanI68fW7wbv9b6r7zIxkH6hKPenH/yqKmTWD/57cvMQ2xqGGyznyU5EKusLJbAw2uTJpP/Iph/yb55lsqJ71QTyfMM318mIom9WJb' +
  'AQDE84kRS4U0JfpwpnFq/rdliEkOoQmaOc4L7wOQ8S1qPFKvuUvckBZuP2D6ipF5x9h5trXmmwgOyGmRp0sVDMkYmzKh1oGwLlid7Vd' +
  'RYzZ0O2F+eL+laDLl6XtxLCuJC6YcU/3w==';

const empresa = {
  id: 'demo',
  business_name: 'EMPRESA DE DEMOSTRACIÓN SA DE CV',
  rfc: 'EKU9003173C9',
  fiscal_regime: '601',
  postal_code: '64000',
  street: 'Av. Constitución 1200, Col. Centro',
  city: 'Monterrey',
  state: 'Nuevo León',
  phone: '81 8000 0000',
  email: 'facturacion@ejemplo.mx',
};

const cliente = {
  business_name: 'CLIENTE DE DEMOSTRACIÓN SA DE CV',
  rfc: 'XAXX010101000',
  fiscal_regime: '601',
  postal_code: '45027',
  street: 'Calle Falsa 123',
  city: 'Zapopan',
  state: 'Jalisco',
};

/**
 * Cuatro líneas, escogidas para que la muestra SIRVA DE PRUEBA:
 *   · precio de 6 decimales (el caso que rechazaba el PAC),
 *   · IVA al 8 % de zona fronteriza — la tasa que los formatos imprimían como 16,
 *   · IVA 16 % con retención de IVA e ISR (honorarios),
 *   · una línea EXENTA, que no lleva tasa ni importe.
 * Con una sola tasa, un formato que escriba «16.0000» a mano parece correcto.
 */
const factura: any = {
  id: 'demo',
  serie: 'A',
  folio: 3869,
  cfdi_type: 'I',
  date_issued: '2026-11-25',
  currency: 'MXN',
  payment_form: '03',
  payment_method: 'PUE',
  cfdi_use: 'G03',
  status: 'STAMPED',
  subtotal: 102_610.82,
  tax_transferred: 10_239.90,
  tax_retained: 2_893.34,
  discount: 0,
  total: 109_957.38,
  notes: 'Pedido 4821 — entrega en almacén central.',
  cfdi_uuid: 'ab968c53-fc60-4e6b-a03f-cc6ec010023d',
  items: [
    {
      line_number: 1, quantity: 400, unit_price: 32.219827, subtotal: 12_887.93,
      tax_amount: 2_062.07, total: 14_950, tax_rate: 0.16,
      description: 'BOLSA NEGRA 50 X 70 — polietileno calibre 300, paquete de 100 piezas',
      clave_sat: '24111503', unit_code: 'KGM',
    },
    {
      // Zona fronteriza: 8 %. Es la línea que delata un formato con la tasa escrita a mano.
      line_number: 2, quantity: 1, unit_price: 74_222.89, subtotal: 74_222.89,
      tax_amount: 5_937.83, total: 80_160.72, tax_rate: 0.08,
      description: 'Suministro y colocación de estructura metálica, anclas y cubierta de lona',
      clave_sat: '72152900', unit_code: 'E48',
    },
    {
      // Honorarios: 16 % trasladado, con retención de IVA (2/3) e ISR (10 %).
      line_number: 3, quantity: 2, unit_price: 7_000, subtotal: 14_000,
      tax_amount: 2_240, total: 16_240, tax_rate: 0.16,
      ret_iva_rate: 0.106667, ret_isr_rate: 0.10,
      ret_iva_amount: 1_493.34, ret_isr_amount: 1_400,
      description: 'Servicios de consultoría administrativa y asesoría en procesos de gestión empresarial',
      clave_sat: '80101500', unit_code: 'E48',
    },
    {
      // Exenta: el Anexo 20 NO lleva tasa ni importe. Imprimir «16.0000» aquí es
      // inventar, y «0.00» tampoco vale: exento no es tasa cero.
      line_number: 4, quantity: 3, unit_price: 500, subtotal: 1_500,
      tax_amount: 0, total: 1_500, tax_rate: 0, is_exempt: true,
      description: 'Libros impresos — enajenación exenta (Art. 9 LIVA)',
      clave_sat: '55101500', unit_code: 'H87',
    },
  ],
};

const cat = {
  regE: 'General de Ley Personas Morales',
  regR: 'General de Ley Personas Morales',
  uso: 'Gastos en general',
  // En producción salen del catálogo c_ClaveUnidad de la base; aquí van a mano
  // porque el script no se conecta.
  unidades: { KGM: 'Kilogramo', E48: 'Unidad de servicio', H87: 'Pieza' } as Record<string, string>,
};

const timbre = {
  uuid: 'ab968c53-fc60-4e6b-a03f-cc6ec010023d',
  fechaTimbrado: '2026-11-25T12:56:47',
  rfcProvCertif: 'SFE1512038N1',
  noCertificadoSat: '00001000000710611637',
  selloCfd: SELLO,
  selloSat: SELLO,
  noCertificado: '00001000000701935570',
  rfcEmisor: empresa.rfc,
  rfcReceptor: cliente.rfc,
  total: String(factura.total),
};

type Render = (doc: any, ctx: any) => void;

const FORMATOS: Array<{ key: string; render: Render }> = [
  { key: 'esmeralda',  render: renderFacturaPropio },
  { key: 'carbon',     render: renderFacturaPropio },
  { key: 'farsystems', render: renderFacturaFarsystems },
  { key: 'gncys',      render: renderFacturaGncys },
  { key: 'lineal',     render: renderFacturaLineal },
  { key: 'bandas',     render: renderFacturaBandas },
];

async function uno(key: string, render: Render, destino: string, qrPng: Buffer | null): Promise<void> {
  const doc = new PDFDocument({ size: 'letter', margin: 40, bufferPages: true });
  const trozos: Buffer[] = [];
  doc.on('data', (b: Buffer) => trozos.push(b));
  const listo = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(trozos))));

  (doc as any)._tema = getTema(key);
  render(doc, {
    company: { ...empresa, pdf_formato: key },
    customer: cliente,
    invoice: factura,
    cat,
    logoBuf: null,            // sin logo: así se ve que el encabezado no se desarma
    t: timbre,
    qrPng,
  });
  drawPageNumbers(doc);
  doc.end();

  const buf = await listo;
  const salida = path.join(destino, `formato-${key}.pdf`);
  fs.writeFileSync(salida, buf);
  const nombre = FORMATOS_PDF.find((f) => f.key === key)?.nombre || key;
  console.log(`  ${salida}  (${(buf.length / 1024).toFixed(0)} KB)  ${nombre}`);
}

async function main() {
  const destino = process.argv[2] || path.resolve(__dirname, '..', 'muestras-formatos');
  fs.mkdirSync(destino, { recursive: true });
  // QR real del SAT con los datos de la factura de ejemplo: sin él no se ve si
  // el bloque de abajo le deja sitio.
  const qrPng = await buildQrSatPng({
    uuid: timbre.uuid, rfcEmisor: empresa.rfc, rfcReceptor: cliente.rfc,
    total: String(factura.total), selloCfd: SELLO,
  }).catch(() => null);

  console.log('Muestras de los formatos de factura:');
  for (const f of FORMATOS) await uno(f.key, f.render, destino, qrPng);
}

main().catch((e) => { console.error(e); process.exit(1); });
