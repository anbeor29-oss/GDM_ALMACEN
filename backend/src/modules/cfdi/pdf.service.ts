/**
 * Generación del PDF de la factura (representación impresa del CFDI 4.0).
 *
 * Layout:
 *  ┌────────────────────────────────────────────────────────────┐
 *  │ [LOGO 3×3]  FACTURA   │  FOLIO  FAC-000017                 │
 *  │             ACME...   │  FECHA  2026-06-16 09:32           │
 *  │             RFC: ...  │  FORMA  03 — Transferencia         │
 *  │             Régimen   │  MÉTODO PUE — Una exhibición       │
 *  │             ─────────────────────────────────────────────  │
 *  │ RECEPTOR:                                                  │
 *  │   Razón Social                                             │
 *  │   RFC | Régimen (descripción) | CP | Uso CFDI              │
 *  │ ────────────────────────────────────────────────────────── │
 *  │ CONCEPTOS  (tabla)                                         │
 *  │   Clave SAT │ Cant │ Unidad │ Descripción │ P.U. │ Importe │
 *  │ ────────────────────────────────────────────────────────── │
 *  │                                  Subtotal:   $    ...      │
 *  │                                  IVA 16%:    $    ...      │
 *  │                                  TOTAL:      $    ...      │
 *  │ ────────────────────────────────────────────────────────── │
 *  │ (Si TIMBRADA): UUID · Cert SAT · Fecha · Sellos · Cadena   │
 *  │ Representación impresa de un CFDI                          │
 *  └────────────────────────────────────────────────────────────┘
 */

import PDFDocument from 'pdfkit';
import * as invoicesService from '../invoices/invoices.service';
import * as companiesService from '../companies/companies.service';
import * as customersService from '../customers/customers.service';
import * as cartaPorteService from '../carta-porte/carta-porte.service';
import { query } from '../../config/database';
import { NotFoundError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import { getCompanyLogo } from './logo-cache';
import {
  drawTimbreFiscal, drawPageNumbers, extractNoCertificado,
  extractTimbreData, buildQrSatPng, drawCancelledWatermark,
} from './pdf-helpers';

type PDFDoc = InstanceType<typeof PDFDocument>;

interface PDFGenerationData {
  companyId: string;
  invoiceId: string;
}

/* ──────────────────────── helpers ──────────────────────── */

function fmtMoney(n: any): string {
  const v = Number(n) || 0;
  return v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtQty(n: any): string {
  const v = Number(n) || 0;
  // 6 enteros + 3 decimales (consistente con la captura)
  return v.toLocaleString('es-MX', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
function fmtDate(d: any): string {
  try {
    return new Date(d).toLocaleString('es-MX', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

/** Convierte un número a su representación en letras (español MXN).
 *  Soporta hasta 999,999,999.99. Devuelve la forma: "MIL DOSCIENTOS TREINTA Y CUATRO" */
function numeroALetras(n: number): string {
  if (!isFinite(n) || n < 0) return 'CERO';
  const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
  const ESPECIALES: Record<number, string> = {
    10: 'DIEZ', 11: 'ONCE', 12: 'DOCE', 13: 'TRECE', 14: 'CATORCE', 15: 'QUINCE',
    16: 'DIECISÉIS', 17: 'DIECISIETE', 18: 'DIECIOCHO', 19: 'DIECINUEVE',
    20: 'VEINTE', 21: 'VEINTIUNO', 22: 'VEINTIDÓS', 23: 'VEINTITRÉS', 24: 'VEINTICUATRO',
    25: 'VEINTICINCO', 26: 'VEINTISÉIS', 27: 'VEINTISIETE', 28: 'VEINTIOCHO', 29: 'VEINTINUEVE',
  };
  const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
                    'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  function hasta999(num: number): string {
    if (num === 0) return '';
    if (num === 100) return 'CIEN';
    if (ESPECIALES[num]) return ESPECIALES[num];
    let r = '';
    const c = Math.floor(num / 100);
    const resto = num % 100;
    if (c > 0) r += CENTENAS[c];
    if (resto > 0) {
      if (r) r += ' ';
      if (ESPECIALES[resto]) {
        r += ESPECIALES[resto];
      } else {
        const d = Math.floor(resto / 10);
        const u = resto % 10;
        if (d > 0) {
          r += DECENAS[d];
          if (u > 0) r += ' Y ' + UNIDADES[u]; // solo enlazar con "Y" si hay decena
        } else if (u > 0) {
          r += UNIDADES[u];
        }
      }
    }
    return r;
  }

  const entero = Math.floor(n);
  const millones = Math.floor(entero / 1_000_000);
  const miles = Math.floor((entero % 1_000_000) / 1000);
  const resto = entero % 1000;

  let palabras = '';
  if (millones > 0) {
    palabras += millones === 1 ? 'UN MILLÓN' : `${hasta999(millones)} MILLONES`;
  }
  if (miles > 0) {
    if (palabras) palabras += ' ';
    palabras += miles === 1 ? 'MIL' : `${hasta999(miles)} MIL`;
  }
  if (resto > 0) {
    if (palabras) palabras += ' ';
    palabras += hasta999(resto);
  }
  if (!palabras) palabras = 'CERO';
  return palabras;
}

/** Palabra plural de la moneda para el importe en letra
 *  (MXN→PESOS, USD→DÓLARES, EUR→EUROS, ...). Si no se conoce, usa la clave ISO. */
function palabraMoneda(currency = 'MXN'): string {
  const map: Record<string, string> = {
    MXN: 'PESOS', USD: 'DÓLARES', EUR: 'EUROS',
    CAD: 'DÓLARES CANADIENSES', GBP: 'LIBRAS ESTERLINAS',
    JPY: 'YENES', CHF: 'FRANCOS SUIZOS', CNY: 'YUANES',
    BRL: 'REALES', ARS: 'PESOS ARGENTINOS', CLP: 'PESOS CHILENOS',
    COP: 'PESOS COLOMBIANOS', AUD: 'DÓLARES AUSTRALIANOS',
  };
  return map[currency] || currency;
}

/** Devuelve la cadena oficial "MONTO EN LETRA <MONEDA> 00/100 M.N." */
function montoEnLetra(total: number, currency = 'MXN'): string {
  const entero = Math.floor(total);
  const cent = Math.round((total - entero) * 100);
  const centStr = String(cent).padStart(2, '0');
  const letras = numeroALetras(entero);
  return `${letras} ${palabraMoneda(currency)} ${centStr}/100 M.N.`;
}

const FORMA_PAGO: Record<string, string> = {
  '01': 'Efectivo', '02': 'Cheque nominativo', '03': 'Transferencia electrónica',
  '04': 'Tarjeta de crédito', '05': 'Monedero electrónico', '06': 'Dinero electrónico',
  '08': 'Vales de despensa', '28': 'Tarjeta de débito', '29': 'Tarjeta de servicios',
  '99': 'Por definir',
};
const METODO_PAGO: Record<string, string> = {
  PUE: 'Pago en una sola exhibición',
  PPD: 'Pago en parcialidades o diferido',
};

/** Lee descripciones del catálogo SAT en un solo round-trip. */
async function loadDescriptions(
  regimenEmisor: string | null,
  regimenReceptor: string | null,
  usoCfdi: string | null
): Promise<{ regE: string; regR: string; uso: string }> {
  const want = new Set<string>();
  if (regimenEmisor)   want.add(`c_RegimenFiscal|${regimenEmisor}`);
  if (regimenReceptor) want.add(`c_RegimenFiscal|${regimenReceptor}`);
  if (usoCfdi)         want.add(`c_UsoCFDI|${usoCfdi}`);

  const map = new Map<string, string>();
  if (want.size > 0) {
    const pairs = Array.from(want).map((s) => s.split('|'));
    const placeholders = pairs.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(',');
    const values: string[] = [];
    pairs.forEach(([cn, ck]) => { values.push(cn, ck); });
    const r = await query<{ catalog_name: string; catalog_key: string; description: string }>(
      `SELECT catalog_name, catalog_key, description
         FROM sat_catalogs
        WHERE (catalog_name, catalog_key) IN (${placeholders})`,
      values
    );
    for (const row of r.rows) {
      map.set(`${row.catalog_name}|${row.catalog_key}`, row.description);
    }
  }
  return {
    regE: regimenEmisor   ? (map.get(`c_RegimenFiscal|${regimenEmisor}`)   || '') : '',
    regR: regimenReceptor ? (map.get(`c_RegimenFiscal|${regimenReceptor}`) || '') : '',
    uso:  usoCfdi         ? (map.get(`c_UsoCFDI|${usoCfdi}`)               || '') : '',
  };
}

/* ──────────────────────── generación principal ──────────────────────── */

export async function generateInvoicePDF(data: PDFGenerationData): Promise<Buffer> {
  const invoice = await invoicesService.getInvoiceById(data.companyId, data.invoiceId);
  if (!invoice) throw new NotFoundError('Invoice not found');

  const company = await companiesService.getCompanyById(data.companyId);
  const customer = await customersService.getCustomerById(data.companyId, invoice.customer_id);

  const cat = await loadDescriptions(
    company.fiscal_regime,
    customer.fiscal_regime || invoice.regimen_fiscal_receptor,
    invoice.cfdi_use
  );

  const logoBuf = await getCompanyLogo((company as any).id);

  // QR SAT — se pre-genera aquí porque el render del bloque timbre es sync.
  // Si la factura no está timbrada aún, el helper devuelve null y no se dibuja.
  const t = extractTimbreData(invoice.xml_content);
  const qrPng = await buildQrSatPng({
    uuid: t.uuid || invoice.cfdi_uuid,
    rfcEmisor: t.rfcEmisor || (company as any).rfc,
    rfcReceptor: t.rfcReceptor || (customer as any).rfc,
    total: t.total || invoice.total,
    selloCfd: t.selloCfd,
  });

  const doc = new PDFDocument({ size: 'letter', margin: 40, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));

  // Complemento Carta Porte 3.1 — cargar si la factura lo tiene
  const cp = await cartaPorteService.getByInvoiceId(data.invoiceId).catch(() => null);

  generateHeader(doc, company, invoice, cat.regE, logoBuf);
  generateReceptor(doc, customer, invoice, cat.regR, cat.uso);
  generateItems(doc, invoice.items);
  generateTotals(doc, invoice);
  if (cp) {
    generateCartaPorteSection(doc, cp);
  }
  generateStampedSection(doc, invoice, qrPng);
  generateFooter(doc, invoice);
  drawPageNumbers(doc);
  if (invoice.status === 'CANCELLED') {
    drawCancelledWatermark(doc);
  }

  return new Promise((resolve, reject) => {
    doc.on('end', () => {
      logger.info(`PDF generated for invoice ${invoice.serie}-${invoice.folio}`);
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);
    doc.end();
  });
}

/* ──────────────────────── secciones ──────────────────────── */

const PT_PER_CM = 28.3464567;
const LOGO_SIZE = Math.round(3 * PT_PER_CM); // ≈ 85 pt
const PAGE_LEFT = 40;
const PAGE_RIGHT = 555;
const PAGE_TOP = 40;

function generateHeader(doc: PDFDoc, company: any, invoice: any, regimenDesc: string, logoBuf: Buffer | null) {
  // 1) Logo — usamos el thumbnail comprimido (~30 KB) en vez del JPG original
  //    para evitar PDFs de 3 MB que el navegador no puede descargar.
  let hasLogo = false;
  if (logoBuf) {
    try {
      doc.image(logoBuf, PAGE_LEFT, PAGE_TOP, {
        fit: [LOGO_SIZE, LOGO_SIZE],
        align: 'center', valign: 'center',
      });
      hasLogo = true;
    } catch (e) {
      logger.warn(`No se pudo cargar el logo: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  // 2) Bloque emisor (centro) — debajo del logo cuando hay, o desde el margen
  const emisorX = hasLogo ? PAGE_LEFT + LOGO_SIZE + 14 : PAGE_LEFT;
  doc.fontSize(22).font('Helvetica-Bold').fillColor('#1e40af').text('FACTURA', emisorX, PAGE_TOP);

  doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151')
    .text((company.business_name || '').toUpperCase(), emisorX, PAGE_TOP + 28);
  // Letra un punto más chica (8 en vez de 9) para que el domicilio quepa cómodo.
  doc.font('Helvetica').fillColor('#374151').fontSize(8);
  const emisorBlockW = 340 - emisorX + PAGE_LEFT;
  let y = PAGE_TOP + 40;
  doc.text(`RFC: ${company.rfc || '—'}`, emisorX, y, { width: emisorBlockW }); y += 11;
  const regCodeE = company.fiscal_regime || '—';
  const regTextE = regimenDesc ? `${regCodeE} — ${regimenDesc}` : regCodeE;
  const regH = doc.heightOfString(`Régimen: ${regTextE}`, { width: emisorBlockW });
  doc.text(`Régimen: ${regTextE}`, emisorX, y, { width: emisorBlockW });
  y += Math.max(11, regH);

  // Domicilio completo del emisor: medimos cada línea para que un wrap no
  // empalme con la siguiente (avanza y por el alto real, no por 11pt fijo).
  const advance = (text: string) => {
    const h = doc.heightOfString(text, { width: emisorBlockW });
    doc.text(text, emisorX, y, { width: emisorBlockW });
    y += Math.max(11, h);
  };
  const calleParts: string[] = [];
  if (company.street)     calleParts.push(String(company.street));
  if (company.ext_number) calleParts.push(`#${company.ext_number}`);
  if (calleParts.length) advance(calleParts.join(' '));

  const localParts: string[] = [];
  if (company.neighborhood) localParts.push(String(company.neighborhood));
  if (company.municipality) localParts.push(String(company.municipality));
  if (company.state)        localParts.push(String(company.state));
  if (localParts.length) advance(localParts.join(', '));

  if (company.postal_code) advance(`CP ${company.postal_code} · México`);

  // 3) Caja superior-izquierda con Folio / Fecha / Forma de pago / Método
  //    (sí, "superior izquierda" del bloque derecho del header)
  const boxX = 345;
  const boxY = PAGE_TOP;
  const boxW = PAGE_RIGHT - boxX;
  const innerW = boxW - 16;

  // Primero medimos para saber qué alto necesitamos (UUID y NO. CERT son los
  // que pueden envolverse). Después dibujamos la caja una sola vez.
  doc.fillColor('#0f172a');
  const labelW = 60;
  const lh = 12;          // alto de fila simple (FOLIO/FECHA/FORMA/MÉTODO/MONEDA)
  const sectionGap = 4;   // espacio antes de UUID y NO. CERT
  const stackedLabelH = 9; // alto del label pequeño en las filas apiladas

  const uuidStr = invoice.cfdi_uuid ? String(invoice.cfdi_uuid) : 'PENDIENTE DE TIMBRAR';
  const noCert =
    invoice.cer_serial ||
    extractNoCertificado(invoice.xml_content) ||
    company.csd_no_certificado ||
    '— pendiente —';

  doc.font('Courier').fontSize(8);
  const uuidH = doc.heightOfString(uuidStr, { width: innerW });
  const certH = doc.heightOfString(noCert, { width: innerW });

  // Pre-medimos los valores de las 5 filas simples por si alguno wrappea
  // (MÉTODO "PUE — Pago en una sola exhibición" suele ocupar 2 líneas).
  const folioStr = `${invoice.serie || 'FAC'}-${String(invoice.folio).padStart(6, '0')}`;
  const fpCode = String(invoice.payment_form || '').padStart(2, '0');
  const fpDesc = FORMA_PAGO[fpCode] || '—';
  const mpDesc = METODO_PAGO[invoice.payment_method] || '—';
  const moneda = invoice.currency || 'MXN';
  const tc = invoice.exchange_rate && Number(invoice.exchange_rate) !== 1
    ? ` (T.C. ${invoice.exchange_rate})` : '';
  const simpleValues = [
    folioStr,
    fmtDate(invoice.date_issued),
    `${fpCode || '—'} — ${fpDesc}`,
    `${invoice.payment_method || '—'} — ${mpDesc}`,
    `${moneda}${tc}`,
  ];
  doc.font('Helvetica-Bold').fontSize(9);
  const valuesW = boxW - labelW - 16;
  const simpleRowsH = simpleValues.reduce(
    (acc, v) => acc + Math.max(lh, doc.heightOfString(v, { width: valuesW }) + 1),
    0
  );

  const computedH =
    8 +                                                 // padding top
    simpleRowsH +                                       // filas simples reales (con wrap)
    sectionGap + stackedLabelH + uuidH + 2 +
    sectionGap + stackedLabelH + certH + 2 +
    6;                                                  // padding bottom

  const boxH = Math.max(150, Math.ceil(computedH));
  doc.roundedRect(boxX, boxY, boxW, boxH, 6).fillAndStroke('#eff6ff', '#94a3b8');

  let by = boxY + 8;

  function row(label: string, value: string) {
    doc.font('Helvetica').fillColor('#64748b').fontSize(7).text(label, boxX + 8, by + 1);
    const vW = boxW - labelW - 16;
    doc.font('Helvetica-Bold').fillColor('#0f172a').fontSize(9);
    // Medimos la altura real del valor (puede wrappear) para que la siguiente
    // fila no se monte encima — bug visible con "PUE — Pago en una sola exhibición".
    const vH = doc.heightOfString(value, { width: vW });
    doc.text(value, boxX + 8 + labelW, by, { width: vW });
    by += Math.max(lh, vH + 1);
  }

  /** Fila apilada: label pequeño arriba, valor (Courier o Helvetica) en línea(s) abajo.
   *  Evita el empalme cuando el valor es largo (UUID 36 chars, NO. CERT 20 chars). */
  function stackedRow(label: string, value: string, opts: { mono?: boolean; muted?: boolean }) {
    by += sectionGap;
    doc.font('Helvetica-Bold').fillColor('#64748b').fontSize(7)
      .text(label, boxX + 8, by);
    by += stackedLabelH;
    if (opts.mono) {
      doc.font('Courier').fillColor(opts.muted ? '#94a3b8' : '#1e3a8a').fontSize(8)
        .text(value, boxX + 8, by, { width: innerW });
    } else {
      doc.font('Helvetica-Bold').fillColor('#0f172a').fontSize(8.5)
        .text(value, boxX + 8, by, { width: innerW });
    }
    const h = doc.heightOfString(value, { width: innerW });
    by += h + 2;
  }

  // Usa los valores ya precalculados en simpleValues
  row('FOLIO',      simpleValues[0]);
  row('FECHA',      simpleValues[1]);
  row('FORMA PAGO', simpleValues[2]);
  row('MÉTODO',     simpleValues[3]);
  row('MONEDA',     simpleValues[4]);

  // UUID y NO. CERT en filas apiladas para que no se empalmen con etiquetas
  stackedRow('UUID (FOLIO FISCAL SAT)', uuidStr, { mono: true, muted: !invoice.cfdi_uuid });
  stackedRow('NO. CERTIFICADO', noCert, { mono: true, muted: noCert.startsWith('—') });

  // divider
  const dividerY = Math.max(PAGE_TOP + LOGO_SIZE + 8, y + 4, by + 4);
  doc.moveTo(PAGE_LEFT, dividerY).lineTo(PAGE_RIGHT, dividerY)
    .strokeColor('#cbd5e1').lineWidth(1).stroke();

  // Guardamos la Y de continuación
  (doc as any)._nextY = dividerY + 10;
  doc.fillColor('#000000').strokeColor('#000000');
}

function generateReceptor(doc: PDFDoc, customer: any, invoice: any, regimenDesc: string, usoDesc: string) {
  const y0 = (doc as any)._nextY || 180;

  doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b')
    .text('RECEPTOR', PAGE_LEFT, y0);

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a')
    .text((customer.business_name || '').toUpperCase(), PAGE_LEFT, y0 + 12);

  // Letra un punto más chica para el cuerpo del receptor
  let y = y0 + 28;
  doc.font('Helvetica').fontSize(8).fillColor('#374151');

  // dos columnas para identificación
  const col1X = PAGE_LEFT;
  const col2X = PAGE_LEFT + 270;
  doc.text(`RFC: ${customer.rfc || '—'}`, col1X, y);
  doc.text(`CP: ${customer.postal_code || '—'}`, col2X, y);
  y += 11;

  // Helper: avanza Y según altura real de cada texto multi-línea
  const advanceR = (text: string, width = PAGE_RIGHT - col1X) => {
    const h = doc.heightOfString(text, { width });
    doc.text(text, col1X, y, { width });
    y += Math.max(11, h);
  };

  const regCode = customer.fiscal_regime || invoice.regimen_fiscal_receptor || '—';
  advanceR(`Régimen: ${regCode}${regimenDesc ? ' — ' + regimenDesc : ''}`);
  advanceR(`Uso CFDI: ${invoice.cfdi_use || '—'}${usoDesc ? ' — ' + usoDesc : ''}`);

  const calleParts: string[] = [];
  if (customer.street)     calleParts.push(String(customer.street));
  if (customer.ext_number) calleParts.push(`#${customer.ext_number}`);
  if (calleParts.length) advanceR(calleParts.join(' '));

  const localParts: string[] = [];
  if (customer.neighborhood) localParts.push(String(customer.neighborhood));
  if (customer.municipality) localParts.push(String(customer.municipality));
  if (customer.city)         localParts.push(String(customer.city));
  if (customer.state)        localParts.push(String(customer.state));
  if (localParts.length) advanceR(localParts.join(', '));

  y += 4;
  doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y)
    .strokeColor('#cbd5e1').lineWidth(1).stroke();
  (doc as any)._nextY = y + 10;
  doc.fillColor('#000000');
}

function generateItems(doc: PDFDoc, items: any[]) {
  const y0 = (doc as any)._nextY || 280;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b')
    .text('CONCEPTOS', PAGE_LEFT, y0);

  // encabezados de tabla — azul suave en lugar de negro
  const headerY = y0 + 14;
  doc.rect(PAGE_LEFT, headerY, PAGE_RIGHT - PAGE_LEFT, 18).fill('#3b82f6');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);

  // Orden: CANT · DESCRIPCIÓN · UNIDAD · CLAVE SAT · P. UNIT · IVA · IMPORTE
  const cols = {
    cant:   { x: PAGE_LEFT + 6,   w: 40 },
    desc:   { x: PAGE_LEFT + 50,  w: 200 },
    unidad: { x: PAGE_LEFT + 254, w: 34 },
    clave:  { x: PAGE_LEFT + 290, w: 48 },
    pu:     { x: PAGE_LEFT + 342, w: 56 },
    iva:    { x: PAGE_LEFT + 402, w: 42 },
    imp:    { x: PAGE_LEFT + 448, w: 64 },
  };
  doc.text('CANT',        cols.cant.x,   headerY + 5, { width: cols.cant.w,   align: 'right' });
  doc.text('DESCRIPCIÓN', cols.desc.x,   headerY + 5);
  doc.text('UNIDAD',      cols.unidad.x, headerY + 5);
  doc.text('CLAVE SAT',   cols.clave.x,  headerY + 5);
  doc.text('P. UNIT',     cols.pu.x,     headerY + 5, { width: cols.pu.w,     align: 'right' });
  doc.text('IVA',         cols.iva.x,    headerY + 5, { width: cols.iva.w,    align: 'right' });
  doc.text('IMPORTE',     cols.imp.x,    headerY + 5, { width: cols.imp.w,    align: 'right' });

  doc.fillColor('#0f172a').font('Helvetica').fontSize(8.5);

  let y = headerY + 22;
  let idx = 0;
  for (const it of items || []) {
    // Medimos primero la altura real de la fila ANTES de pintar el zebra,
    // para que el fondo cubra exactamente lo que ocupa la descripción wrap.
    doc.font('Helvetica').fontSize(9);
    const descHeight = doc.heightOfString((it.description || '').toUpperCase(),
      { width: cols.desc.w });
    const rowH = Math.max(20, descHeight + 6);

    if (idx % 2 === 1) {
      doc.rect(PAGE_LEFT, y - 3, PAGE_RIGHT - PAGE_LEFT, rowH).fill('#f8fafc');
      doc.fillColor('#0f172a');
    }

    doc.font('Helvetica').fontSize(9).fillColor('#0f172a')
      .text(fmtQty(it.quantity), cols.cant.x, y, { width: cols.cant.w, align: 'right' });
    doc.text((it.description || '').toUpperCase(), cols.desc.x, y, { width: cols.desc.w });
    // unit_code y clave_sat ACOTADOS por width + sin saltos, para que no
    // se desborden a las columnas vecinas (precio, IVA, importe).
    doc.font('Courier').fontSize(7.5).fillColor('#475569')
      .text(it.unit_code || '—', cols.unidad.x, y, { width: cols.unidad.w, lineBreak: false, ellipsis: true });
    doc.text(it.clave_sat || '—',  cols.clave.x,  y, { width: cols.clave.w,  lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(9).fillColor('#0f172a')
      .text(`$ ${fmtMoney(it.unit_price)}`, cols.pu.x, y, { width: cols.pu.w, align: 'right' });
    const r = Number(it.tax_rate) || 0;
    const ivaLabel = it.is_exempt ? 'Ex.' : (r > 0 ? `${(r * 100).toFixed(0)}%` : '0%');
    doc.font('Helvetica').fontSize(8.5).fillColor('#475569')
      .text(ivaLabel, cols.iva.x, y, { width: cols.iva.w, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a')
      .text(`$ ${fmtMoney(it.subtotal)}`, cols.imp.x, y, { width: cols.imp.w, align: 'right' });

    y += rowH;
    idx++;
  }

  // marco de la tabla
  doc.rect(PAGE_LEFT, headerY, PAGE_RIGHT - PAGE_LEFT, y - headerY + 2)
    .lineWidth(0.5).strokeColor('#cbd5e1').stroke();

  (doc as any)._nextY = y + 14;
  doc.fillColor('#000000').strokeColor('#000000');
}

function generateTotals(doc: PDFDoc, invoice: any) {
  const y0 = (doc as any)._nextY || 500;
  // Box más ancho para acomodar montos grandes con moneda (ej "$ 22,620.00 MXN")
  // sin que el "MXN" salte de línea ni se monte con el siguiente bloque.
  const boxX = 300;
  const labelX = boxX + 8;
  const valueX = boxX + 110;
  const valueW = PAGE_RIGHT - valueX - 8;

  doc.font('Helvetica').fontSize(9).fillColor('#374151');
  let y = y0;
  function line(label: string, value: string, bold = false, big = false) {
    if (big) {
      doc.rect(boxX, y - 2, PAGE_RIGHT - boxX, 24).fill('#1d4ed8');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11);
    } else {
      doc.fillColor(bold ? '#0f172a' : '#374151')
        .font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    }
    doc.text(label, labelX, y + (big ? 5 : 0));
    // lineBreak:false fuerza una sola línea — el texto se trunca con ellipsis
    // si el ancho no alcanza, pero NUNCA invade el siguiente bloque.
    doc.text(value, valueX, y + (big ? 5 : 0), {
      width: valueW, align: 'right', lineBreak: false, ellipsis: true,
    });
    y += big ? 28 : 14;
  }
  line('Subtotal',  `$ ${fmtMoney(invoice.subtotal)}`);
  if (Number(invoice.discount) > 0) {
    line('Descuento', `−$ ${fmtMoney(invoice.discount)}`);
  }
  if (Number(invoice.tax_transferred) > 0) {
    line('IVA trasladado', `$ ${fmtMoney(invoice.tax_transferred)}`);
  }
  if (Number(invoice.tax_ieps) > 0) {
    line('IEPS', `$ ${fmtMoney(invoice.tax_ieps)}`);
  }
  // Retenciones desglosadas — preferimos las columnas nuevas; si no, caemos al total
  const retIva = Number(invoice.tax_retained_iva) || 0;
  const retIsr = Number(invoice.tax_retained_isr) || 0;
  // Nota: el signo Unicode "−" (U+2212) se renderiza mal en algunas fuentes
  // PDF (aparece como comilla). Usamos "-" ASCII para máxima compatibilidad.
  if (retIva > 0) line('Ret. IVA', `-$ ${fmtMoney(retIva)}`);
  if (retIsr > 0) line('Ret. ISR', `-$ ${fmtMoney(retIsr)}`);
  if (!retIva && !retIsr && Number(invoice.tax_retained) > 0) {
    line('Retenciones', `-$ ${fmtMoney(invoice.tax_retained)}`);
  }
  line('TOTAL', `$ ${fmtMoney(invoice.total)} ${invoice.currency || 'MXN'}`, false, true);

  // Importe con letra debajo del total, ocupando todo el ancho.
  // Usamos la moneda de la factura: MXN→"PESOS", USD→"DÓLARES", EUR→"EUROS"...
  const moneda = invoice.currency || 'MXN';
  const enLetra = montoEnLetra(Number(invoice.total) || 0, moneda);
  doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#475569')
    .text('Importe con letra:', PAGE_LEFT, y);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f172a')
    .text(enLetra, PAGE_LEFT + 90, y, { width: PAGE_RIGHT - PAGE_LEFT - 90 });
  // Calculamos la altura real consumida por el bloque de letra (puede ser >1 línea)
  const lineaH = doc.heightOfString(enLetra, { width: PAGE_RIGHT - PAGE_LEFT - 90 });
  y += Math.max(16, lineaH + 6);

  (doc as any)._nextY = y + 14;
  doc.fillColor('#000000');
}

/**
 * generateCartaPorteSection — bloque impreso del Complemento Carta Porte 3.1.
 * Se muestra entre Totales y Timbre. Renderiza:
 *   · Encabezado con IdCCP, versión, transporte internacional, distancia total
 *   · Ubicaciones (Origen/Destino) con RFC, nombre, domicilio, CP y fechas
 *   · Mercancías (clave SAT, descripción, cantidad, unidad, peso, valor)
 *   · Autotransporte (permiso, config, placa, año, peso bruto, aseguradora)
 *   · Figura(s) de transporte (tipo, RFC, licencia, nombre)
 *
 * Diseñado para caber en el flujo del PDF; si el contenido excede la página,
 * PDFKit auto-pagina.
 */
function generateCartaPorteSection(doc: PDFDoc, cp: any) {
  let y = (doc as any)._nextY || 500;
  const W = PAGE_RIGHT - PAGE_LEFT;

  // Título de sección
  doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).strokeColor('#0f766e').lineWidth(1.2).stroke();
  y += 6;
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f766e')
    .text('COMPLEMENTO CARTA PORTE 3.1', PAGE_LEFT, y);
  y += 15;

  // Encabezado en 4 columnas
  doc.font('Helvetica').fontSize(8).fillColor('#475569');
  const col = (label: string, val: string, x: number) => {
    doc.fillColor('#64748b').text(label, x, y);
    doc.fillColor('#0f172a').font('Helvetica-Bold').text(val || '—', x, y + 9);
    doc.font('Helvetica').fillColor('#475569');
  };
  col('IdCCP',              String(cp.id_ccp || ''),                    PAGE_LEFT);
  col('Versión',            String(cp.version || '3.1'),                PAGE_LEFT + 145);
  col('Transp. internac.',  cp.transp_internac === 'Sí' ? 'Sí' : 'No',  PAGE_LEFT + 265);
  col('Distancia total',    `${cp.total_dist_rec || 0} km`,             PAGE_LEFT + 385);
  y += 24;

  // ─── Ubicaciones ─────────────────────────────────────────────
  if (cp.ubicaciones?.length) {
    doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    y += 4;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text('Ubicaciones', PAGE_LEFT, y);
    y += 12;
    for (const u of cp.ubicaciones) {
      const tag = u.tipo_ubicacion === 'Origen' ? 'ORIGEN' : 'DESTINO';
      const tagColor = u.tipo_ubicacion === 'Origen' ? '#0284c7' : '#059669';
      doc.roundedRect(PAGE_LEFT, y - 1, 46, 12, 2).fill(tagColor);
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff').text(tag, PAGE_LEFT + 5, y + 1.5);
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.5)
        .text(u.nombre_remitente_destinatario || u.rfc_remitente_destinatario || '', PAGE_LEFT + 52, y, { width: W - 60 });
      y += 11;
      const dom = [u.calle, u.num_exterior, u.colonia, u.municipio, u.estado, u.pais, `CP ${u.codigo_postal || ''}`]
        .filter(Boolean).join(', ');
      doc.font('Helvetica').fontSize(7.5).fillColor('#475569')
        .text(`RFC: ${u.rfc_remitente_destinatario || '—'}  ·  ${dom}`, PAGE_LEFT + 52, y, { width: W - 60 });
      y += 10;
      const fecha = u.fecha_hora_salida_llegada ? new Date(u.fecha_hora_salida_llegada).toLocaleString('es-MX') : '—';
      const extra = u.tipo_ubicacion === 'Destino' && u.distancia_recorrida ? ` · Distancia: ${u.distancia_recorrida} km` : '';
      doc.fillColor('#64748b').fontSize(7).text(`${u.tipo_ubicacion === 'Origen' ? 'Salida' : 'Llegada'}: ${fecha}${extra}`, PAGE_LEFT + 52, y);
      y += 12;
    }
  }

  // ─── Mercancías ──────────────────────────────────────────────
  if (cp.mercancias?.length) {
    doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    y += 4;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a')
      .text(`Mercancías (${cp.mercancias.length}) — peso bruto total ${cp.peso_bruto_total || 0} ${cp.unidad_peso || 'KGM'}`, PAGE_LEFT, y);
    y += 12;
    // Encabezados tabla
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#64748b');
    doc.text('CLAVE SAT', PAGE_LEFT, y);
    doc.text('DESCRIPCIÓN', PAGE_LEFT + 60, y, { width: 240 });
    doc.text('CANT',   PAGE_LEFT + 310, y, { width: 40, align: 'right' });
    doc.text('UNIDAD', PAGE_LEFT + 350, y, { width: 40, align: 'center' });
    doc.text('PESO',   PAGE_LEFT + 395, y, { width: 55, align: 'right' });
    doc.text('VALOR',  PAGE_LEFT + 455, y, { width: 60, align: 'right' });
    y += 10;
    doc.font('Helvetica').fontSize(7.5).fillColor('#0f172a');
    for (const m of cp.mercancias) {
      const rowH = Math.max(10, doc.heightOfString(m.descripcion || '', { width: 240 }) + 2);
      doc.text(String(m.bienes_transp || ''), PAGE_LEFT, y, { width: 60 });
      doc.text(String(m.descripcion || ''),   PAGE_LEFT + 60, y, { width: 240 });
      doc.text(fmtQty(m.cantidad),            PAGE_LEFT + 310, y, { width: 40, align: 'right' });
      doc.text(String(m.clave_unidad || ''),  PAGE_LEFT + 350, y, { width: 40, align: 'center' });
      doc.text(`${Number(m.peso_en_kg || 0).toFixed(2)} kg`, PAGE_LEFT + 395, y, { width: 55, align: 'right' });
      doc.text(m.valor_mercancia ? `$${fmtMoney(m.valor_mercancia)}` : '—', PAGE_LEFT + 455, y, { width: 60, align: 'right' });
      y += rowH;
    }
    y += 4;
  }

  // ─── Autotransporte ──────────────────────────────────────────
  const a = cp.autotransporte;
  if (a) {
    doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    y += 4;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text('Autotransporte', PAGE_LEFT, y);
    y += 12;
    // Grid 4 cols
    col('Permiso SCT',      `${a.perm_sct || ''} ${a.num_permiso_sct || ''}`.trim(), PAGE_LEFT);
    col('Configuración',    String(a.config_vehicular || ''),                        PAGE_LEFT + 145);
    col('Placa',            String(a.placa_vm || ''),                                PAGE_LEFT + 265);
    col('Año',              String(a.anio_modelo_vm || ''),                          PAGE_LEFT + 335);
    col('Peso bruto (t)',   String(a.peso_bruto_vehicular || ''),                    PAGE_LEFT + 405);
    y += 24;
    if (a.asegura_resp_civil || a.poliza_resp_civil) {
      col('Aseguradora R.C.', String(a.asegura_resp_civil || ''),  PAGE_LEFT);
      col('Póliza R.C.',      String(a.poliza_resp_civil || ''),   PAGE_LEFT + 265);
      y += 24;
    }
    if (a.remolques?.length) {
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#64748b').text(`Remolques: ${a.remolques.map((r: any) => `${r.sub_tipo_rem || ''} ${r.placa || ''}`).join(' | ')}`, PAGE_LEFT, y);
      y += 12;
    }
  }

  // ─── Figuras de transporte ───────────────────────────────────
  if (cp.figuras?.length) {
    doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    y += 4;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text('Figuras de transporte', PAGE_LEFT, y);
    y += 12;
    for (const f of cp.figuras) {
      const tipo = f.tipo_figura === '01' ? 'Operador' : f.tipo_figura === '02' ? 'Propietario' : f.tipo_figura === '03' ? 'Arrendador' : f.tipo_figura === '04' ? 'Notificado' : `Tipo ${f.tipo_figura}`;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0f172a')
        .text(`${tipo}: ${f.nombre_figura || ''}`, PAGE_LEFT, y);
      y += 10;
      doc.font('Helvetica').fontSize(7.5).fillColor('#475569')
        .text(`RFC: ${f.rfc_figura || '—'}  ·  Licencia: ${f.num_licencia || '—'}`, PAGE_LEFT, y);
      y += 12;
    }
  }

  doc.fillColor('#000000');
  (doc as any)._nextY = y + 8;
}

function generateStampedSection(doc: PDFDoc, invoice: any, qrPng: Buffer | null) {
  let y = (doc as any)._nextY || 600;
  const yEnd = drawTimbreFiscal(doc, y, {
    uuid: invoice.cfdi_uuid,
    fechaTimbrado: invoice.pac_timestamp || invoice.date_issued,
    pacRfc: invoice.pac_id || 'SAT970701NN3',
    color: '#1e3a8a',
    xml: invoice.xml_content,
    qrPng,
  });
  (doc as any)._nextY = yEnd;
}

function generateFooter(doc: PDFDoc, invoice: any) {
  const pageH = doc.page.height;
  const y = pageH - 42;
  // ⚠ Anulamos márgenes SOLO para escribir el footer — sin esto PDFKit ve
  // que el cursor pasó el margen inferior al terminar el text() y auto-crea
  // página nueva, aunque hayamos usado lineBreak:false.
  const origMargins = { ...doc.page.margins };
  doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };

  doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y)
    .strokeColor('#e2e8f0').lineWidth(0.5).stroke();

  doc.font('Helvetica').fontSize(7).fillColor('#94a3b8');
  doc.text(
    invoice.is_stamped
      ? 'Este documento es una representación impresa de un CFDI válido.'
      : 'Esta es una representación borrador. Sin sello del SAT no tiene validez fiscal.',
    PAGE_LEFT, y + 6,
    { width: PAGE_RIGHT - PAGE_LEFT, align: 'center', lineBreak: false }
  );

  doc.page.margins = origMargins;
  doc.fillColor('#000000');
}
