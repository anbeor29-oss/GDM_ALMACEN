/**
 * pdf-recibo-detallado — segundo formato del RECIBO DE NÓMINA (CFDI 4.0 tipo N
 * con complemento nómina 1.2). Se usa cuando companies.recibo_formato='detallado'.
 *
 * Qué lo distingue del clásico: percepciones y deducciones en DOS TABLAS lado a
 * lado con su agrupador del SAT y su clave, caja de totales con el NETO
 * destacado, leyendas del recibo, línea de firma del trabajador y, abajo, el
 * recuadro de certificación junto al QR.
 *
 * SOBRE LA MARCA DEL RECUADRO
 * Los recibos de otros sistemas traen ahí «Emitido desde: <nombre del programa>».
 * Éste dice «Emitido desde: GDM NEXO · NÓMINA», que es lo que corresponde: el
 * comprobante lo emite la empresa, el documento lo genera NEXO. No se pone el
 * nombre de ningún otro programa.
 *
 * El layout cambia; el contenido es el MISMO CFDI válido.
 */

import PDFDocument from 'pdfkit';
import { fmtMoney, montoEnLetra, buildQrSatPng } from '../cfdi/pdf-helpers';
import { fechaMx } from '../../utils/fecha-mx';
import { NEXO_LOGO_PLATA_PNG, NEXO_LOGO_PLATA_RATIO } from '../../utils/nexo-logo-plata.data';

type Doc = InstanceType<typeof PDFDocument>;

export interface ConceptoRecibo {
  tipo?: string;          // agrupador del SAT (TipoPercepcion / TipoDeduccion)
  clave: string;          // clave interna de la empresa
  concepto: string;
  gravado?: number;
  exento?: number;
  importe: number;
}

export interface DatosRecibo {
  emisorNom: string; emisorRfc: string; emisorReg: string;
  registroPatronal: string;
  receptorNom: string; receptorRfc: string;
  serieFolio: string; fechaComp: string; lugarExp: string; metodoPago: string;
  subTotal: number; descuento: number; total: number;
  percepciones: ConceptoRecibo[];
  deducciones: ConceptoRecibo[];
  otrosPagos: ConceptoRecibo[];
  nom: Record<string, string>;      // nodo nomina12:Nomina
  recp: Record<string, string>;     // nodo nomina12:Receptor
  rec: any;                         // fila de nomina_recibos + periodo
  timbrado: boolean;
  uuid: string; fechaTimbrado: string; noCertificado: string; noCertificadoSat: string;
  rfcProvCertif: string; selloCfd: string; selloSat: string;
  logo: Buffer | null;
}

const M = 28;
const ANCHO = 612 - M * 2;      // LETTER vertical
const TXT = '#111827';
const GRIS = '#6b7280';
const FILETE = '#9ca3af';
const AZUL = '#1E3D6E';

const n2 = (v: any) => Number(v || 0);

/**
 * Fecha visible en DD/MM/AAAA, con `fechaMx`.
 *
 * NO se arma con `new Date(...)`: «2026-11-01» se interpreta como medianoche
 * UTC y al leerla en hora de México sale el 31/10. Un recibo con el periodo
 * corrido un día es un error que el trabajador sí nota. `fechaMx` corta la
 * cadena AAAA-MM-DD tal cual, sin pasar por zonas horarias.
 */
function fechaCorta(iso: any): string {
  return fechaMx(iso) || '—';
}

function horaCorta(iso: any): string {
  const s = String(iso || '');
  const m = s.match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : '—';
}

export async function renderReciboDetallado(d: DatosRecibo): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'LETTER', margin: M, bufferPages: true });
  const trozos: Buffer[] = [];
  doc.on('data', (c: Buffer) => trozos.push(c));
  const listo = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(trozos))));

  const qr = d.timbrado
    ? await buildQrSatPng({
        uuid: d.uuid, rfcEmisor: d.emisorRfc, rfcReceptor: d.receptorRfc,
        total: String(d.total), selloCfd: d.selloCfd,
      }).catch(() => null)
    : null;

  const marco = (x: number, y: number, w: number, h: number) =>
    doc.lineWidth(0.7).rect(x, y, w, h).stroke(FILETE);
  const banda = (y: number, txt: string) => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TXT)
      .text(txt, M, y, { width: ANCHO, align: 'center' });
    doc.lineWidth(0.7).moveTo(M, y + 11).lineTo(M + ANCHO, y + 11).stroke(FILETE);
    return y + 15;
  };
  const par = (x: number, y: number, lab: string, val: string, wLab = 70, wVal = 120) => {
    doc.font('Helvetica').fontSize(7.5).fillColor(GRIS).text(lab, x, y, { width: wLab, lineBreak: false });
    doc.font('Helvetica').fontSize(7.5).fillColor(TXT)
      .text(val || '—', x + wLab, y, { width: wVal, ellipsis: true, lineBreak: false });
  };

  let y = M;

  /* ── Título ── */
  const tipoRegimen = d.recp.TipoRegimen || '';
  const titulo = tipoRegimen === '09' ? 'Asimilable a Salario' : 'Recibo de Nómina';
  doc.font('Helvetica-Bold').fontSize(12).fillColor(TXT).text(titulo, M + 6, y + 6, { width: 300 });
  doc.font('Helvetica').fontSize(8).fillColor(GRIS)
    .text('CFDI Comprobante Fiscal Digital por Internet', M + 300, y + 9, { width: ANCHO - 306, align: 'right' });
  if (d.logo) {
    try { doc.image(d.logo, M + ANCHO - 48, y + 2, { fit: [42, 24], align: 'right' }); } catch { /* sin logo */ }
  }
  y += 26;

  /* ── Emisor ── */
  y = banda(y, 'DATOS DEL EMISOR');
  const yEmi = y;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(TXT)
    .text(String(d.emisorNom || '').toUpperCase(), M + 6, y + 2, { width: ANCHO - 12, ellipsis: true });
  y = doc.y + 1;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TXT)
    .text('RFC:', M + 6, y, { width: 30, lineBreak: false });
  doc.font('Helvetica-Bold').text(d.emisorRfc || '—', M + 42, y, { width: 120, lineBreak: false });
  y += 11;
  par(M + 6, y, 'Reg Fiscal:', d.emisorReg, 78, 80);
  par(M + 230, y, 'Registro patronal:', d.registroPatronal, 82, 120);
  y += 10;
  par(M + 6, y, 'Lugar de expedición:', d.lugarExp, 78, 80);
  par(M + 230, y, 'Comprobante:', d.serieFolio || '—', 82, 120);
  y += 10;
  par(M + 6, y, 'Fecha:', fechaCorta(d.fechaComp), 78, 80);
  par(M + 230, y, 'Hora:', horaCorta(d.fechaComp), 82, 120);
  y += 12;
  marco(M, yEmi - 2, ANCHO, y - yEmi + 2);
  y += 4;

  /* ── Receptor ── */
  y = banda(y, 'DATOS DEL RECEPTOR');
  const yRec = y;
  const MITAD = M + ANCHO * 0.54;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(TXT)
    .text(`${d.recp.NumEmpleado || d.rec.num_empleado || ''} - ${String(d.receptorNom || '').toUpperCase()}`,
      M + 6, y + 3, { width: MITAD - M - 12, ellipsis: true });
  let yl = doc.y + 2;
  par(M + 6, yl, 'RFC:', d.receptorRfc, 86, 150); yl += 11;
  par(M + 6, yl, 'CURP:', d.recp.Curp || d.rec.curp || '', 86, 150); yl += 11;
  par(M + 6, yl, 'NSS:', d.recp.NumSeguridadSocial || d.rec.nss || '', 86, 150); yl += 11;
  par(M + 6, yl, 'Tipo de Contrato:', d.recp.TipoContrato || '', 86, 150); yl += 11;

  let yr = y + 3;
  const wrLab = 86, wrVal = M + ANCHO - MITAD - 6 - wrLab;
  par(MITAD, yr, 'Periodo:',
    `${d.rec.periodo_numero ?? ''}  ${fechaCorta(d.rec.fecha_inicio)} - ${fechaCorta(d.rec.fecha_fin)}`, wrLab, wrVal); yr += 11;
  par(MITAD, yr, 'Días de Pago:', String(d.nom.NumDiasPagados || '—'), wrLab, wrVal); yr += 11;
  par(MITAD, yr, 'Fecha Pago:', fechaCorta(d.nom.FechaPago || d.rec.fecha_pago), wrLab, wrVal); yr += 11;
  par(MITAD, yr, 'Depto:', d.recp.Departamento || d.rec.departamento || 'Ninguno', wrLab, wrVal); yr += 11;
  par(MITAD, yr, 'Tipo de Régimen:', tipoRegimen, wrLab, wrVal); yr += 11;

  y = Math.max(yl, yr) + 2;
  marco(M, yRec - 2, ANCHO, y - yRec + 2);
  doc.lineWidth(0.5).moveTo(MITAD - 6, yRec - 2).lineTo(MITAD - 6, y).stroke(FILETE);
  y += 6;

  /* ── Percepciones | Deducciones ── */
  const wP = ANCHO * 0.58, wD = ANCHO - wP - 6;
  const xP = M, xD = M + wP + 6;
  const ALTO_TABLA = 150;

  const cabecera = (x: number, w: number, titulo: string, conGravado: boolean) => {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TXT)
      .text(titulo, x, y, { width: w, align: 'center' });
    const yt = y + 12;
    doc.rect(x, yt, w, 13).fill('#e5e7eb');
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(TXT);
    const cols = conGravado
      ? [['Agrup SAT', 0.13, 'left'], ['No.', 0.09, 'left'], ['Concepto', 0.40, 'left'],
         ['Gravado', 0.13, 'right'], ['Exento', 0.12, 'right'], ['Total', 0.13, 'right']]
      : [['Agrup SAT', 0.17, 'left'], ['No.', 0.13, 'left'], ['Concepto', 0.48, 'left'],
         ['Total', 0.22, 'right']];
    let cx = x;
    const anchos: Array<[number, number, string]> = [];
    for (const [t, f, a] of cols as Array<[string, number, string]>) {
      doc.text(t, cx + 2, yt + 3.5, { width: w * f - 4, align: a as any, lineBreak: false });
      anchos.push([cx, w * f, a]);
      cx += w * f;
    }
    return anchos;
  };

  const colsP = cabecera(xP, wP, 'Percepciones', true);
  const colsD = cabecera(xD, wD, 'Deducciones', false);
  const yTabla = y + 25;

  const pinta = (x: number, w: number, cols: Array<[number, number, string]>,
                 lista: ConceptoRecibo[], conGravado: boolean) => {
    doc.font('Helvetica').fontSize(7).fillColor(TXT);
    let ry = yTabla + 2;
    for (const c of lista) {
      const vals = conGravado
        ? [c.tipo || '', c.clave || '', c.concepto, fmtMoney(c.gravado), fmtMoney(c.exento), fmtMoney(c.importe)]
        : [c.tipo || '', c.clave || '', c.concepto, fmtMoney(c.importe)];
      vals.forEach((v, i) => {
        const [cx, cw, a] = cols[i];
        // width + height (un renglón) + ellipsis: sin el height, PDFKit parte el
        // texto largo en dos líneas y se encima con el concepto de abajo,
        // porque las filas avanzan una altura fija.
        doc.text(v, cx + 2, ry, { width: cw - 4, height: 9, align: a as any, ellipsis: true, lineBreak: false });
      });
      ry += 10;
      if (ry > yTabla + ALTO_TABLA - 10) break;   // la hoja no da para más
    }
    marco(x, yTabla, w, ALTO_TABLA);
  };
  pinta(xP, wP, colsP, [...d.percepciones, ...d.otrosPagos], true);
  pinta(xD, wD, colsD, d.deducciones, false);
  y = yTabla + ALTO_TABLA + 4;

  /* ── Sumas ── */
  const sumaGrav = d.percepciones.reduce((a, p) => a + n2(p.gravado), 0);
  const sumaExe = d.percepciones.reduce((a, p) => a + n2(p.exento), 0)
    + d.otrosPagos.reduce((a, o) => a + n2(o.importe), 0);
  const totalPerc = sumaGrav + sumaExe;

  doc.rect(xP, y, wP, 16).stroke(FILETE);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(TXT)
    .text('Suma de Percepciones $', xP + 4, y + 4.5, { width: wP * 0.42, lineBreak: false });
  [[sumaGrav, colsP[3]], [sumaExe, colsP[4]], [totalPerc, colsP[5]]].forEach(([v, c]: any) => {
    doc.text(fmtMoney(v), c[0] + 2, y + 4.5, { width: c[1] - 4, align: 'right', lineBreak: false });
  });

  const retenciones = d.deducciones
    .filter((x) => x.tipo === '002')
    .reduce((a, x) => a + n2(x.importe), 0);
  const otrosDesc = d.deducciones
    .filter((x) => x.tipo !== '002')
    .reduce((a, x) => a + n2(x.importe), 0);

  let ty = y;
  const totales: Array<[string, number, boolean]> = [
    ['Subtotal $', d.subTotal, false],
    ['Retenciones $', retenciones, false],
    ['Descuentos $', otrosDesc, false],
    ['Total $', d.total, false],
    ['Neto del recibo $', d.total, true],
  ];
  doc.lineWidth(0.7).rect(xD, ty, wD, totales.length * 15 + 4).stroke(FILETE);
  ty += 3;
  for (const [lab, val, fuerte] of totales) {
    doc.font('Helvetica-Bold').fontSize(fuerte ? 8.5 : 8).fillColor(fuerte ? AZUL : TXT)
      .text(lab, xD + 4, ty + 3, { width: wD * 0.55, align: 'right', lineBreak: false })
      .text(fmtMoney(val), xD + wD * 0.55 + 4, ty + 3, { width: wD * 0.45 - 10, align: 'right', lineBreak: false });
    ty += 15;
  }
  y = Math.max(y + 20, ty) + 6;

  /* ── Importe con letra y leyendas ── */
  doc.font('Helvetica').fontSize(8).fillColor(GRIS)
    .text('Importe con letra', xD, y, { width: wD, align: 'center' });
  doc.font('Helvetica').fontSize(8).fillColor(TXT)
    .text(montoEnLetra(d.total, 'MXN'), xD, y + 11, { width: wD, align: 'center' });

  doc.font('Helvetica').fontSize(7).fillColor(GRIS).text(
    'Se puso a mi disposición el archivo XML correspondiente y recibí de la empresa arriba mencionada la ' +
    'cantidad neta a que este documento se refiere, estando conforme con las percepciones y deducciones ' +
    'que en él aparecen especificadas.',
    xP + 4, y, { width: wP - 8 }
  );
  const yFirma = Math.max(doc.y, y + 36) + 24;
  doc.lineWidth(0.5).moveTo(xP + 60, yFirma).lineTo(xP + wP - 60, yFirma).stroke(TXT);
  doc.font('Helvetica').fontSize(7.5).fillColor(TXT)
    .text(String(d.receptorNom || '').toUpperCase(), xP, yFirma + 3, { width: wP, align: 'center', ellipsis: true });
  doc.fontSize(7).fillColor(GRIS)
    .text(`Método de pago: ${d.metodoPago}`, xP, yFirma + 14, { width: wP, align: 'center' });
  y = yFirma + 28;

  /* ── Certificación: QR + recuadro ── */
  if (qr) { try { doc.image(qr, M + 4, y, { fit: [92, 92] }); } catch { /* sin QR */ } }

  const cx = M + 106, cw = ANCHO - 106;
  doc.lineWidth(0.7).rect(cx, y, cw, 76).stroke(FILETE);
  doc.font('Helvetica').fontSize(8.5).fillColor(TXT)
    .text('Este documento es una representación impresa de un CFDI', cx + 6, y + 6, { width: cw - 12, align: 'center' });

  /* Marca de la casa. Donde los recibos de otros sistemas ponen el nombre de
   * su programa, aquí va GDM NEXO: el comprobante lo emite la empresa, el
   * documento lo genera NEXO. */
  const etiqueta = 'GDM NEXO · NÓMINA';
  doc.font('Helvetica').fontSize(7.5).fillColor(GRIS)
    .text('Emitido desde:', cx + 6, y + 23, { width: 70, align: 'right', lineBreak: false });
  try {
    const hl = 13, wl = hl * NEXO_LOGO_PLATA_RATIO;
    doc.image(NEXO_LOGO_PLATA_PNG, cx + 82, y + 20, { width: wl, height: hl });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(AZUL)
      .text(etiqueta, cx + 82 + wl + 4, y + 23, { lineBreak: false });
  } catch {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(AZUL).text(etiqueta, cx + 82, y + 23, { lineBreak: false });
  }

  let cy = y + 38;
  const certFilas: Array<[string, string]> = [
    ['Serie del Certificado del emisor:', d.noCertificado || '—'],
    ['Folio Fiscal UUID:', d.uuid || 'PENDIENTE DE TIMBRAR'],
    ['No. de serie del Certificado del SAT:', d.noCertificadoSat || '—'],
    ['Fecha y hora de certificación:', d.fechaTimbrado || '—'],
  ];
  for (const [lab, val] of certFilas) {
    doc.font('Helvetica').fontSize(6.5).fillColor(GRIS)
      .text(lab, cx + 6, cy, { width: 150, align: 'right', lineBreak: false });
    doc.fillColor(TXT).text(val, cx + 162, cy, { width: cw - 170, ellipsis: true, lineBreak: false });
    cy += 9;
  }
  y = Math.max(y + 96, cy + 4);   // 96 = alto del QR (92) + aire; el recuadro mide menos

  /* ── Sellos y cadena ── */
  const bloque = (titulo: string, contenido: string) => {
    if (!contenido) return;
    doc.font('Helvetica').fontSize(7).fillColor(TXT).text(titulo, M + 4, y, { width: ANCHO - 8 });
    y = doc.y + 1;
    doc.fontSize(5).fillColor(TXT).text(contenido, M + 4, y, { width: ANCHO - 8, align: 'justify' });
    y = doc.y + 3;
  };
  if (d.timbrado) {
    bloque('Sello digital del CFDI', d.selloCfd);
    bloque('Sello del SAT', d.selloSat);
    bloque('Cadena original del complemento del certificación digital del SAT',
      `||1.1|${d.uuid}|${d.fechaTimbrado}|${d.rfcProvCertif}|${d.selloCfd}|${d.noCertificadoSat}||`);
  } else {
    doc.rect(M, y, ANCHO, 26).fill('#fffbeb');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#92400e')
      .text('SIN TIMBRAR — VISTA PREVIA', M, y + 5, { width: ANCHO, align: 'center' });
    doc.font('Helvetica').fontSize(6.5).fillColor('#92400e').text(
      'Todavía no se envía al PAC: no tiene folio fiscal ni sellos, y NO ampara ningún pago ante el SAT.',
      M, y + 15, { width: ANCHO, align: 'center' });
    y += 30;
  }

  /* ── Pie ── */
  const yPie = doc.page.height - 34;
  const margenes = { ...doc.page.margins };
  doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
  doc.font('Helvetica').fontSize(6.5).fillColor(GRIS)
    .text('Versión 4.0        Versión del complemento: 1.2        Hoja 1 de 1',
      M, yPie, { width: ANCHO, align: 'center', lineBreak: false });
  doc.page.margins = margenes;

  // Marco exterior de toda la hoja, como el formato de referencia.
  doc.lineWidth(0.8).rect(M - 4, M - 4, ANCHO + 8, doc.page.height - (M - 4) * 2).stroke(FILETE);

  doc.end();
  return listo;
}
