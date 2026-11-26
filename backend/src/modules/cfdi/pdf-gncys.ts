/**
 * pdf-gncys — réplica del formato "GNcys" para la FACTURA (CFDI 4.0 de Ingreso).
 * Se usa cuando companies.pdf_formato='gncys'.
 *
 * Rasgos: nombre del emisor GRANDE arriba-izquierda + distintivo «CFDI 4.0»
 * arriba-derecha; emisor con etiquetas (RFC emisor, dirección, Tel., E-Mail);
 * línea divisoria; receptor (izq) y datos fiscales/folio (der) a dos columnas;
 * tabla de Conceptos con bordes finos y encabezado claro (Cve del producto/
 * servicio · No. identificación · Cantidad · Clave unidad · Unidad · Descripción ·
 * Valor unitario · Importe), sub-tabla de Traslados; Moneda/Forma/Método (izq) y
 * totales con columna «$» (der); total con letra; sellos + cadena original + QR;
 * pie «Este documento es una representación impresa de un CFDI».
 *
 * El layout cambia; el contenido es el MISMO CFDI válido. No se usa marca de
 * ningún proveedor (sólo los datos del emisor real).
 */
import {
  PDFDoc, PAGE_LEFT, PAGE_RIGHT, PAGE_TOP, fmtMoney, fmtPrecio, fmtCantidad, montoEnLetra,
  FORMA_PAGO, METODO_PAGO,
} from './pdf-helpers';
import { marcaNexo, lineaAlPie, LEYENDA_COMPROBANTE } from '../../utils/pie-nexo';
import { resumenTraslados, resumenRetenciones, etiquetaImpuesto, porcentaje } from './pdf-impuestos';

const TINTA = '#1e3a8a';   // azul marino sobrio (encabezados/etiquetas)
const TXT = '#1f2937';
const GRIS = '#6b7280';
const LINEA = '#9ca3af';

export interface CtxGncys {
  company: any; customer: any; invoice: any;
  cat: { regE: string; regR: string; uso: string; unidades?: Record<string, string> };
  logoBuf: Buffer | null;
  t: any;
  qrPng: Buffer | null;
}

export function renderFacturaGncys(doc: PDFDoc, ctx: CtxGncys): void {
  const { company, customer, invoice, cat, logoBuf, t, qrPng } = ctx;
  const W = PAGE_RIGHT - PAGE_LEFT;
  const MID = PAGE_LEFT + W * 0.52;

  const hline = (y: number, x1 = PAGE_LEFT, x2 = PAGE_RIGHT) =>
    doc.lineWidth(0.7).moveTo(x1, y).lineTo(x2, y).stroke(LINEA);
  const label = (txt: string, val: string, x: number, y: number, w: number) => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TXT).text(txt, x, y, { width: w, continued: true })
      .font('Helvetica').fillColor(TXT).text(` ${val}`);
  };

  // ───────── Encabezado ─────────
  doc.font('Helvetica').fontSize(7).fillColor(GRIS)
    .text('Página 1', PAGE_RIGHT - 60, PAGE_TOP - 4, { width: 60, align: 'right' });

  let y = PAGE_TOP + 4;
  if (logoBuf) { try { doc.image(logoBuf, PAGE_LEFT, y, { fit: [60, 60] }); } catch { /* sin logo */ } }
  const nameX = logoBuf ? PAGE_LEFT + 70 : PAGE_LEFT;
  doc.font('Helvetica-Bold').fontSize(20).fillColor(TXT)
    .text(String(company.business_name || '').toUpperCase(), nameX, y, { width: 360 });
  /* Hay que guardar la Y AQUI. El «CFDI 4.0» de abajo tambien escribe y deja
   * doc.y en SU renglon —arriba a la derecha—: si el domicilio arrancara de
   * ahi, se encimaria con el nombre en cuanto este ocupe dos lineas, que es lo
   * que pasa con cualquier razon social larga. */
  const yNombre = doc.y;

  // Distintivo CFDI 4.0 (texto, no logo de terceros)
  doc.font('Helvetica-Bold').fontSize(9).fillColor(TINTA)
    .text('CFDI 4.0', PAGE_RIGHT - 80, y + 2, { width: 80, align: 'right' });

  // Datos del emisor (debajo del nombre)
  let ey = yNombre + 2;
  const emW = 360;
  label('RFC emisor:', company.rfc || '—', nameX, ey, emW); ey = doc.y;
  doc.font('Helvetica').fontSize(7.5).fillColor(TXT);
  const emisorDir = [
    [company.street, company.ext_number ? `No. Ext. ${company.ext_number}` : ''].filter(Boolean).join(' '),
    company.neighborhood ? `Col. ${company.neighborhood}` : '',
    [company.municipality, company.state, company.postal_code ? `C.P. ${company.postal_code}` : ''].filter(Boolean).join(', '),
    `${company.fiscal_regime || ''} ${cat.regE || ''}`.trim(),
  ].filter((s) => s && s.trim());
  for (const d of emisorDir) { doc.text(d, nameX, ey, { width: emW }); ey = doc.y; }
  if (company.phone) { doc.text(`Tel.: ${company.phone}`, nameX, ey, { width: emW }); ey = doc.y; }
  if (company.email) { doc.text(`E-Mail: ${company.email}`, nameX, ey, { width: emW }); ey = doc.y; }

  y = Math.max(ey, y + 64) + 6;
  hline(y); y += 6;

  // ───────── Receptor (izq) + Fiscal/Folio (der) ─────────
  const colLW = MID - PAGE_LEFT - 8;
  const colRX = MID + 2;
  const colRW = PAGE_RIGHT - colRX;
  let ly = y, ry = y;

  const kvL = (lab: string, val: string) => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TINTA).text(lab, PAGE_LEFT, ly, { width: colLW, continued: true })
      .font('Helvetica').fillColor(TXT).text(` ${val}`, { width: colLW });
    ly = doc.y + 1;
  };
  const kvR = (lab: string, val: string) => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TINTA).text(lab, colRX, ry, { width: colRW, continued: true })
      .font('Helvetica').fillColor(TXT).text(` ${val}`, { width: colRW });
    ry = doc.y + 1;
  };

  const domR = [customer.street, customer.neighborhood,
    [customer.municipality, customer.state, customer.postal_code ? `C.P. ${customer.postal_code}` : ''].filter(Boolean).join(', '),
    'México'].filter((s) => s && String(s).trim()).join(', ');
  kvL('Nombre receptor:', String(customer.business_name || '').toUpperCase());
  kvL('RFC receptor:', customer.rfc || '—');
  kvL('Uso CFDI:', `${invoice.cfdi_use || '—'} - ${cat.uso || ''}`.trim());
  kvL('Régimen receptor:', `${customer.fiscal_regime || ''} ${cat.regR || ''}`.trim());
  kvL('Dirección:', domR || '—');

  kvR('Folio fiscal:', t.uuid || invoice.cfdi_uuid || 'PENDIENTE DE TIMBRAR');
  kvR('No. de serie del CSD:', t.noCertificado || company.csd_no_certificado || '—');
  kvR('Fecha y hora de emisión:', `${company.postal_code || ''}  ${new Date(invoice.date_issued).toLocaleString('es-MX')}`);
  kvR('Efecto de comprobante:', `${invoice.cfdi_type || 'I'} - Ingreso`);
  kvR('Folio y serie:', `${invoice.serie || 'FAC'}-${String(invoice.folio).padStart(6, '0')}`);
  kvR('Régimen fiscal:', `${company.fiscal_regime || ''} - ${cat.regE || ''}`.trim());

  y = Math.max(ly, ry) + 4;
  hline(y); y += 6;

  // ───────── Conceptos ─────────
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TXT).text('Conceptos', PAGE_LEFT, y);
  y = doc.y + 3;
  const cols = [
    { k: 'cve',    t: 'Cve del\nproducto/servicio', x: PAGE_LEFT,       w: 66,  a: 'left'  as const },
    { k: 'noid',   t: 'No.\nidentificación',        x: PAGE_LEFT + 66,  w: 52,  a: 'left'  as const },
    { k: 'cant',   t: 'Cantidad',                   x: PAGE_LEFT + 118, w: 50,  a: 'right' as const },
    { k: 'claveu', t: 'Clave\nunidad',              x: PAGE_LEFT + 168, w: 42,  a: 'left'  as const },
    { k: 'unidad', t: 'Unidad',                     x: PAGE_LEFT + 210, w: 40,  a: 'left'  as const },
    { k: 'desc',   t: 'Descripción',                x: PAGE_LEFT + 250, w: 120, a: 'left'  as const },
    { k: 'vu',     t: 'Valor unitario',             x: PAGE_LEFT + 370, w: 68,  a: 'right' as const },
    { k: 'imp',    t: 'Importe',                     x: PAGE_LEFT + 438, w: W - 438, a: 'right' as const },
  ];
  const thY = y;
  doc.rect(PAGE_LEFT, thY, W, 20).fill('#eef2ff');
  doc.font('Helvetica-Bold').fontSize(6).fillColor(TINTA);
  for (const c of cols) doc.text(c.t, c.x + 3, thY + 3, { width: c.w - 6, align: c.a });
  y = thY + 20;
  for (const c of cols) if (c.x > PAGE_LEFT) doc.lineWidth(0.4).moveTo(c.x, thY).lineTo(c.x, thY + 20).stroke('#c7d2fe');

  doc.font('Helvetica').fontSize(7.5).fillColor(TXT);
  const items = invoice.items || [];
  items.forEach((it: any, idx: number) => {
    const desc = String(it.description || '');
    const descH = doc.heightOfString(desc, { width: cols[5].w - 6 });
    const rowH = Math.max(16, descH + 8);
    const vals: Record<string, string> = {
      cve: it.clave_sat || '',
      noid: (it as any).no_identificacion || (it as any).sku || String(idx + 1).padStart(10, '0'),
      cant: fmtCantidad(it.quantity),
      claveu: it.unit_code || '',
      unidad: cat.unidades?.[String(it.unit_code || '')] || '',
      desc,
      vu: fmtPrecio(it.unit_price),
      imp: fmtMoney(it.subtotal != null ? it.subtotal : Number(it.quantity) * Number(it.unit_price)),
    };
    /* La descripcion SI puede ocupar varias lineas —el alto de la fila se
     * calculo con ella—; las demas celdas van a un solo renglon con ellipsis,
     * que es lo que evita que una cantidad de 6 decimales salga partida en dos
     * («400.00000» y debajo un «0» suelto). */
    for (const c of cols) {
      // «Unidad» tambien necesita dos renglones («Unidad de servicio»); el
      // recorte a una linea es solo para los codigos y las cifras.
      const unaLinea = c.k !== 'desc' && c.k !== 'unidad';
      doc.text(vals[c.k], c.x + 3, y + 3, {
        width: c.w - 6, align: c.a,
        ...(unaLinea ? { height: 11, ellipsis: true, lineBreak: false } : {}),
      });
    }
    y += rowH;
    for (const c of cols) if (c.x > PAGE_LEFT) doc.lineWidth(0.4).moveTo(c.x, thY + 20).lineTo(c.x, y).stroke('#e5e7eb');
    doc.lineWidth(0.4).moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).stroke('#e5e7eb');
  });

  /* Traslados y retenciones: UN RENGLON POR GRUPO, con la tasa que de verdad
   * trae la factura.
   *
   * Antes este bloque iba escrito a mano —Impuesto «IVA», Tipo factor «Tasa»,
   * Tasa o cuota «16.0000»— porque casi todas las facturas son al 16 %. Una de
   * zona fronteriza al 8 %, una exenta o una con IEPS salia con la tasa
   * EQUIVOCADA impresa en el papel que recibe el cliente, mientras el XML decia
   * otra cosa. Los grupos se arman igual que en el comprobante (impuesto + tipo
   * factor + tasa), asi que dos lineas al 16 % son un renglon y una al 16 % con
   * otra al 8 % son dos. */
  const traslados = resumenTraslados(invoice.items || []);
  const retenidos = resumenRetenciones(invoice.items || []);
  const ivaTot = traslados.reduce((a, t2) => a + t2.importe, 0);
  const retTot = retenidos.reduce((a, r2) => a + r2.importe, 0);

  const trX = PAGE_LEFT + 250;
  const COLS_IMP: Array<[string, number]> = [['Base', 60], ['Impuesto', 60], ['Tipo factor', 60], ['Tasa o cuota', 60], ['Importe', 60]];
  let trY = y + 2;

  const bloqueImpuestos = (titulo: string, filas: string[][]) => {
    if (!filas.length) return;
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(GRIS).text(titulo, trX, trY);
    let cx = trX;
    doc.fontSize(6);
    for (const [l] of COLS_IMP) {
      doc.font('Helvetica-Bold').fillColor(GRIS).text(l, cx, trY + 9, { width: 60 });
      cx += 61;
    }
    let fy = trY + 17;
    for (const fila of filas) {
      cx = trX;
      for (const celda of fila) {
        doc.font('Helvetica').fontSize(6).fillColor(TXT).text(celda, cx, fy, { width: 60, lineBreak: false, ellipsis: true });
        cx += 61;
      }
      fy += 8;
    }
    trY = fy + 3;
  };

  bloqueImpuestos('TRASLADOS', traslados.map((t2) => ([
    fmtMoney(t2.base), `${t2.impuesto} ${t2.nombre}`, t2.tipoFactor,
    t2.tipoFactor === 'Exento' ? '—' : t2.tasa.toFixed(6),
    t2.tipoFactor === 'Exento' ? '—' : fmtMoney(t2.importe),
  ])));
  bloqueImpuestos('RETENCIONES', retenidos.map((r2) => ([
    fmtMoney(r2.base), `${r2.impuesto} ${r2.nombre}`, 'Tasa', r2.tasa.toFixed(6), fmtMoney(r2.importe),
  ])));

  doc.lineWidth(0.7).rect(PAGE_LEFT, thY, W, trY - thY).stroke(LINEA);
  y = trY + 6;

  // ───────── Moneda/Forma/Método (izq) + Totales (der) ─────────
  const totX = PAGE_RIGHT - 190;
  let my = y;
  const mp = (l: string, v: string) => { doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GRIS).text(l, PAGE_LEFT, my, { continued: true }).font('Helvetica').fillColor(TXT).text(` ${v}`); my = doc.y + 1; };
  mp('Moneda:', invoice.currency || 'MXN');
  mp('Forma de pago:', `${String(invoice.payment_form || '').padStart(2, '0')} - ${FORMA_PAGO[String(invoice.payment_form || '').padStart(2, '0')] || ''}`);
  mp('Método de pago:', `${invoice.payment_method || ''} - ${METODO_PAGO[invoice.payment_method] || ''}`);
  if (invoice.payment_terms) mp('Condiciones de pago:', String(invoice.payment_terms));

  const totales: Array<[string, number, boolean]> = [
    ['Subtotal:', Number(invoice.subtotal || 0), false],
    ['Descuentos:', Number(invoice.discount || 0), false],
    // Un renglon por tasa real; nada de «IVA 16%» escrito a mano.
    ...traslados
      .filter((t2) => t2.tipoFactor !== 'Exento')
      .map((t2) => [`${etiquetaImpuesto(t2)}:`, t2.importe, false] as [string, number, boolean]),
    ...retenidos.map((r2) => [`${etiquetaImpuesto(r2, true)}:`, -r2.importe, false] as [string, number, boolean]),
    ['TOTAL', Number(invoice.total || 0), true],
  ];
  let ty = y;
  for (const [l, v, big] of totales) {
    doc.font(big ? 'Helvetica-Bold' : 'Helvetica').fontSize(big ? 10 : 8).fillColor(big ? TINTA : TXT);
    doc.text(l, totX, ty, { width: 95 });
    doc.text('$', totX + 96, ty, { width: 10 });
    doc.text(fmtMoney(v), totX + 106, ty, { width: 84, align: 'right' });
    doc.lineWidth(0.4).moveTo(totX + 106, ty + (big ? 13 : 10)).lineTo(PAGE_RIGHT, ty + (big ? 13 : 10)).stroke('#e5e7eb');
    ty += big ? 16 : 12;
  }
  y = Math.max(my, ty) + 6;

  // ───────── Total con letra ─────────
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TXT).text('Total con letra:', PAGE_LEFT, y);
  doc.font('Helvetica').text(montoEnLetra(Number(invoice.total), invoice.currency || 'MXN'), PAGE_LEFT, doc.y, { width: W });
  y = doc.y + 6;

  // ───────── Sellos + cadena ─────────
  const sello = (lab: string, val: string) => {
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(TINTA).text(lab, PAGE_LEFT, y);
    doc.font('Courier').fontSize(5).fillColor(TXT).text(val || '—', PAGE_LEFT, doc.y, { width: W });
    y = doc.y + 3;
  };
  const cadena = `||1.1|${t.uuid || ''}|${t.fechaTimbrado || ''}|${t.rfcProvCertif || ''}|${t.selloCfd || ''}|${t.noCertificadoSat || ''}||`;
  sello('Sello digital del CFDI:', t.selloCfd || '');
  sello('Sello digital del SAT:', t.selloSat || '');
  sello('Cadena Original del complemento de certificación digital del SAT:', cadena);

  // ───────── QR + datos de certificación + pie ─────────
  if (qrPng) { try { doc.image(qrPng, PAGE_LEFT, y, { fit: [78, 78] }); } catch { /* sin QR */ } }
  doc.font('Helvetica').fontSize(6.5).fillColor(TXT)
    .text(`Folio fiscal: ${t.uuid || invoice.cfdi_uuid || '—'}`, PAGE_LEFT + 88, y + 10, { width: W - 88 })
    .text(`No de serie del certificado del SAT: ${t.noCertificadoSat || '—'}`, PAGE_LEFT + 88, doc.y + 2, { width: W - 88 })
    .text(`Fecha y hora de certificación: ${t.fechaTimbrado ? String(t.fechaTimbrado).replace('T', ' ') : '—'}`, PAGE_LEFT + 88, doc.y + 2, { width: W - 88 });

  const legY = Math.max(doc.y, y + 82) + 8;
  lineaAlPie(doc, 'Este documento es una representación impresa de un CFDI',
    { y: legY, x: PAGE_LEFT, ancho: W, color: GRIS });

  // Marca de la casa bajo la leyenda (la pieza vive en utils/pie-nexo).
  marcaNexo(doc, { y: legY + 11, alto: 12, leyenda: LEYENDA_COMPROBANTE, color: '#64748b', x: PAGE_LEFT, ancho: W });
}
