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

  // Complemento Carta Porte 3.1 — cargar si la factura lo tiene + descripciones SAT
  const cp = await cartaPorteService.getByInvoiceId(data.invoiceId).catch(() => null);
  let cpSat: { permiso?: string; config?: string } = {};
  if (cp?.autotransporte) {
    const auto = cp.autotransporte;
    try {
      const [p, c] = await Promise.all([
        auto.perm_sct ? query<any>(`SELECT descripcion FROM sat_cp_tipo_permiso WHERE clave=$1`, [auto.perm_sct]) : Promise.resolve({ rows: [] as any[] }),
        auto.config_vehicular ? query<any>(`SELECT descripcion, numero_ejes, numero_llantas FROM sat_cp_config_autotransporte WHERE clave=$1`, [auto.config_vehicular]) : Promise.resolve({ rows: [] as any[] }),
      ]);
      cpSat.permiso = p.rows[0]?.descripcion;
      const cr = c.rows[0];
      if (cr) {
        cpSat.config = `${cr.descripcion}${cr.numero_ejes && cr.numero_llantas ? ` (${cr.numero_ejes} ejes, ${cr.numero_llantas} llantas)` : ''}`;
      }
    } catch { /* si falla el lookup usamos solo la clave */ }
  }

  generateHeader(doc, company, invoice, cat.regE, logoBuf);
  generateReceptor(doc, customer, invoice, cat.regR, cat.uso);
  generateItems(doc, invoice.items);
  generateTotals(doc, invoice);
  generateStampedSection(doc, invoice, qrPng);
  if (cp) {
    generateCartaPorteSection(doc, cp, invoice, company, qrPng, cpSat);
    generateCartaPorteContract(doc);
  }
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
 * generateCartaPorteSection — Complemento Carta Porte 3.1 en HOJA PROPIA
 * (después del CFDI y el timbre). Layout siguiendo el estándar de mercado:
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ ▓▓ Complemento Carta Porte                                 │
 *   │ [QR]   Versión Complemento   3.1                           │
 *   │        Número documento      23    (rojo)                  │
 *   │        IdCCP                 CCC…                          │
 *   │        Folio fiscal          33278…                        │
 *   │        RFC Certificador      LSO…                          │
 *   │        No. certificado SAT   00001…                        │
 *   │        Fecha y hora cert.    2026-05-12 12:21:12           │
 *   │        Lugar expedición      Nuevo León, 66053             │
 *   │ ▓ Transporte Internacional  No │▓ Total distancia  188 Kms │
 *   │ Iformación Autotransporte                                  │
 *   │ ▓ Permiso SCT  (TPAF01) Auto…    │▓ Núm. Permiso  1938…    │
 *   │ Aseguradora Responsabilidad Civil                          │
 *   │ ▓ Aseguradora  MAPS SEGUROS      │▓ Póliza  20312279       │
 *   │ Vehículo                                                   │
 *   │ ▓ Tipo │ Placas │ Modelo │ Peso Bruto                      │
 *   │  (C2) Camión Unitario… │ 45UV5W │ 2012 │ 3.4 Ton           │
 *   │ Figuras                                                    │
 *   │ ▓ Tipo │ RFC/IdTrib │ Nombre │ Residencia │ Datos          │
 *   │ Ubicaciones                                                │
 *   │ ▓ Tipo │ Clave │ Remitente/Destinatario │ Distancia │Fecha │
 *   │ Mercancías : 4                                             │
 *   │ ▓ Código │ Desc │ Peligroso │ Cant │ Unidad │ Peso │ Valor │
 *   └────────────────────────────────────────────────────────────┘
 */
function generateCartaPorteSection(doc: PDFDoc, cp: any, invoice: any, company: any, qrPng: Buffer | null, cpSat: { permiso?: string; config?: string }) {
  doc.addPage();                                      // ── Hoja #2 ──
  const W    = PAGE_RIGHT - PAGE_LEFT;
  const DARK = '#0f172a';                             // barras oscuras
  const TXT_LIGHT = '#e2e8f0';                        // texto label sobre barra
  const TXT_WHITE = '#ffffff';                        // valor sobre barra
  const TITLE_BG  = '#dbeafe';                        // barra celeste del título
  let y = PAGE_TOP;

  // ── Título "Complemento Carta Porte" con fondo celeste ─────────────
  doc.rect(PAGE_LEFT, y, 220, 18).fill(TITLE_BG);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text('Complemento Carta Porte', PAGE_LEFT + 6, y + 3.5);
  y += 24;

  // ── QR + tabla de datos del complemento ────────────────────────────
  const qrSize = 105;
  if (qrPng) {
    try { doc.image(qrPng, PAGE_LEFT, y, { width: qrSize, height: qrSize }); } catch { /* si falla, no bloquea */ }
  }
  const infoX = PAGE_LEFT + qrSize + 22;
  const labelW = 155;
  const valX   = infoX + labelW;
  const infoStartY = y;
  const rowH = 13;
  const infoRow = (label: string, val: string, opts?: { valColor?: string; bold?: boolean }) => {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK).text(label, infoX, y);
    doc.font(opts?.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(opts?.valColor || DARK)
      .text(val || '—', valX, y, { width: PAGE_RIGHT - valX });
    y += rowH;
  };
  infoRow('Versión Complemento', String(cp.version || '3.1'));
  infoRow('Número documento', String(invoice.folio || ''), { valColor: '#b91c1c', bold: true });
  infoRow('IdCCP', String(cp.id_ccp || ''));
  infoRow('Folio fiscal', String(invoice.cfdi_uuid || ''));
  infoRow('RFC Certificador', String(invoice.pac_id || 'LSO1306189R5'));
  infoRow('No. certificado del SAT', String(extractNoCertificado(invoice.xml_content) || ''));
  infoRow('Fecha y hora certificación', fmtDate(invoice.pac_timestamp || invoice.date_issued));
  const estadoNom = (company as any)?.state || (company as any)?.city || 'México';
  infoRow('Lugar expedición', `${estadoNom}, ${invoice.lugar_expedicion || (company as any)?.zip_code || ''}`);
  y = Math.max(y, infoStartY + qrSize) + 6;

  // ─── Helpers de barra oscura ─────────────────────────────────────
  /** Renderiza una barra oscura con "label" en negrita blanca y opcionalmente
   *  el valor a un costado (después del label). Devuelve el nuevo y. */
  const darkLabel = (label: string, x: number, w: number, yy: number) => {
    doc.rect(x, yy, w, 14).fill(DARK);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TXT_WHITE).text(label, x + 5, yy + 3, { width: w - 8, lineBreak: false });
  };
  /** Dos pares label-value en línea (barra oscura para labels, texto negro
   *  fuera de la barra para los valores). w es el ancho del label. */
  const pairLine = (l1: string, v1: string, l2: string, v2: string, yy: number, opts?: { w1?: number; w2?: number }) => {
    const w1 = opts?.w1 ?? 130;
    const w2 = opts?.w2 ?? 130;
    const half = W / 2;
    darkLabel(l1, PAGE_LEFT, w1, yy);
    doc.font('Helvetica').fontSize(8.5).fillColor(DARK).text(v1 || '—', PAGE_LEFT + w1 + 6, yy + 3, { width: half - w1 - 10, lineBreak: false });
    darkLabel(l2, PAGE_LEFT + half, w2, yy);
    doc.font('Helvetica').fontSize(8.5).fillColor(DARK).text(v2 || '—', PAGE_LEFT + half + w2 + 6, yy + 3, { width: half - w2 - 10, lineBreak: false });
    return yy + 18;
  };
  /** Sección con título en gris pequeño + una o varias barras oscuras. */
  const sectionTitle = (title: string, yy: number) => {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK).text(title, PAGE_LEFT, yy);
    return yy + 12;
  };

  // ─── Transporte internac. | Distancia ─────────────────────────
  y = pairLine('Transporte Internacional', cp.transp_internac || 'No', 'Total distancia recorrida', `${cp.total_dist_rec || 0} Kms.`, y);
  y += 4;

  // ─── Iformación Autotransporte ────────────────────────────────
  y = sectionTitle('Iformación Autotransporte', y);
  const a = cp.autotransporte || {};
  const permisoLabel = a.perm_sct ? `(${a.perm_sct}) ${cpSat.permiso || 'Autotransporte Federal'}` : (cpSat.permiso || '—');
  y = pairLine('Permiso SCT', permisoLabel, 'Núm. Permiso', String(a.num_permiso_sct || ''), y, { w1: 100, w2: 105 });
  y += 2;

  // ─── Aseguradora Responsabilidad Civil ────────────────────────
  y = sectionTitle('Aseguradora Responsabilidad Civil', y);
  y = pairLine('Aseguradora', String(a.asegura_resp_civil || ''), 'Póliza', String(a.poliza_resp_civil || ''), y, { w1: 100, w2: 60 });
  y += 4;

  // ─── Vehículo ─────────────────────────────────────────────────
  y = sectionTitle('Vehículo', y);
  const vehCols = [
    { label: 'Tipo',       w: W - 210, align: 'left'  as const, val: a.config_vehicular ? `(${a.config_vehicular}) ${cpSat.config || ''}` : (cpSat.config || '—') },
    { label: 'Placas',     w: 70,       align: 'left'  as const, val: String(a.placa_vm || '') },
    { label: 'Modelo',     w: 60,       align: 'left'  as const, val: String(a.anio_modelo_vm || '') },
    { label: 'Peso Bruto', w: 80,       align: 'left'  as const, val: `${a.peso_bruto_vehicular || 0} Ton.` },
  ];
  y = renderDarkHeaderRow(doc, vehCols, y, PAGE_LEFT, DARK, TXT_WHITE);
  y = renderDataRow(doc, vehCols, y, PAGE_LEFT, DARK);
  y += 6;

  // ─── Figuras ──────────────────────────────────────────────────
  y = sectionTitle('Figuras', y);
  const figHeader = [
    { label: 'Tipo',            w: 110, align: 'left' as const, val: '' },
    { label: 'RFC / IdTributario', w: 120, align: 'left' as const, val: '' },
    { label: 'Nombre',          w: 200, align: 'left' as const, val: '' },
    { label: 'Residencia',      w: 60,  align: 'left' as const, val: '' },
    { label: 'Datos',           w: W - 490, align: 'left' as const, val: '' },
  ];
  y = renderDarkHeaderRow(doc, figHeader, y, PAGE_LEFT, DARK, TXT_WHITE);
  for (const f of cp.figuras || []) {
    const tipoLabel = f.tipo_figura === '01' ? '(01) Operador'
                    : f.tipo_figura === '02' ? '(02) Propietario'
                    : f.tipo_figura === '03' ? '(03) Arrendador'
                    : f.tipo_figura === '04' ? '(04) Notificado'
                    : `(${f.tipo_figura}) Figura`;
    y = renderDataRow(doc, [
      { ...figHeader[0], val: tipoLabel },
      { ...figHeader[1], val: String(f.rfc_figura || '') },
      { ...figHeader[2], val: String(f.nombre_figura || '') },
      { ...figHeader[3], val: String(f.residencia_fiscal || '') },
      { ...figHeader[4], val: `Licencia : ${f.num_licencia || '—'}` },
    ], y, PAGE_LEFT, DARK);
  }
  y += 6;

  // ─── Ubicaciones ──────────────────────────────────────────────
  y = sectionTitle('Ubicaciones', y);
  const ubiHeader = [
    { label: 'Tipo',    w: 60,  align: 'left' as const, val: '' },
    { label: 'Clave',   w: 80,  align: 'left' as const, val: '' },
    { label: 'Remitente / Destinatario', w: W - 300, align: 'left' as const, val: '' },
    { label: 'Distancia', w: 60, align: 'right' as const, val: '' },
    { label: 'Fecha y hora', w: 100, align: 'left' as const, val: '' },
  ];
  y = renderDarkHeaderRow(doc, ubiHeader, y, PAGE_LEFT, DARK, TXT_WHITE);
  for (const u of cp.ubicaciones || []) {
    const dist = u.tipo_ubicacion === 'Destino' && u.distancia_recorrida ? String(u.distancia_recorrida) : '';
    const fecha = u.fecha_hora_salida_llegada ? new Date(u.fecha_hora_salida_llegada).toLocaleString('es-MX').replace(', ', ' ') : '';
    y = renderDataRow(doc, [
      { ...ubiHeader[0], val: u.tipo_ubicacion || '' },
      { ...ubiHeader[1], val: u.id_ubicacion || '' },
      { ...ubiHeader[2], val: `${u.rfc_remitente_destinatario || ''} ${u.nombre_remitente_destinatario || ''}`.trim() },
      { ...ubiHeader[3], val: dist },
      { ...ubiHeader[4], val: fecha },
    ], y, PAGE_LEFT, DARK, { boldFirst: true });
    // Domicilio expandido debajo (formato "(colonia) municipio-descriptor. estado, país")
    const dom = `. ${u.colonia ? `(${u.colonia}) ` : ''}${[u.municipio, u.localidad].filter(Boolean).join(', ')}${u.codigo_postal ? ` C.P. ${u.codigo_postal}` : ''}. ${u.estado ? `(${u.estado}) Estado` : ''}${u.pais ? `, (${u.pais}) ${u.pais === 'MEX' ? 'México' : ''}` : ''}`;
    doc.font('Helvetica').fontSize(7.5).fillColor('#475569')
      .text(dom.replace(/\s+/g, ' ').trim(), PAGE_LEFT + 6, y, { width: W - 12 });
    y += 12;
  }
  y += 6;

  // ─── Mercancías ───────────────────────────────────────────────
  y = sectionTitle(`Mercancías : ${cp.mercancias?.length || 0}`, y);
  const merHeader = [
    { label: 'Código',    w: 70,  align: 'left'  as const, val: '' },
    { label: 'Desc',      w: W - 400, align: 'left' as const, val: '' },
    { label: 'Peligroso', w: 55,  align: 'left'  as const, val: '' },
    { label: 'Cantidad',  w: 55,  align: 'right' as const, val: '' },
    { label: 'Unidad',    w: 55,  align: 'left'  as const, val: '' },
    { label: 'Peso Kg',   w: 55,  align: 'right' as const, val: '' },
    { label: 'Valor',     w: 90,  align: 'right' as const, val: '' },
  ];
  for (const m of cp.mercancias || []) {
    if (y > 720) { doc.addPage(); y = PAGE_TOP; }
    y = renderDarkHeaderRow(doc, merHeader, y, PAGE_LEFT, DARK, TXT_WHITE);
    const uni = m.clave_unidad ? `(${m.clave_unidad}) ${m.unidad || ''}`.trim() : '';
    y = renderDataRow(doc, [
      { ...merHeader[0], val: String(m.bienes_transp || '') },
      { ...merHeader[1], val: String(m.descripcion || '') },
      { ...merHeader[2], val: m.material_peligroso === 'Si' || m.material_peligroso === true ? 'Sí' : 'No' },
      { ...merHeader[3], val: fmtQty(m.cantidad).replace('.000', '') },
      { ...merHeader[4], val: uni },
      { ...merHeader[5], val: fmtMoney(m.peso_en_kg) },
      { ...merHeader[6], val: `${fmtMoney(m.valor_mercancia || 0)} ${m.moneda || 'MXN'}` },
    ], y, PAGE_LEFT, DARK);
  }

  doc.fillColor('#000000');
  (doc as any)._nextY = y + 8;
  // Suprimimos el TXT_LIGHT no usado (por si futuras versiones lo requieren)
  void TXT_LIGHT;
}

/** Dibuja una fila de encabezado con fondo oscuro y textos blancos. */
function renderDarkHeaderRow(
  doc: PDFDoc,
  cols: Array<{ label: string; w: number; align: 'left' | 'right' | 'center' }>,
  y: number, x0: number, dark: string, white: string,
): number {
  const totalW = cols.reduce((a, c) => a + c.w, 0);
  doc.rect(x0, y, totalW, 14).fill(dark);
  let x = x0 + 5;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(white);
  for (const c of cols) {
    doc.text(c.label, x, y + 3, { width: c.w - 10, align: c.align, lineBreak: false });
    x += c.w;
  }
  return y + 15;
}

/** Dibuja una fila de datos con el mismo esquema de columnas (sin fondo). */
function renderDataRow(
  doc: PDFDoc,
  cols: Array<{ label?: string; w: number; align: 'left' | 'right' | 'center'; val: string }>,
  y: number, x0: number, dark: string,
  opts?: { boldFirst?: boolean },
): number {
  let maxH = 12;
  // Pre-calcular altura para wrap
  for (const c of cols) {
    const h = doc.heightOfString(c.val || '', { width: c.w - 10 });
    if (h > maxH) maxH = h;
  }
  let x = x0 + 5;
  doc.fontSize(8).fillColor(dark);
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    doc.font(opts?.boldFirst && i === 0 ? 'Helvetica-Bold' : 'Helvetica');
    doc.text(c.val || '', x, y, { width: c.w - 10, align: c.align });
    x += c.w;
  }
  return y + maxH + 2;
}

/** Página final: 14 cláusulas del contrato de transporte que ampara la CP. */
function generateCartaPorteContract(doc: PDFDoc) {
  doc.addPage();
  const W = PAGE_RIGHT - PAGE_LEFT;
  let y = PAGE_TOP;

  // Encabezado enmarcado
  doc.rect(PAGE_LEFT, y, W, 20).stroke('#0f172a');
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a')
    .text('CONDICIONES DEL CONTRATO DE TRANSPORTE QUE AMPARA ESTA CARTA PORTE', PAGE_LEFT, y + 5.5, { width: W, align: 'center', lineBreak: false });
  y += 26;

  const clausulas: Array<[string, string]> = [
    ['PRIMERA.-', 'Para los efectos del presente contrato de transporte se denomina Porteador al transportista y Remitente al usuario que contrate el servicio.'],
    ['SEGUNDA.-', 'El Remitente es responsable de que la información proporcionada al Porteador sea veráz y que la documentación que entregue para efectos del transporte sea la correcta.'],
    ['TERCERA.-', 'El Remitente debe declarar al Porteador el tipo de mercancía o efectos de que se trate, peso, medidas, y/o número de la carga que entrega para su transporte y, en su caso, el valor de la misma. La carga que se entregue a granel será pesada por el Porteador en el primer punto en donde halla báscula apropiada o en su defecto aforada en metros cúbicos con la conformidad del Remitente.'],
    ['CUARTA.-', 'Para efectos del transporte, el Remitente deberá entregar al Porteador los documentos que las leyes y reglamentos exijan para llevar a cabo el servicio, en caso de no cumplirse con estos requisitos el Porteador está obligado a rehusar el transporte de las mercancías.'],
    ['QUINTA.-', 'Si por sospecha de falsedad en la declaración del contenido de un bulto el Porteador deseare proceder a su reconocimiento, podrá hacerlo ante testigos y con asistencia del Remitente o del consignatario. Si este último no concurriere se solicitará la presencia de un inspector de la Secretaría de Comunicaciones y Transportes, y se levantará el acta correspondiente. El Porteador tendrá en todo caso la obligación de dejar los bultos en el estado en que se encontraban antes del reconocimiento.'],
    ['SEXTA.-', 'El Porteador deberá recoger y entregar la carga precisamente en los domicilios que señale el Remitente, ajustándose a los términos y condiciones convenidos. El Porteador sólo está obligado a llevar la carga al domicilio del consignatario para su entrega una sola vez. Si ésta no fuere recibida, se dejará aviso de que la mercancía queda a disposición del interesado en las bodegas que indique el Porteador.'],
    ['SÉPTIMA.-', 'Si la carga no fuere retirada dentro de los treinta días siguientes a aquél en que hubiere sido puesta a disposición del consignatario, el Porteador podrá solicitar la venta en pública subasta con arreglo a lo que dispone el Código de Comercio.'],
    ['OCTAVA.-', 'El Porteador y el Remitente negociarán libremente el precio del servicio, tomando en cuenta su tipo, característica de los embarques, volumen, regularidad, clase de carga y sistema de pago.'],
    ['NOVENA.-', 'Si el Remitente desea que el Porteador asuma la responsabilidad por el valor de las mercancías o efectos que él declare y que cubra toda clase de riesgos, inclusive los derivados de caso fortuito o de fuerza mayor, las partes deberán convenir un cargo adicional, equivalente al valor de la prima del seguro que se contrate, el cual se deberá expresar en la carta porte.'],
    ['DÉCIMA.-', 'Cuando el importe del flete no incluya el cargo adicional, la responsabilidad del Porteador queda expresamente limitada a la cantidad equivalente a 15 días del salario mínimo vigente en el Distrito Federal por tonelada o cuando se trate de embarques cuyo peso sea mayor de 200 kg pero menor de 1000 kg; y a 4 días de salario mínimo por remesa cuando se trate de embarques con peso de hasta 200 kg.'],
    ['DÉCIMA PRIMERA.-', 'El precio de transporte deberá pagarse en origen, salvo convenio entre las partes de pago en destino. Cuando el transporte se hubiere concertado Flete por Cobrar, la entrega de las mercancías o efectos se hará contra el pago del flete y el Porteador tendrá derecho a retenerlos mientras no se le cubra el precio convenido.'],
    ['DÉCIMA SEGUNDA.-', 'Si al momento de la entrega resultare algún faltante o avería, el consignatario deberá hacerla constar en ese acto en la carta de porte y formular su reclamación por escrito al Porteador, dentro de las 24 horas siguientes.'],
    ['DÉCIMA TERCERA.-', 'El Porteador queda eximido de la obligación de recibir mercancías o efectos para su transporte en los siguientes casos:\n\na) Cuando se trate de carga que por su naturaleza, peso, volumen, embalaje defectuoso o cualquier otra circunstancia no pueda transportarse sin destruirse o sin causar daño a los demás artículos o al material rodante, salvo que la empresa de que se trate tenga el equipo adecuado.\n\nb) Las mercancías cuyo transporte haya sido prohibido por disposiciones legales o reglamentarias. Cuando tales disposiciones no prohíban precisamente el transporte de determinadas mercancías, pero si ordenen la presentación de ciertos documentos para que puedan ser transportadas, el Remitente estará obligado a entregar al Porteador los documentos correspondientes.'],
    ['DÉCIMA CUARTA.-', 'Los casos no previstos en las presentes condiciones y las quejas derivadas de su aplicación, se someterán por la vía administrativa a la Secretaría de Comunicaciones y Transportes.'],
  ];

  doc.fontSize(8.5).fillColor('#0f172a');
  for (const [head, body] of clausulas) {
    if (y > 740) { doc.addPage(); y = PAGE_TOP; }
    doc.font('Helvetica-Bold').text(head, PAGE_LEFT, y, { continued: true });
    doc.font('Helvetica').text(' ' + body, { width: W });
    y = doc.y + 6;
  }
  doc.fillColor('#000000');
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
