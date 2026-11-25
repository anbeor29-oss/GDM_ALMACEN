/**
 * pdf-lineal — formato «Lineal» para la FACTURA (CFDI 4.0 de Ingreso).
 * Se usa cuando companies.pdf_formato='lineal'.
 *
 * Rasgos: emisor arriba-izquierda y logo centrado; una CAJA con filete de color
 * que reúne receptor + tipo de comprobante + serie/folio + lugar y fechas; una
 * tira de tres columnas con folio fiscal y los dos números de certificado;
 * tabla de conceptos a filete fino —sin fondos— con el desglose de impuestos
 * DEBAJO de cada descripción; importe en letra; abajo QR, datos de pago y
 * totales; y al final cadena original y los dos sellos.
 *
 * Es el formato más denso de los seis: cabe mucho concepto en una hoja y la
 * letra se mantiene chica a propósito. El color sale del tema de la empresa,
 * no está fijo.
 *
 * El layout cambia; el contenido es el MISMO CFDI válido.
 */
import {
  PDFDoc, PAGE_LEFT, PAGE_RIGHT, PAGE_TOP, fmtMoney, fmtPrecio, fmtQty, montoEnLetra,
  FORMA_PAGO, METODO_PAGO,
} from './pdf-helpers';
import { getTema } from './pdf-temas';
import { objetoImpuesto, trasladosDeLinea, retencionesDeLinea, resumenTraslados, resumenRetenciones, etiquetaTasa } from './pdf-impuestos';

const TXT = '#1f2937';
const GRIS = '#6b7280';
const FILETE = '#d1d5db';

export interface CtxLineal {
  company: any; customer: any; invoice: any;
  cat: { regE: string; regR: string; uso: string; unidades?: Record<string, string> };
  logoBuf: Buffer | null;
  t: any;
  qrPng: Buffer | null;
}

export function renderFacturaLineal(doc: PDFDoc, ctx: CtxLineal): void {
  const { company, customer, invoice, cat, logoBuf, t, qrPng } = ctx;
  const W = PAGE_RIGHT - PAGE_LEFT;
  const tema = (doc as any)._tema || getTema((company as any).pdf_formato);
  const ACENTO = tema.acento as string;

  const items: any[] = invoice.items || [];
  const timbrada = !!(t?.uuid || invoice.cfdi_uuid);

  /* ── Encabezado: emisor a la izquierda, logo al centro ── */
  let y = PAGE_TOP;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(TXT)
    .text(String(company.business_name || '').toUpperCase(), PAGE_LEFT, y, { width: 230, ellipsis: true });
  y = doc.y;
  doc.font('Helvetica-Bold').fontSize(8.5).text(company.rfc || '—', PAGE_LEFT, y, { width: 230 });
  y = doc.y + 1;
  doc.font('Helvetica').fontSize(7.5).fillColor(TXT)
    .text(`Rég. Fiscal: ${company.fiscal_regime || ''} - ${cat.regE || ''}`.trim(), PAGE_LEFT + 4, y, { width: 260 });
  const yEmisor = doc.y;

  if (logoBuf) {
    try { doc.image(logoBuf, PAGE_LEFT + W / 2 - 45, PAGE_TOP - 4, { fit: [90, 52], align: 'center' }); }
    catch { /* un logo ilegible no tumba la factura */ }
  }

  /* ── Caja: receptor · tipo · serie/folio · lugar y fechas ── */
  y = Math.max(yEmisor, PAGE_TOP + 50) + 8;
  const cajaY = y;
  const cajaH = 64;
  doc.lineWidth(0.8).rect(PAGE_LEFT, cajaY, W, cajaH).stroke(ACENTO);

  // izquierda — receptor
  const ix = PAGE_LEFT + 6, iw = 250;
  let iy = cajaY + 5;
  doc.font('Helvetica').fontSize(8).fillColor(TXT)
    .text(String(customer.business_name || '').toUpperCase(), ix, iy, { width: iw, ellipsis: true });
  iy = doc.y + 1;
  doc.fontSize(7.5).text(customer.rfc || '—', ix, iy, { width: iw });
  iy = doc.y + 1;
  const kv = (lab: string, val: string) => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TXT).text(lab, ix, iy, { width: iw, continued: true })
      .font('Helvetica').text(` ${val}`, { width: iw, ellipsis: true });
    iy = doc.y + 0.5;
  };
  kv('Uso CFDI:', `${invoice.cfdi_use || '—'} - ${cat.uso || ''}`.trim());
  kv('Régimen Fiscal:', `${customer.fiscal_regime || ''} - ${cat.regR || ''}`.trim());
  kv('Domicilio Fiscal:', String(customer.postal_code || '—'));

  // centro — tipo de comprobante
  const TIPOS: Record<string, string> = { I: 'Ingreso', E: 'Egreso', T: 'Traslado', N: 'Nómina', P: 'Pago' };
  const tipo = String(invoice.cfdi_type || 'I');
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TXT)
    .text('Tipo de Comprobante:', PAGE_LEFT + 258, cajaY + 24, { width: 92, align: 'right', lineBreak: false });
  doc.font('Helvetica')
    .text(`${tipo} = ${TIPOS[tipo] || ''}`, PAGE_LEFT + 353, cajaY + 24, { width: 46, lineBreak: false });

  // derecha — serie/folio y lugar/fechas
  const dx = PAGE_LEFT + 400, dw = W - 400 - 6;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(TXT)
    .text(`Serie: ${invoice.serie || 'A'}`, dx, cajaY + 5, { width: dw / 2 })
    .text(`Folio: ${invoice.folio ?? ''}`, dx + dw / 2, cajaY + 5, { width: dw / 2, align: 'right' });
  doc.fontSize(7.5).text('Lugar y Fecha de Emisión', dx, cajaY + 18, { width: dw, align: 'center' });
  doc.font('Helvetica').fontSize(7)
    .text(`${company.postal_code || ''} ,  ${fechaHoraIso(invoice.date_issued)}`, dx, cajaY + 28, { width: dw, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(7.5)
    .text('Lugar y Fecha de certificación', dx, cajaY + 40, { width: dw, align: 'center' });
  doc.font('Helvetica').fontSize(7)
    .text(timbrada ? `${t?.fechaTimbrado || ''}` : 'Pendiente de timbrar', dx, cajaY + 50, { width: dw, align: 'center' });

  /* ── Tira de tres: folio fiscal y certificados ── */
  y = cajaY + cajaH + 8;
  const tercio = W / 3;
  const tira: Array<[string, string]> = [
    ['Folio Fiscal', t?.uuid || invoice.cfdi_uuid || 'PENDIENTE DE TIMBRAR'],
    ['Número de Certificado del Emisor', t?.noCertificado || company.csd_no_certificado || '—'],
    ['Número de Certificado del SAT', t?.noCertificadoSat || '—'],
  ];
  doc.font('Helvetica-Bold').fontSize(8).fillColor(TXT);
  tira.forEach(([lab], i) => doc.text(lab, PAGE_LEFT + i * tercio, y, { width: tercio, align: 'center' }));
  doc.font('Helvetica').fontSize(7.5).fillColor(TXT);
  tira.forEach(([, val], i) => doc.text(val, PAGE_LEFT + i * tercio, y + 12, { width: tercio, align: 'center', ellipsis: true }));
  y += 28;

  /* ── Conceptos ── */
  /* Anchos medidos contra el encabezado MÁS LARGO de cada columna a 7 pt: si
   * «C. Unidad» o «Descuento» no caben, PDFKit los parte en dos renglones y el
   * encabezado se encima con el de al lado. Por eso van con lineBreak:false. */
  const cols = [
    { k: 'cve',  t: 'Clave',       x: PAGE_LEFT,       w: 46,  a: 'center' as const },
    { k: 'noid', t: 'No. Ident.',  x: PAGE_LEFT + 46,  w: 44,  a: 'center' as const },
    { k: 'cant', t: 'Cantidad',    x: PAGE_LEFT + 90,  w: 42,  a: 'center' as const },
    { k: 'cu',   t: 'C. Unidad',   x: PAGE_LEFT + 132, w: 42,  a: 'center' as const },
    { k: 'uni',  t: 'Unidad',      x: PAGE_LEFT + 174, w: 46,  a: 'center' as const },
    { k: 'desc', t: 'Descripción', x: PAGE_LEFT + 220, w: 148, a: 'left'   as const },
    { k: 'vu',   t: 'V. Unitario', x: PAGE_LEFT + 368, w: 50,  a: 'right'  as const },
    { k: 'imp',  t: 'Importe',     x: PAGE_LEFT + 418, w: 52,  a: 'right'  as const },
    { k: 'dto',  t: 'Descuento',   x: PAGE_LEFT + 470, w: W - 470, a: 'right' as const },
  ];
  /* Ancho del desglose de impuestos: de la descripción hasta donde empieza
   * «V. Unitario», sin cruzar el filete de la columna. */
  const impW = cols[6].x - cols[5].x - 6;
  const linea = (yy: number, color = FILETE, gruesa = false) =>
    doc.lineWidth(gruesa ? 0.8 : 0.4).moveTo(PAGE_LEFT, yy).lineTo(PAGE_RIGHT, yy).stroke(color);

  const encabezado = (yy: number): number => {
    linea(yy, ACENTO, true);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TXT);
    for (const c of cols) doc.text(c.t, c.x + 2, yy + 4, { width: c.w - 4, align: c.a, lineBreak: false });
    linea(yy + 15, ACENTO, true);
    return yy + 19;
  };
  y = encabezado(y);

  const yTope = doc.page.height - 300;   // deja sitio al bloque inferior
  for (const it of items) {
    const desc = String(it.description || '');
    const trs = trasladosDeLinea(it);
    const rets = retencionesDeLinea(it);
    const descW = cols[5].w - 4;
    const hDesc = doc.font('Helvetica').fontSize(7.5).heightOfString(desc, { width: descW });
    const hImp = 9 + (trs.length + rets.length) * 8.5;     // objeto + un renglón por impuesto
    const rowH = Math.max(18, hDesc + hImp + 6);

    if (y + rowH > yTope) { doc.addPage(); y = encabezado(PAGE_TOP); }

    doc.font('Helvetica').fontSize(7.5).fillColor(TXT);
    const vals: Record<string, string> = {
      cve: it.clave_sat || '',
      noid: it.no_identificacion || '',
      cant: fmtQty(it.quantity),
      cu: it.unit_code || '',
      uni: cat.unidades?.[String(it.unit_code || '')] || '',
      desc: '',
      vu: `$${fmtPrecio(it.unit_price)}`,
      imp: `$ ${fmtMoney(it.subtotal)}`,
      dto: Number(it.discount || 0) > 0 ? `$ ${fmtMoney(it.discount)}` : '',
    };
    for (const c of cols) if (c.k !== 'desc') doc.text(vals[c.k], c.x + 2, y + 2, { width: c.w - 4, align: c.a });

    // descripción + desglose de impuestos de ESTA línea
    doc.text(desc, cols[5].x + 2, y + 2, { width: descW });
    let dy = y + 2 + hDesc + 1;
    doc.font('Helvetica-Bold').fontSize(6).fillColor(TXT)
      .text('Objeto de impuesto:', cols[5].x + 2, dy, { width: descW, continued: true })
      .font('Helvetica').text(`  ${objetoImpuesto(it)}`);
    dy += 8;
    if (trs.length) {
      doc.font('Helvetica-Bold').fontSize(6).text('Impuesto Traslado', cols[5].x + 2, dy, { width: descW });
      dy += 7;
      for (const tr of trs) {
        const detalle = tr.tipoFactor === 'Exento'
          ? `Base: $ ${fmtMoney(tr.base)}    Impuesto: ${tr.impuesto}    Tipo Factor: Exento`
          : `Base: $ ${fmtMoney(tr.base)}    Impuesto: ${tr.impuesto}    Tipo Factor: Tasa    Tasa o Cuota: ${tr.tasa.toFixed(6)}    Importe: $ ${fmtMoney(tr.importe)}`;
        doc.font('Helvetica').fontSize(5.5).fillColor(GRIS).text(detalle, cols[5].x + 2, dy, { width: impW });
        dy = doc.y + 0.5;
      }
    }
    if (rets.length) {
      doc.font('Helvetica-Bold').fontSize(6).fillColor(TXT).text('Impuesto Retenido', cols[5].x + 2, dy, { width: descW });
      dy += 7;
      for (const re of rets) {
        doc.font('Helvetica').fontSize(5.5).fillColor(GRIS).text(
          `Base: $ ${fmtMoney(re.base)}    Impuesto: ${re.impuesto}    Tipo Factor: Tasa    Tasa o Cuota: ${re.tasa.toFixed(6)}    Importe: $ ${fmtMoney(re.importe)}`,
          cols[5].x + 2, dy, { width: impW });
        dy = doc.y + 0.5;
      }
    }
    y = Math.max(y + rowH, dy + 3);
  }
  linea(y, ACENTO, true);
  y += 6;

  /* ── Importe en letra + totales ── */
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TXT)
    .text('Importe en Letra:', PAGE_LEFT, y, { width: 78, lineBreak: false });
  doc.font('Helvetica')
    .text(montoEnLetra(Number(invoice.total || 0), invoice.currency), PAGE_LEFT + 82, y, { width: 212 });
  const yLetra = doc.y;

  // Totales a la derecha
  const totX = PAGE_LEFT + 300, totLabW = 125, totValW = W - 300 - 125;
  let ty = y + 2;
  const renglon = (lab: string, val: number, opts: { bold?: boolean } = {}) => {
    doc.font('Helvetica-Bold').fontSize(opts.bold ? 9 : 7.5).fillColor(ACENTO)
      .text(lab, totX, ty, { width: totLabW });
    const alto = doc.y - ty;
    doc.font('Helvetica').fontSize(opts.bold ? 9 : 7.5).fillColor(TXT)
      .text(`$   ${fmtMoney(val)}`, totX + totLabW, ty, { width: totValW, align: 'right', lineBreak: false });
    ty += Math.max(alto, 11) + 1;
  };
  renglon('SUB-TOTAL', Number(invoice.subtotal || 0));
  const trasl = resumenTraslados(items);
  const rets = resumenRetenciones(items);
  renglon('Total de Impuestos Trasladados', trasl.reduce((a, x) => a + x.importe, 0));
  renglon('Total de Impuestos Retenidos', rets.reduce((a, x) => a + x.importe, 0));
  for (const tr of trasl) renglon(etiquetaTasa(tr), tr.importe);
  for (const re of rets) renglon(`${etiquetaTasa(re)} ret.`, re.importe);
  renglon('TOTAL', Number(invoice.total || 0), { bold: true });

  /* ── QR + datos de pago ── */
  const yBloque = Math.max(yLetra, ty) + 4;
  let yq = yBloque;
  if (qrPng) {
    try { doc.image(qrPng, PAGE_LEFT + 8, yq, { fit: [76, 76] }); } catch { /* sin QR */ }
  }
  const pagoX = PAGE_LEFT + 100, pagoW = 280;
  const fp = String(invoice.payment_form || '').padStart(2, '0');
  const pagos = [
    `CFDI Versión: 4.0`,
    `Moneda: ${invoice.currency || 'MXN'}`,
    `Forma de Pago: ${fp} - ${FORMA_PAGO[fp] || ''}`,
    `Método de Pago: ${invoice.payment_method || ''} - ${METODO_PAGO[invoice.payment_method] || ''}`,
    `Exportación: ${invoice.exportacion || '01'} - No aplica`,
  ];
  doc.font('Helvetica').fontSize(7).fillColor(TXT);
  for (const p of pagos) { doc.text(p, pagoX, yq, { width: pagoW, align: 'right' }); yq = doc.y + 1; }

  /* ── Cadena original y sellos ── */
  y = Math.max(yq, yBloque + 84) + 6;
  const bloque = (titulo: string, contenido: string) => {
    if (!contenido) return;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TXT).text(titulo, pagoX, y, { width: W - (pagoX - PAGE_LEFT) });
    y = doc.y + 1;
    doc.font('Helvetica').fontSize(5).fillColor(TXT)
      .text(contenido, pagoX, y, { width: W - (pagoX - PAGE_LEFT), align: 'justify' });
    y = doc.y + 5;
  };
  if (timbrada) {
    bloque('CADENA ORIGINAL DEL COMPLEMENTO DE CERTIFICACION DIGITAL DEL SAT', cadenaOriginal(t));
    bloque('SELLO DIGITAL DEL SAT', t?.selloSat || '');
    bloque('SELLO DIGITAL DEL EMISOR', t?.selloCfd || '');
  }

  /* ── Pie ── */
  pieLineal(doc, timbrada);
}

/** «YYYY-MM-DDTHH:MM:SS» como lo imprime el formato (igual que el XML). */
function fechaHoraIso(d: any): string {
  const f = d ? new Date(d) : new Date();
  if (Number.isNaN(f.getTime())) return '';
  const s = f.toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' });
  return s.replace(' ', 'T');
}

/** Cadena original del TFD (||1.1|UUID|FechaTimbrado|RfcProvCertif|SelloCFD|NoCertificadoSAT||). */
function cadenaOriginal(t: any): string {
  if (!t?.uuid) return '';
  return `||1.1|${t.uuid}|${t.fechaTimbrado || ''}|${t.rfcProvCertif || ''}|${t.selloCfd || ''}|${t.noCertificadoSat || ''}||`;
}

function pieLineal(doc: PDFDoc, timbrada: boolean): void {
  const y = doc.page.height - 40;
  const m = { ...doc.page.margins };
  doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
  doc.font('Helvetica').fontSize(7).fillColor(GRIS).text(
    timbrada
      ? 'Este documento es una representación impresa de un CFDI'
      : 'Representación borrador — sin sello del SAT no tiene validez fiscal',
    PAGE_LEFT, y, { width: PAGE_RIGHT - PAGE_LEFT, align: 'center', lineBreak: false }
  );
  doc.page.margins = m;
  doc.fillColor('#000000');
}
