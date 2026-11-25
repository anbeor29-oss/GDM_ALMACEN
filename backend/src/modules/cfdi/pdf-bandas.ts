/**
 * pdf-bandas — formato «Bandas» para la FACTURA (CFDI 4.0 de Ingreso).
 * Se usa cuando companies.pdf_formato='bandas'.
 *
 * Rasgos: cada dato va en una pareja BANDA DE COLOR (la etiqueta) + CELDA
 * BLANCA con filete (el valor). Arriba, tres bloques: folio fiscal y certificado
 * a la izquierda, logo y emisor al centro, tipo de comprobante y certificación a
 * la derecha. En medio, el receptor en rejilla. La tabla de conceptos lleva
 * encabezado de color y filetes completos. Abajo, bandas de ancho completo para
 * importe en letra, los dos sellos y la cadena original; y al final QR, datos de
 * pago y totales.
 *
 * Es el más legible de los seis a distancia: cada etiqueta se distingue del
 * valor por el fondo, no por el tamaño de la letra. El color sale del tema de la
 * empresa, no está fijo.
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
const FILETE = '#9ca3af';

export interface CtxBandas {
  company: any; customer: any; invoice: any;
  cat: { regE: string; regR: string; uso: string; unidades?: Record<string, string> };
  logoBuf: Buffer | null;
  t: any;
  qrPng: Buffer | null;
}

const H_BANDA = 12;
const H_CELDA = 13;

export function renderFacturaBandas(doc: PDFDoc, ctx: CtxBandas): void {
  const { company, customer, invoice, cat, logoBuf, t, qrPng } = ctx;
  const W = PAGE_RIGHT - PAGE_LEFT;
  const tema = (doc as any)._tema || getTema((company as any).pdf_formato);
  const BANDA = tema.tablaHeaderBg as string;
  const BANDA_TXT = tema.tablaHeaderText as string;
  const ACENTO = tema.acento as string;

  const items: any[] = invoice.items || [];
  const timbrada = !!(t?.uuid || invoice.cfdi_uuid);

  /** Banda de color con la etiqueta. */
  const banda = (x: number, y: number, w: number, txt: string, align: 'left' | 'center' = 'center', size = 7) => {
    doc.rect(x, y, w, H_BANDA).fill(BANDA);
    doc.font('Helvetica-Bold').fontSize(size).fillColor(BANDA_TXT)
      .text(txt, x + 4, y + 3, { width: w - 8, align, ellipsis: true, lineBreak: false });
    return y + H_BANDA;
  };
  /** Celda blanca con filete: el valor. */
  const celda = (x: number, y: number, w: number, txt: string, align: 'left' | 'center' = 'center', size = 7) => {
    doc.lineWidth(0.5).rect(x, y, w, H_CELDA).stroke(FILETE);
    doc.font('Helvetica').fontSize(size).fillColor(TXT)
      .text(txt || '', x + 4, y + 3.5, { width: w - 8, align, ellipsis: true, lineBreak: false });
    return y + H_CELDA;
  };
  /** Pareja etiqueta + valor, una encima de la otra. */
  const par = (x: number, y: number, w: number, lab: string, val: string, align: 'left' | 'center' = 'center') =>
    celda(x, banda(x, y, w, lab, align), w, val, align);

  /* ── Bloques superiores ── */
  const LX = PAGE_LEFT, LW = 162;
  const RW = 162, RX = PAGE_RIGHT - RW;
  const CX = LX + LW + 10, CW = RX - CX - 10;

  let ly = PAGE_TOP;
  ly = par(LX, ly, LW, 'Folio Fiscal', t?.uuid || invoice.cfdi_uuid || 'PENDIENTE DE TIMBRAR', 'center');
  banda(LX, ly, LW / 2, `Serie: ${invoice.serie || 'A'}`);
  ly = banda(LX + LW / 2, ly, LW / 2, `Folio: ${invoice.folio ?? ''}`);
  ly = par(LX, ly, LW, 'Número de Certificado del Emisor', t?.noCertificado || company.csd_no_certificado || '—');
  ly = par(LX, ly, LW, 'Lugar y Fecha de Emisión',
    `${company.postal_code || ''} ,  ${fechaHoraIso(invoice.date_issued)}`);

  const TIPOS: Record<string, string> = { I: 'Ingreso', E: 'Egreso', T: 'Traslado', N: 'Nómina', P: 'Pago' };
  const tipo = String(invoice.cfdi_type || 'I');
  let ry = PAGE_TOP;
  ry = banda(RX, ry, RW, `${tipo} - ${TIPOS[tipo] || ''}`);
  ry = par(RX, ry, RW, 'Lugar y Fecha de certificación', timbrada ? (t?.fechaTimbrado || '—') : 'Pendiente de timbrar');
  ry = banda(RX, ry, RW, 'Proveedor de Certificación de CFDI');
  doc.font('Helvetica').fontSize(7).fillColor(TXT)
    .text(t?.rfcProvCertif || '—', RX, ry + 3, { width: RW, align: 'center' });
  ry = doc.y + 1;
  doc.fontSize(6).fillColor(GRIS)
    .text(`Número Certificado del SAT: ${t?.noCertificadoSat || '—'}`, RX, ry, { width: RW, align: 'center' });
  ry = doc.y + 2;

  // Centro: logo + emisor
  let cy = PAGE_TOP;
  if (logoBuf) {
    try { doc.image(logoBuf, CX + CW / 2 - 45, cy, { fit: [90, 36], align: 'center' }); cy += 40; }
    catch { /* un logo ilegible no tumba la factura */ }
  }
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TXT)
    .text(String(company.business_name || '').toUpperCase(), CX, cy, { width: CW, align: 'center' });
  cy = doc.y;
  doc.font('Helvetica').fontSize(7.5).text(company.rfc || '—', CX, cy, { width: CW, align: 'center' });
  cy = doc.y + 1;
  doc.fontSize(6.5).fillColor(GRIS)
    .text(`Rég. Fiscal: ${company.fiscal_regime || ''} - ${cat.regE || ''}`.trim(), CX, cy, { width: CW, align: 'center' });

  /* ── Receptor en rejilla ── */
  let y = Math.max(ly, ry, doc.y) + 8;
  const GW = (W - 14) / 2, G1 = PAGE_LEFT, G2 = PAGE_LEFT + GW + 14;

  const fila2 = (x: number, yy: number, w1: number, l1: string, v1: string, w2: number, l2: string, v2: string) => {
    banda(x, yy, w1, l1, 'left'); banda(x + w1, yy, w2, l2, 'left');
    celda(x, yy + H_BANDA, w1, v1, 'left'); celda(x + w1, yy + H_BANDA, w2, v2, 'left');
    return yy + H_BANDA + H_CELDA;
  };
  let y1 = fila2(G1, y, GW * 0.42, 'RFC del Cliente', customer.rfc || '—',
    GW * 0.58, 'Uso CFDI', `${invoice.cfdi_use || '—'} - ${cat.uso || ''}`.trim());
  y1 = celda(G1, banda(G1, y1 + 2, GW, 'Nombre del Cliente', 'left'), GW,
    String(customer.business_name || '').toUpperCase(), 'left');

  let y2 = fila2(G2, y, GW * 0.68, 'Régimen Fiscal del Cliente',
    `${customer.fiscal_regime || ''} - ${cat.regR || ''}`.trim(),
    GW * 0.32, 'Domicilio Fiscal', String(customer.postal_code || '—'));
  y2 = fila2(G2, y2 + 2, GW * 0.5, 'Residencia Fiscal', customer.residencia_fiscal || '',
    GW * 0.5, 'NumRegIdTrib', customer.num_reg_id_trib || '');

  /* ── Conceptos ── */
  y = Math.max(y1, y2) + 8;
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
  const encabezado = (yy: number): number => {
    doc.rect(PAGE_LEFT, yy, W, 14).fill(BANDA);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(BANDA_TXT);
    for (const c of cols) doc.text(c.t, c.x + 2, yy + 4, { width: c.w - 4, align: c.a, lineBreak: false });
    return yy + 14;
  };
  const yTabla = y;
  y = encabezado(y);
  const yTope = doc.page.height - 330;

  for (const it of items) {
    const desc = String(it.description || '');
    const trs = trasladosDeLinea(it);
    const rets = retencionesDeLinea(it);
    const descW = cols[5].w - 4;
    const hDesc = doc.font('Helvetica').fontSize(7).heightOfString(desc, { width: descW });
    const rowH = Math.max(18, hDesc + 10 + (trs.length + rets.length) * 8);

    if (y + rowH > yTope) {
      cerrarTabla(doc, yTabla, y, cols, W);
      doc.addPage(); y = encabezado(PAGE_TOP);
    }

    doc.font('Helvetica').fontSize(7).fillColor(TXT);
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
    for (const c of cols) if (c.k !== 'desc') doc.text(vals[c.k], c.x + 2, y + 3, { width: c.w - 4, align: c.a });

    doc.text(desc, cols[5].x + 2, y + 3, { width: descW });
    let dy = y + 3 + hDesc + 1;
    doc.font('Helvetica-Bold').fontSize(6).fillColor(TXT)
      .text('Objeto de impuesto:', cols[5].x + 2, dy, { width: descW, continued: true })
      .font('Helvetica').text(`  ${objetoImpuesto(it)}`);
    dy += 8;
    for (const [titulo, lista] of [['Impuesto Traslado', trs], ['Impuesto Retenido', rets]] as const) {
      if (!lista.length) continue;
      doc.font('Helvetica-Bold').fontSize(6).fillColor(TXT).text(titulo, cols[5].x + 2, dy, { width: descW });
      dy += 7;
      for (const im of lista as any[]) {
        const txt = im.tipoFactor === 'Exento'
          ? `Base: $ ${fmtMoney(im.base)}    Impuesto: ${im.impuesto}    Tipo Factor: Exento`
          : `Base: $ ${fmtMoney(im.base)}    Impuesto: ${im.impuesto}    Tipo Factor: Tasa    Tasa o Cuota: ${im.tasa.toFixed(6)}    Importe: $ ${fmtMoney(im.importe)}`;
        doc.font('Helvetica').fontSize(5.5).fillColor(GRIS)
          .text(txt, cols[5].x + 2, dy, { width: impW });
        dy = doc.y + 0.5;
      }
    }
    y = Math.max(y + rowH, dy + 3);
  }
  // La tabla llega siempre hasta el mismo renglón: una factura de una línea no
  // debe verse como una hoja a medio llenar.
  y = Math.max(y, Math.min(yTope, yTabla + 170));
  cerrarTabla(doc, yTabla, y, cols, W);
  y += 8;

  /* ── Bandas de ancho completo: letra, sellos, cadena ── */
  const seccion = (titulo: string, contenido: string, size = 5.5) => {
    if (!contenido) return;
    banda(PAGE_LEFT, y, W, titulo, 'left');
    y += H_BANDA + 3;
    doc.font('Helvetica').fontSize(size).fillColor(TXT)
      .text(contenido, PAGE_LEFT + 4, y, { width: W - 8, align: 'justify' });
    y = doc.y + 5;
  };
  seccion('IMPORTE EN LETRAS', montoEnLetra(Number(invoice.total || 0), invoice.currency), 7.5);
  if (timbrada) {
    seccion('SELLO DIGITAL DEL EMISOR', t?.selloCfd || '');
    seccion('SELLO DIGITAL DEL SAT', t?.selloSat || '');
    seccion('CADENA ORIGINAL DEL COMPLEMENTO DE CERTIFICACION DIGITAL DEL SAT', cadenaOriginal(t));
  }

  /* ── QR + pago + totales ── */
  const yPie = y + 4;
  if (qrPng) { try { doc.image(qrPng, PAGE_LEFT + 10, yPie, { fit: [78, 78] }); } catch { /* sin QR */ } }

  const fp = String(invoice.payment_form || '').padStart(2, '0');
  // El ancho se calcula contra donde arrancan los totales: antes el texto de la
  // forma de pago se metía DEBAJO del recuadro y quedaba cortado a la mitad.
  const pagoW = (PAGE_RIGHT - 118 - 100) - (PAGE_LEFT + 96) - 12;
  let py = yPie + 4;
  doc.font('Helvetica').fontSize(7).fillColor(TXT);
  for (const p of [
    'CFDI Versión: 4.0',
    `Moneda: ${invoice.currency || 'MXN'}`,
    `Exportación: ${invoice.exportacion || '01'} - No aplica`,
    `Forma de Pago: ${fp} - ${FORMA_PAGO[fp] || ''}`,
    `Método de Pago: ${invoice.payment_method || ''} - ${METODO_PAGO[invoice.payment_method] || ''}`,
  ]) { doc.text(p, PAGE_LEFT + 96, py, { width: pagoW, align: 'right', lineBreak: false }); py = doc.y + 1; }

  const trasl = resumenTraslados(items);
  const rets = resumenRetenciones(items);
  const tLabW = 118, tValW = 100;
  const tLabX = PAGE_RIGHT - tLabW - tValW;
  let ty = yPie;
  const renglon = (lab: string, val: number, fuerte = false) => {
    doc.rect(tLabX, ty, tLabW, H_CELDA).fill(BANDA);
    doc.font('Helvetica-Bold').fontSize(fuerte ? 8 : 6.5).fillColor(BANDA_TXT)
      .text(lab, tLabX + 4, ty + (fuerte ? 3 : 4), { width: tLabW - 8, lineBreak: false });
    doc.lineWidth(0.5).rect(tLabX + tLabW, ty, tValW, H_CELDA).stroke(FILETE);
    doc.font(fuerte ? 'Helvetica-Bold' : 'Helvetica').fontSize(fuerte ? 8 : 7.5).fillColor(fuerte ? ACENTO : TXT)
      .text(`$   ${fmtMoney(val)}`, tLabX + tLabW + 4, ty + 3.5, { width: tValW - 8, align: 'right', lineBreak: false });
    ty += H_CELDA;
  };
  renglon('SUB-TOTAL', Number(invoice.subtotal || 0));
  renglon('Total de Impuestos Trasladados', trasl.reduce((a, x) => a + x.importe, 0));
  renglon('Total de Impuestos Retenidos', rets.reduce((a, x) => a + x.importe, 0));
  for (const tr of trasl) renglon(etiquetaTasa(tr), tr.importe);
  for (const re of rets) renglon(`${etiquetaTasa(re)} ret.`, re.importe);
  renglon('TOTAL', Number(invoice.total || 0), true);

  pieBandas(doc, timbrada);
}

/** Filetes verticales y marco de la tabla, una vez que se sabe dónde cerró. */
function cerrarTabla(doc: PDFDoc, yIni: number, yFin: number, cols: Array<{ x: number }>, W: number): void {
  doc.lineWidth(0.5);
  for (const c of cols) if (c.x > PAGE_LEFT) doc.moveTo(c.x, yIni + 14).lineTo(c.x, yFin).stroke(FILETE);
  doc.rect(PAGE_LEFT, yIni, W, yFin - yIni).stroke(FILETE);
}

function fechaHoraIso(d: any): string {
  const f = d ? new Date(d) : new Date();
  if (Number.isNaN(f.getTime())) return '';
  return f.toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' }).replace(' ', 'T');
}

function cadenaOriginal(t: any): string {
  if (!t?.uuid) return '';
  return `||1.1|${t.uuid}|${t.fechaTimbrado || ''}|${t.rfcProvCertif || ''}|${t.selloCfd || ''}|${t.noCertificadoSat || ''}||`;
}

function pieBandas(doc: PDFDoc, timbrada: boolean): void {
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
