/**
 * pdf-farsystems — réplica "al pie de la letra" del formato FarSystems para la
 * FACTURA (CFDI 4.0 de Ingreso). Se usa cuando companies.pdf_formato='farsystems'.
 *
 * Rasgos del formato: todo en CAJAS con borde; cabecera a dos columnas (logo +
 * datos del emisor a la izquierda; caja azul con «Factura», folio en ROJO y los
 * identificadores fiscales a la derecha); franja de metadatos (Moneda/TC/Tipo/
 * Versión + Exportación/Objeto); tabla de conceptos con encabezado azul y columnas
 * Clave SAT · Descripción · Código Interno · Cantidad · Unidad · Precio Unit. ·
 * Impuesto · Importe; importe con letra + caja de totales; forma/cuenta/método;
 * sellos + cadena original + QR; pie «REPRESENTACIÓN IMPRESA DE UN CFDI».
 *
 * El LAYOUT cambia, pero el contenido es el mismo CFDI válido (mismos datos).
 */
import {
  PDFDoc, PAGE_LEFT, PAGE_RIGHT, PAGE_TOP, fmtMoney, montoEnLetra,
  FORMA_PAGO, METODO_PAGO,
} from './pdf-helpers';

const AZUL = '#1d4ed8';     // azul FarSystems (cabeceras)
const AZUL_SUAVE = '#dbeafe';
const ROJO = '#dc2626';     // folio
const BORDE = '#9ca3af';
const TXT = '#111827';
const GRIS = '#6b7280';

export interface CtxFarsystems {
  company: any; customer: any; invoice: any;
  cat: { regE: string; regR: string; uso: string };
  logoBuf: Buffer | null;
  t: any;                   // extractTimbreData(xml)
  qrPng: Buffer | null;
}

export function renderFacturaFarsystems(doc: PDFDoc, ctx: CtxFarsystems): void {
  const { company, customer, invoice, cat, logoBuf, t, qrPng } = ctx;
  const W = PAGE_RIGHT - PAGE_LEFT;

  const box = (x: number, y: number, w: number, h: number) =>
    doc.lineWidth(0.7).rect(x, y, w, h).stroke(BORDE);
  const bar = (x: number, y: number, w: number, h: number, color = AZUL) =>
    doc.rect(x, y, w, h).fill(color);

  // ───────── Página (texto chico, arriba-derecha) ─────────
  doc.font('Helvetica').fontSize(7).fillColor(GRIS)
    .text('Página 1', PAGE_RIGHT - 60, PAGE_TOP - 2, { width: 60, align: 'right' });

  // ───────── Cabecera: dos cajas ─────────
  const hY = PAGE_TOP + 8;
  const hH = 128;
  const leftW = 335;
  const rightX = PAGE_LEFT + leftW + 10;
  const rightW = PAGE_RIGHT - rightX;

  // Caja izquierda: logo + datos del emisor
  box(PAGE_LEFT, hY, leftW, hH);
  let lx = PAGE_LEFT + 8;
  if (logoBuf) {
    try { doc.image(logoBuf, PAGE_LEFT + 8, hY + 10, { fit: [52, 52], align: 'center', valign: 'center' }); lx = PAGE_LEFT + 68; } catch { /* sin logo */ }
  }
  const emW = PAGE_LEFT + leftW - lx - 8;
  let ly = hY + 8;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(TXT)
    .text(String(company.business_name || '').toUpperCase(), lx, ly, { width: emW });
  ly = doc.y + 1;
  doc.font('Helvetica').fontSize(7.5).fillColor(TXT);
  const dir = [
    [company.street, company.ext_number ? `No. ${company.ext_number}` : ''].filter(Boolean).join(' '),
    [company.neighborhood, company.municipality, company.state].filter(Boolean).join(', '),
    [company.postal_code ? `C.P. ${company.postal_code}` : '', 'México'].filter(Boolean).join(' '),
  ].filter((s) => s.trim());
  doc.text(`RFC: ${company.rfc || '—'}`, lx, ly, { width: emW }); ly = doc.y;
  for (const d of dir) { doc.text(d, lx, ly, { width: emW }); ly = doc.y; }
  doc.text(`${company.fiscal_regime || ''} ${cat.regE || ''}`.trim(), lx, ly, { width: emW }); ly = doc.y;
  if (company.phone) doc.text(`Tel. ${company.phone}`, lx, ly, { width: emW });

  // Caja derecha: título azul + folio ROJO + identificadores fiscales
  box(rightX, hY, rightW, hH);
  bar(rightX, hY, rightW, 16, AZUL);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff')
    .text('Factura', rightX, hY + 4, { width: rightW, align: 'center' });
  const folioStr = `${invoice.serie || 'FAC'}-${String(invoice.folio).padStart(6, '0')}`;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(ROJO)
    .text(folioStr, rightX, hY + 20, { width: rightW, align: 'center' });

  const fiscal: Array<[string, string]> = [
    ['Certificado del Emisor', t.noCertificado || company.csd_no_certificado || '—'],
    ['Certificado del SAT', t.noCertificadoSat || '—'],
    ['Folio Fiscal', t.uuid || invoice.cfdi_uuid || 'PENDIENTE DE TIMBRAR'],
    ['Fecha Timbrado', t.fechaTimbrado ? String(t.fechaTimbrado).replace('T', ' ') : '—'],
    ['Lugar de Expedición', company.postal_code || '—'],
  ];
  let fy = hY + 40;
  const fLabelH = 10;
  for (const [label, value] of fiscal) {
    bar(rightX, fy, rightW, fLabelH, AZUL_SUAVE);
    doc.font('Helvetica-Bold').fontSize(6).fillColor(AZUL)
      .text(label, rightX + 3, fy + 2, { width: rightW - 6 });
    doc.font('Helvetica').fontSize(6).fillColor(TXT)
      .text(value, rightX + 3, fy + fLabelH + 0.5, { width: rightW - 6, lineBreak: false });
    fy += fLabelH + 6.5;
  }

  // ───────── Caja de cliente ─────────
  let y = hY + hH + 8;
  const cliH = 60;
  box(PAGE_LEFT, y, W, cliH);
  bar(PAGE_LEFT, y, 120, 12, AZUL);
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff').text('Datos del Cliente', PAGE_LEFT + 4, y + 2.5);
  doc.font('Helvetica').fontSize(7.5).fillColor(TXT);
  let cy = y + 15;
  const kvCliente = (label: string, value: string) => {
    doc.font('Helvetica-Bold').fillColor(GRIS).text(label, PAGE_LEFT + 6, cy, { continued: true })
      .font('Helvetica').fillColor(TXT).text(`  ${value}`);
    cy = doc.y + 1;
  };
  const domCli = [customer.street, customer.neighborhood, customer.postal_code ? `C.P. ${customer.postal_code}` : '',
    customer.municipality, customer.state, 'México'].filter(Boolean).join(', ');
  kvCliente('Cliente:', String(customer.business_name || '').toUpperCase());
  doc.font('Helvetica-Bold').fillColor(GRIS).fontSize(7.5)
    .text('R.F.C.:', PAGE_LEFT + 6, cy, { continued: true }).font('Helvetica').fillColor(TXT).text(`  ${customer.rfc || '—'}`, { continued: true })
    .font('Helvetica-Bold').fillColor(GRIS).text('     Régimen:', { continued: true }).font('Helvetica').fillColor(TXT)
    .text(`  ${customer.fiscal_regime || ''} ${cat.regR || ''}`.trim());
  cy = doc.y + 1;
  kvCliente('Domicilio:', domCli || '—');
  kvCliente('Uso CFDI:', `(${invoice.cfdi_use || '—'}) ${cat.uso || ''}`.trim());

  // ───────── Franja de metadatos ─────────
  y += cliH + 6;
  const metaH = 16;
  box(PAGE_LEFT, y, W, metaH);
  const metas: Array<[string, string]> = [
    ['Moneda', invoice.currency || 'MXN'],
    ['Tipo de cambio', Number(invoice.exchange_rate || 1).toFixed(6)],
    ['Tipo de comprobante', `${invoice.cfdi_type || 'I'} Ingreso`],
    ['Versión', '4.0'],
  ];
  const cellW = W / metas.length;
  metas.forEach(([l, v], i) => {
    const cx = PAGE_LEFT + i * cellW;
    if (i > 0) doc.lineWidth(0.5).moveTo(cx, y).lineTo(cx, y + metaH).stroke(BORDE);
    doc.font('Helvetica-Bold').fontSize(6).fillColor(GRIS).text(l, cx + 4, y + 2.5, { width: cellW - 8 });
    doc.font('Helvetica').fontSize(7.5).fillColor(TXT).text(v, cx + 4, y + 8, { width: cellW - 8, lineBreak: false });
  });

  // ───────── Tabla de conceptos ─────────
  y += metaH + 8;
  const cols = [
    { k: 'clave',  t: 'Clave SAT',    x: PAGE_LEFT,       w: 50,  a: 'left'  as const },
    { k: 'desc',   t: 'Descripción',  x: PAGE_LEFT + 50,  w: 150, a: 'left'  as const },
    { k: 'codigo', t: 'Código Interno', x: PAGE_LEFT + 200, w: 60, a: 'left' as const },
    { k: 'cant',   t: 'Cantidad',     x: PAGE_LEFT + 260, w: 45,  a: 'right' as const },
    { k: 'unidad', t: 'Unidad',       x: PAGE_LEFT + 305, w: 40,  a: 'left'  as const },
    { k: 'pu',     t: 'Precio Unit.', x: PAGE_LEFT + 345, w: 55,  a: 'right' as const },
    { k: 'imp',    t: 'Impuesto',     x: PAGE_LEFT + 400, w: 55,  a: 'right' as const },
    { k: 'importe',t: 'Importe',      x: PAGE_LEFT + 455, w: W - 455, a: 'right' as const },
  ];
  const thY = y;
  bar(PAGE_LEFT, thY, W, 16, AZUL);
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#ffffff');
  for (const c of cols) doc.text(c.t, c.x + 3, thY + 5, { width: c.w - 6, align: c.a });
  y = thY + 16;

  doc.font('Helvetica').fontSize(7).fillColor(TXT);
  const items = invoice.items || [];
  items.forEach((it: any, idx: number) => {
    const desc = String(it.description || '');
    const descH = doc.heightOfString(desc, { width: cols[1].w - 6, lineGap: 0 });
    const rowH = Math.max(14, descH + 6);
    if (idx % 2 === 1) doc.rect(PAGE_LEFT, y, W, rowH).fill('#f3f4f6');
    doc.fillColor(TXT).font('Helvetica').fontSize(7);
    const vals: Record<string, string> = {
      clave: it.clave_sat || '',
      desc,
      codigo: (it as any).no_identificacion || (it as any).sku || String(idx + 1).padStart(10, '0'),
      cant: Number(it.quantity || 0).toFixed(2),
      unidad: it.unit_code || '',
      pu: `$${fmtMoney(it.unit_price)}`,
      imp: `$${fmtMoney(it.tax_amount)}`,
      importe: `$${fmtMoney(it.subtotal != null ? it.subtotal : Number(it.quantity) * Number(it.unit_price))}`,
    };
    for (const c of cols) doc.text(vals[c.k], c.x + 3, y + 3, { width: c.w - 6, align: c.a });
    y += rowH;
    doc.lineWidth(0.4).moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).stroke('#e5e7eb');
  });
  doc.lineWidth(0.7).rect(PAGE_LEFT, thY, W, y - thY).stroke(BORDE);

  // ───────── Importe con letra + totales ─────────
  y += 8;
  const totW = 180;
  const totX = PAGE_RIGHT - totW;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TXT)
    .text(`SON: ${montoEnLetra(Number(invoice.total), invoice.currency || 'MXN')}`, PAGE_LEFT, y, { width: totX - PAGE_LEFT - 10 });

  const totales: Array<[string, number, boolean]> = [
    ['Suma', Number(invoice.subtotal || 0), false],
    ['Descuento', Number(invoice.discount || 0), false],
    ['Subtotal', Number(invoice.subtotal || 0) - Number(invoice.discount || 0), false],
    ['IVA 16%', Number(invoice.tax_transferred || invoice.iva || 0), false],
    ['Total', Number(invoice.total || 0), true],
  ];
  let ty = y;
  for (const [label, val, big] of totales) {
    if (big) { bar(totX, ty, totW, 15, AZUL); doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9); }
    else { doc.fillColor(TXT).font('Helvetica').fontSize(8); }
    doc.text(label + ':', totX + 6, ty + (big ? 3.5 : 1), { width: 90 });
    doc.text(`$${fmtMoney(val)}`, totX + 96, ty + (big ? 3.5 : 1), { width: totW - 102, align: 'right' });
    ty += big ? 15 : 12;
  }
  doc.lineWidth(0.7).rect(totX, y, totW, ty - y).stroke(BORDE);

  // ───────── Forma / Cuenta / Método ─────────
  y = Math.max(ty, y + 60) + 8;
  doc.font('Helvetica-Bold').fontSize(7).fillColor(GRIS)
    .text('Forma de pago:', PAGE_LEFT, y, { continued: true }).font('Helvetica').fillColor(TXT)
    .text(`  ${String(invoice.payment_form || '').padStart(2, '0')} ${FORMA_PAGO[String(invoice.payment_form || '').padStart(2, '0')] || ''}`);
  doc.font('Helvetica-Bold').fillColor(GRIS)
    .text('Método de pago:', PAGE_LEFT, doc.y + 1, { continued: true }).font('Helvetica').fillColor(TXT)
    .text(`  ${invoice.payment_method || ''} ${METODO_PAGO[invoice.payment_method] || ''}`);

  // ───────── Sellos + cadena original ─────────
  y = doc.y + 8;
  const sello = (label: string, value: string) => {
    doc.font('Helvetica-Bold').fontSize(6).fillColor(AZUL).text(label, PAGE_LEFT, y);
    doc.font('Courier').fontSize(5).fillColor(TXT).text(value || '—', PAGE_LEFT, doc.y, { width: W });
    y = doc.y + 3;
  };
  const cadena = `||1.1|${t.uuid || ''}|${t.fechaTimbrado || ''}|${t.rfcProvCertif || ''}|${t.selloCfd || ''}|${t.noCertificadoSat || ''}||`;
  sello('Sello Digital del CFDI', t.selloCfd || '');
  sello('Sello del SAT', t.selloSat || '');
  sello('Cadena Original del Complemento de Certificación Digital del SAT', cadena);

  // ───────── QR + PAC + pie ─────────
  if (qrPng) { try { doc.image(qrPng, PAGE_LEFT, y, { fit: [78, 78] }); } catch { /* sin QR */ } }
  doc.font('Helvetica').fontSize(6).fillColor(GRIS)
    .text(`Folio Fiscal: ${t.uuid || invoice.cfdi_uuid || '—'}`, PAGE_LEFT + 88, y + 8, { width: W - 88 })
    .text(`No. de Serie del Certificado del SAT: ${t.noCertificadoSat || '—'}`, PAGE_LEFT + 88, doc.y, { width: W - 88 })
    .text(`Fecha y hora de certificación: ${t.fechaTimbrado ? String(t.fechaTimbrado).replace('T', ' ') : '—'}`, PAGE_LEFT + 88, doc.y, { width: W - 88 });

  doc.font('Helvetica-Bold').fontSize(7).fillColor(GRIS)
    .text('ESTE DOCUMENTO ES UNA REPRESENTACIÓN IMPRESA DE UN CFDI', PAGE_LEFT, Math.max(doc.y, y + 82) + 6, { width: W, align: 'center' });
}
