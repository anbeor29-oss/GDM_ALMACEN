/**
 * Documento legal de la baja — finiquito, renuncia o convenio de liquidación.
 *
 * Genera el documento en prosa (PDF) que acompaña al finiquito/liquidación
 * TIMBRADO, fundado en la LFT, con los importes calculados. NO sustituye la
 * asesoría legal: al pie lleva la leyenda de que es un apoyo a revisar.
 *
 *   · finiquito   → Recibo-convenio de finiquito (Art. 82, 87, 76, 80 LFT).
 *   · renuncia    → Carta de renuncia voluntaria (Art. 53-I LFT).
 *   · liquidacion → Convenio de terminación por despido (Art. 48/50, 162 LFT).
 *
 * Los importes salen del recibo timbrado (representación del finiquito); no se
 * recalculan. Reutilizable para cualquier empresa/trabajador.
 */
import PDFDocument from 'pdfkit';
import { query } from '../../config/database';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler';
import { fmtMoney, montoEnLetra } from '../cfdi/pdf-helpers';
import { representacionFiniquito } from './nomina-poliza.service';
import { fechaMx } from '../../utils/fecha-mx';

export type VarianteDoc = 'finiquito' | 'renuncia' | 'liquidacion';

/** Fundamento LFT por concepto (por palabras clave del nombre). */
function articuloDe(concepto: string): string {
  const c = (concepto || '').toLowerCase();
  if (/sueldo|salario/.test(c)) return 'Art. 82 LFT';
  if (/aguinaldo/.test(c)) return 'Art. 87 LFT';
  if (/prima\s+vacacional/.test(c)) return 'Art. 80 LFT';
  if (/vacacion/.test(c)) return 'Art. 76 LFT';
  if (/indemniz/.test(c)) return 'Art. 48/50 LFT';
  if (/antig[üu]edad/.test(c)) return 'Art. 162 LFT';
  if (/subsidio/.test(c)) return 'Art. 93 LISR';
  return '';
}

async function datos(companyId: string, reciboId: string) {
  const rep = await representacionFiniquito(companyId, reciboId);
  const emp = await query<any>(
    `SELECT business_name, rfc, postal_code, state FROM companies WHERE id=$1`, [companyId]);
  if (!emp.rows.length) throw new NotFoundError('Empresa no encontrada');
  return { rep, empresa: emp.rows[0] };
}

export async function documentoLegalBaja(companyId: string, reciboId: string, variante?: VarianteDoc): Promise<{ buffer: Buffer; nombre: string }> {
  const { rep, empresa } = await datos(companyId, reciboId);
  const esLiquidacion = rep.periodo.tipo === 'LIQUIDACION';
  const v: VarianteDoc = variante || (esLiquidacion ? 'liquidacion' : 'finiquito');

  const doc = new PDFDocument({ size: 'LETTER', margin: 56, bufferPages: true });
  const trozos: Buffer[] = [];
  doc.on('data', (c: Buffer) => trozos.push(c));
  const listo = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(trozos))));

  const M = 56;
  const W = doc.page.width - M * 2;
  const trab = rep.empleado.nombre;
  const fBaja = fechaMx(rep.periodo.fecha_fin);
  const lugar = empresa.state || 'México';
  const negro = '#111827', gris = '#555555';

  const titulos: Record<VarianteDoc, string> = {
    finiquito: 'RECIBO DE FINIQUITO',
    renuncia: 'CARTA DE RENUNCIA VOLUNTARIA',
    liquidacion: 'CONVENIO DE TERMINACIÓN Y LIQUIDACIÓN',
  };

  // Encabezado
  doc.font('Helvetica-Bold').fontSize(13).fillColor(negro)
    .text((empresa.business_name || 'Empresa').toUpperCase(), M, M, { width: W, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor(gris)
    .text(`RFC: ${empresa.rfc || ''}${empresa.postal_code ? ` · C.P. ${empresa.postal_code}` : ''}`, { width: W, align: 'center' });
  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(negro).text(titulos[v], { width: W, align: 'center' });
  doc.moveDown(1);

  const p = (t: string, opts: any = {}) => { doc.font('Helvetica').fontSize(10).fillColor(negro).text(t, { width: W, align: 'justify', ...opts }); doc.moveDown(0.6); };

  if (v === 'renuncia') {
    p(`${lugar}, a ${fBaja}.`);
    doc.moveDown(0.4);
    p(`Por medio del presente escrito, yo, ${trab}, manifiesto de forma libre, espontánea y sin ` +
      `presión alguna mi decisión de dar por terminada la relación laboral que sostengo con ` +
      `${empresa.business_name}, con efectos a partir del ${fBaja}, en los términos del artículo 53, ` +
      `fracción I, de la Ley Federal del Trabajo.`);
    p(`Reconozco que a la fecha he recibido el pago de las partes proporcionales que me corresponden ` +
      `(sueldos devengados, aguinaldo, vacaciones y prima vacacional), por lo que a la firma del ` +
      `finiquito no me reservo acción ni derecho que ejercitar en contra de mi patrón por concepto ` +
      `alguno derivado de la relación de trabajo.`);
  } else if (v === 'liquidacion') {
    p(`En ${lugar}, a ${fBaja}, ${empresa.business_name} (el "Patrón") y ${trab} (el "Trabajador") ` +
      `celebran el presente convenio para dar por terminada la relación laboral y liquidar las ` +
      `prestaciones que conforme a la Ley Federal del Trabajo corresponden.`);
    p(`El Patrón cubre al Trabajador la indemnización constitucional y demás conceptos que se detallan, ` +
      `con fundamento en los artículos 48, 50 y 162 de la Ley Federal del Trabajo, además de las partes ` +
      `proporcionales de aguinaldo, vacaciones y prima vacacional (Art. 87, 76 y 80 LFT).`);
    p(`Recibido el pago, el Trabajador otorga el más amplio finiquito que en derecho proceda y ` +
      `manifiesta que no se reserva acción ni derecho que ejercitar en contra del Patrón por la ` +
      `relación laboral que concluye.`);
  } else {
    p(`En ${lugar}, a ${fBaja}, ${trab} (el "Trabajador") recibe de ${empresa.business_name} ` +
      `(el "Patrón") el pago del finiquito por la terminación de la relación laboral, integrado por ` +
      `los sueldos devengados y las partes proporcionales de aguinaldo, vacaciones y prima vacacional, ` +
      `con fundamento en los artículos 82, 87, 76 y 80 de la Ley Federal del Trabajo.`);
    p(`El Trabajador manifiesta su conformidad con las cantidades que se detallan y, al recibir su ` +
      `importe, otorga el más amplio finiquito que en derecho proceda, sin reservarse acción ni ` +
      `derecho alguno en contra del Patrón por la relación de trabajo que concluye.`);
  }

  // Tabla de conceptos
  doc.moveDown(0.4);
  const filas: Array<{ concepto: string; art: string; importe: number }> = [];
  for (const pc of rep.percepciones) filas.push({ concepto: pc.concepto, art: articuloDe(pc.concepto), importe: pc.importe });
  if (rep.subsidio > 0) filas.push({ concepto: 'Subsidio para el empleo', art: articuloDe('subsidio'), importe: rep.subsidio });
  const totalPercep = filas.reduce((a, f) => a + f.importe, 0);

  const yTop = doc.y;
  doc.rect(M, yTop, W, 16).fill('#162840');
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
  doc.text('CONCEPTO', M + 6, yTop + 4.5, { width: W * 0.52 });
  doc.text('FUNDAMENTO', M + W * 0.52, yTop + 4.5, { width: W * 0.28 });
  doc.text('IMPORTE', M + W * 0.80, yTop + 4.5, { width: W * 0.20 - 6, align: 'right' });
  let y = yTop + 16;
  doc.font('Helvetica').fontSize(9).fillColor(negro);
  for (const f of filas) {
    if (y + 15 > doc.page.height - M - 90) { doc.addPage(); y = M; }
    doc.text(f.concepto, M + 6, y + 3, { width: W * 0.52 - 6, ellipsis: true });
    doc.fillColor(gris).text(f.art, M + W * 0.52, y + 3, { width: W * 0.28 });
    doc.fillColor(negro).text(fmtMoney(f.importe), M + W * 0.80, y + 3, { width: W * 0.20 - 6, align: 'right' });
    y += 15;
    doc.moveTo(M, y).lineTo(M + W, y).strokeColor('#E5E7EB').lineWidth(0.3).stroke();
  }
  // Deducciones (ISR y otras) + neto
  doc.font('Helvetica-Bold').fontSize(9).fillColor(negro);
  const linea = (etq: string, val: number) => {
    doc.text(etq, M + W * 0.52, y + 4, { width: W * 0.28 });
    doc.text(fmtMoney(val), M + W * 0.80, y + 4, { width: W * 0.20 - 6, align: 'right' });
    y += 16;
  };
  linea('Total percepciones', totalPercep);
  if (rep.totales.deducciones > 0) linea('Menos deducciones', rep.totales.deducciones);
  doc.rect(M, y, W, 18).fill('#DCE6F5');
  doc.fillColor(negro).text('NETO A RECIBIR', M + W * 0.52, y + 5, { width: W * 0.28 });
  doc.text(fmtMoney(rep.totales.neto), M + W * 0.80, y + 5, { width: W * 0.20 - 6, align: 'right' });
  y += 24;

  doc.font('Helvetica').fontSize(9).fillColor(gris)
    .text(`Cantidad con letra: ${montoEnLetra(rep.totales.neto)}.`, M, y, { width: W });
  doc.moveDown(2.5);

  // Firmas
  const yFirma = doc.y + 10;
  const anchoF = (W - 40) / 2;
  const firma = (x: number, etq: string, sub: string) => {
    doc.moveTo(x + 8, yFirma).lineTo(x + anchoF - 8, yFirma).strokeColor(negro).lineWidth(0.6).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(negro).text(etq, x, yFirma + 4, { width: anchoF, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor(gris).text(sub, x, yFirma + 16, { width: anchoF, align: 'center' });
  };
  firma(M, trab.toUpperCase(), v === 'renuncia' ? 'El Trabajador (renuncia)' : 'El Trabajador (recibí de conformidad)');
  firma(M + anchoF + 40, (empresa.business_name || '').toUpperCase(), 'El Patrón / Representante Legal');

  // Pie: leyenda + paginación
  const pies = doc.bufferedPageRange();
  for (let i = 0; i < pies.count; i++) {
    doc.switchToPage(pies.start + i);
    doc.font('Helvetica-Oblique').fontSize(7).fillColor('#9CA3AF')
      .text('Documento generado como apoyo administrativo; revíselo con su asesor legal antes de su firma. Los importes provienen del recibo timbrado.',
        M, doc.page.height - M - 12, { width: W - 30, align: 'left', lineBreak: false });
    doc.text(`${i + 1}/${pies.count}`, M, doc.page.height - M - 12, { width: W, align: 'right', lineBreak: false });
  }

  doc.end();
  const buffer = await listo;
  const etiqueta = v === 'renuncia' ? 'renuncia' : v === 'liquidacion' ? 'liquidacion' : 'finiquito';
  return { buffer, nombre: `${etiqueta}-${rep.empleado.num_empleado || 'trabajador'}.pdf` };
}

export function variantesPara(finiquitoTipo: string | null | undefined): VarianteDoc[] {
  if (finiquitoTipo === 'LIQUIDACION') return ['liquidacion', 'finiquito', 'renuncia'];
  return ['finiquito', 'renuncia'];
}

/** Valida que el recibo sea de baja (finiquito/liquidación) antes de generar. */
export async function asegurarBaja(companyId: string, reciboId: string) {
  const r = await query<any>(
    `SELECT p.finiquito_tipo FROM nomina_recibos r JOIN nomina_periodos p ON p.id=r.periodo_id
      WHERE r.id=$1 AND r.company_id=$2`, [reciboId, companyId]);
  if (!r.rows.length) throw new NotFoundError('Recibo no encontrado');
  if (!r.rows[0].finiquito_tipo) throw new ValidationError('Ese recibo no es de baja (finiquito/liquidación).');
}
