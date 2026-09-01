/**
 * reporte-pdf — un PDF tabular con el encabezado de la casa, en un solo lugar.
 *
 * El encabezado que pidió el usuario es igual para todos los reportes
 * (Contabilidad y Nómina): NOMBRE DE LA EMPRESA · nombre del reporte · RFC ·
 * fecha de generación, y debajo la tabla. Si cada reporte lo dibujara por su
 * cuenta, el octavo saldría distinto. Reparte las columnas al ancho de la hoja,
 * corta en páginas repitiendo el encabezado de columnas, y pinta una fila de
 * totales opcional.
 *
 * Los importes se formatean con `pesos` en la columna; el texto se recorta con
 * ellipsis para no desbordar. Devuelve el Buffer listo para `res.send`.
 */

import PDFDocument from 'pdfkit';

export interface ColumnaPdf {
  titulo: string;
  clave: string;                          // llave del valor en cada fila
  ancho: number;                          // peso relativo (se escala al ancho útil)
  align?: 'left' | 'right' | 'center';
  pesos?: boolean;                        // formatea como importe (#,##0.00)
}

export interface ReportePdfOpts {
  titulo: string;                         // nombre del reporte
  empresa: string;                        // razón social
  rfc?: string;
  subtitulos?: string[];                  // periodo, cuenta, etc.
  columnas: ColumnaPdf[];
  filas: Array<Record<string, any>>;
  totales?: Record<string, any> | null;   // fila de totales (por clave), opcional
  orientacion?: 'portrait' | 'landscape';
  nota?: string;                          // pie
}

const fmt = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: any) => fmt.format(Number(n) || 0);

const AZUL_OSCURO = '#162840';
const AZUL = '#1E3D6E';
const GRIS = '#666666';
const TOTAL_FONDO = '#DCE6F5';
const LINEA = '#E5E7EB';

export async function reporteTablaPdf(o: ReportePdfOpts): Promise<Buffer> {
  const landscape = o.orientacion !== 'portrait';
  const M = 36;
  const doc = new PDFDocument({ size: 'LETTER', layout: landscape ? 'landscape' : 'portrait', margin: M, bufferPages: true });
  const trozos: Buffer[] = [];
  doc.on('data', (c: Buffer) => trozos.push(c));
  const listo = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(trozos))));

  const contentW = doc.page.width - M * 2;
  const pesoTotal = o.columnas.reduce((a, c) => a + c.ancho, 0) || 1;
  const cols = o.columnas.map((c) => ({ ...c, w: (c.ancho / pesoTotal) * contentW }));
  const bottom = doc.page.height - M - 22;

  const encabezadoColumnas = (y: number): number => {
    doc.rect(M, y, contentW, 16).fill(AZUL_OSCURO);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    let x = M;
    for (const c of cols) {
      doc.text(c.titulo, x + 3, y + 4.5, { width: c.w - 6, align: c.align || (c.pesos ? 'right' : 'left'), ellipsis: true });
      x += c.w;
    }
    return y + 16;
  };

  // Encabezado del reporte
  let y = M;
  doc.font('Helvetica-Bold').fontSize(14).fillColor(AZUL_OSCURO).text(o.empresa || 'Empresa', M, y, { width: contentW, ellipsis: true });
  y += 19;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(AZUL).text(o.titulo, M, y, { width: contentW });
  y += 15;
  doc.font('Helvetica').fontSize(8).fillColor(GRIS);
  const meta = [o.rfc ? `RFC: ${o.rfc}` : '', ...(o.subtitulos || []), `Generado: ${new Date().toLocaleString('es-MX')}`].filter(Boolean);
  for (const m of meta) { doc.text(m, M, y, { width: contentW }); y += 11; }
  y += 5;

  y = encabezadoColumnas(y);

  const rowH = 13;
  const fila = (f: Record<string, any>, opts: { bold?: boolean; fondo?: string } = {}) => {
    if (y + rowH > bottom) { doc.addPage(); y = M; y = encabezadoColumnas(y); }
    if (opts.fondo) doc.rect(M, y, contentW, rowH).fill(opts.fondo);
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor('#111827');
    let x = M;
    for (const c of cols) {
      const raw = f[c.clave];
      const txt = raw === null || raw === undefined || raw === '' ? '' : (c.pesos ? money(raw) : String(raw));
      doc.text(txt, x + 3, y + 3.5, { width: c.w - 6, align: c.align || (c.pesos ? 'right' : 'left'), ellipsis: true });
      x += c.w;
    }
    y += rowH;
    doc.moveTo(M, y).lineTo(M + contentW, y).strokeColor(LINEA).lineWidth(0.3).stroke();
  };

  for (const f of o.filas) fila(f);
  if (o.totales) fila(o.totales, { bold: true, fondo: TOTAL_FONDO });

  if (o.nota) {
    if (y + 22 > bottom) { doc.addPage(); y = M; }
    doc.font('Helvetica-Oblique').fontSize(7).fillColor(GRIS).text(o.nota, M, y + 7, { width: contentW });
  }

  doc.end();
  return listo;
}
