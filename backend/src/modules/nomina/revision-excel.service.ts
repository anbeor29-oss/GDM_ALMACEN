/**
 * revision-excel.service — la Revisión anual de nómina en un libro de Excel.
 *
 * Un libro con varias hojas (misma paleta de la casa, `estilo-excel`): la base del
 * año (por trabajador, por mes, por semana y los recibos) y las revisiones de
 * cálculo (ISR y IMSS/Infonavit), para que el contador trabaje los números fuera.
 */
import { query } from '../../config/database';
import * as revision from './revision-nomina.service';
import { reporteTablaPdf } from '../../utils/reporte-pdf';

const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

type Tinta = 'base' | 'rojo' | 'verde' | 'gris';
interface Col { k: string; t: string; ancho: number; tinta?: Tinta; color?: string; conteo?: boolean }

export async function generarExcelRevision(
  companyId: string, anio: number,
): Promise<{ buffer: Buffer; nombre: string }> {
  const { ExcelJS, C, titulo, dato, encabezado, celda, totales, anchos, aBuffer } = await import('./estilo-excel');

  const [base, isr, imss, empRow] = await Promise.all([
    revision.revisionAnual(companyId, anio),
    revision.revisionCalculosIsr(companyId, anio),
    revision.revisionCalculosImss(companyId, anio),
    query<any>(`SELECT business_name, rfc, registro_patronal FROM companies WHERE id = $1`, [companyId]),
  ]);
  const emp = empRow.rows[0] || {};

  const wb = new ExcelJS.Workbook();
  wb.creator = 'GDM NEXO';

  const hoja = (nombre: string, tit: string, cols: Col[], filas: any[], pie?: any[]) => {
    const ws = wb.addWorksheet(nombre.slice(0, 28), { views: [{ state: 'frozen', ySplit: 8 }] });
    titulo(ws, `GDM NEXO · ${tit}`, cols.length);
    dato(ws, 3, 1, `Empresa:   ${emp.business_name || ''}`, true);
    dato(ws, 3, 5, `RFC:   ${emp.rfc || ''}`);
    dato(ws, 4, 1, `Reg. Patronal:   ${emp.registro_patronal || '(sin capturar)'}`);
    dato(ws, 4, 5, `Generado:   ${new Date().toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`);
    dato(ws, 5, 1, `Ejercicio:   ${anio}`);
    dato(ws, 6, 1, 'Revisión de nómina — importes como se timbraron ante el SAT.');
    encabezado(ws, 8, cols.map((c) => ({ texto: c.t.replace('@', '\n'), color: c.color || C.identidad })));
    let fila = 9;
    for (const r of filas) {
      cols.forEach((c, i) => {
        const v = r[c.k];
        celda(ws, fila, i + 1, v === null || v === undefined ? '' : (c.conteo ? Number(v) : v),
          { tinta: c.tinta, pesos: !c.conteo, centrado: c.conteo });
      });
      fila++;
    }
    if (pie) totales(ws, fila, pie);
    anchos(ws, cols.map((c) => c.ancho));
  };

  const t = base.totales;
  const money = (n: any) => Number(n || 0);

  // 1) Por trabajador
  hoja('Por trabajador', 'Revisión de nómina — por trabajador', [
    { k: 'nombre', t: 'TRABAJADOR', ancho: 32, color: C.identidad },
    { k: 'rfc', t: 'RFC', ancho: 15, color: C.identidad },
    { k: 'recibos', t: 'RECIBOS', ancho: 9, color: C.ingresos, conteo: true },
    { k: 'percepciones', t: 'PERCEPCIONES', ancho: 15, color: C.totalIngresos },
    { k: 'gravado', t: 'GRAVADO', ancho: 14, color: C.ingresos },
    { k: 'exento', t: 'EXENTO', ancho: 14, color: C.ingresos, tinta: 'verde' },
    { k: 'isr', t: 'ISR', ancho: 13, color: C.descuentos, tinta: 'rojo' },
    { k: 'imss', t: 'IMSS', ancho: 13, color: C.descuentos, tinta: 'rojo' },
    { k: 'infonavit', t: 'INFONAVIT', ancho: 13, color: C.descuentos, tinta: 'rojo' },
    { k: 'neto', t: 'NETO', ancho: 15, color: C.neto, tinta: 'verde' },
  ], base.trabajadores, [
    { valor: `${base.trabajadores.length} trabajador(es)`, fondo: C.totalAzul },
    { valor: '', fondo: C.totalAzul },
    { valor: base.totalRecibos, fondo: C.totalAzul, centrado: true },
    { valor: money(t.percepciones), fondo: C.totalAzul },
    { valor: money(t.gravado), fondo: C.totalAzul },
    { valor: money(t.exento), fondo: C.totalVerde, tinta: 'verde' },
    { valor: money(t.isr), fondo: C.totalRojo, tinta: 'rojo' },
    { valor: money(t.imss), fondo: C.totalRojo, tinta: 'rojo' },
    { valor: money(t.infonavit), fondo: C.totalRojo, tinta: 'rojo' },
    { valor: money(t.neto), fondo: C.totalVerde, tinta: 'verde' },
  ]);

  // 2) Por mes
  hoja('Por mes', 'Revisión de nómina — por mes', [
    { k: 'nombreMes', t: 'MES', ancho: 14, color: C.identidad },
    { k: 'recibos', t: 'RECIBOS', ancho: 9, color: C.ingresos, conteo: true },
    { k: 'percepciones', t: 'PERCEPCIONES', ancho: 15, color: C.totalIngresos },
    { k: 'gravado', t: 'GRAVADO', ancho: 14, color: C.ingresos },
    { k: 'isr', t: 'ISR', ancho: 13, color: C.descuentos, tinta: 'rojo' },
    { k: 'imss', t: 'IMSS', ancho: 13, color: C.descuentos, tinta: 'rojo' },
    { k: 'infonavit', t: 'INFONAVIT', ancho: 13, color: C.descuentos, tinta: 'rojo' },
    { k: 'neto', t: 'NETO', ancho: 15, color: C.neto, tinta: 'verde' },
  ], base.porMes);

  // 3) Por semana
  hoja('Por semana', 'Revisión de nómina — por semana ISO', [
    { k: 'semana', t: 'SEMANA', ancho: 10, color: C.identidad, conteo: true },
    { k: 'recibos', t: 'RECIBOS', ancho: 9, color: C.ingresos, conteo: true },
    { k: 'percepciones', t: 'PERCEPCIONES', ancho: 15, color: C.totalIngresos },
    { k: 'isr', t: 'ISR', ancho: 13, color: C.descuentos, tinta: 'rojo' },
    { k: 'imss', t: 'IMSS', ancho: 13, color: C.descuentos, tinta: 'rojo' },
    { k: 'infonavit', t: 'INFONAVIT', ancho: 13, color: C.descuentos, tinta: 'rojo' },
    { k: 'neto', t: 'NETO', ancho: 15, color: C.neto, tinta: 'verde' },
  ], base.porSemana);

  // 4) Recibos
  hoja('Recibos', 'Revisión de nómina — recibos del año', [
    { k: 'fechaPago', t: 'FECHA PAGO', ancho: 13, color: C.identidad },
    { k: 'nombreTrabajador', t: 'TRABAJADOR', ancho: 32, color: C.identidad },
    { k: 'rfcTrabajador', t: 'RFC', ancho: 15, color: C.identidad },
    { k: 'uuid', t: 'FOLIO FISCAL (UUID)', ancho: 40, color: C.ingresos },
    { k: 'percepciones', t: 'PERCEPCIONES', ancho: 15, color: C.totalIngresos },
    { k: 'isr', t: 'ISR', ancho: 13, color: C.descuentos, tinta: 'rojo' },
    { k: 'imss', t: 'IMSS', ancho: 13, color: C.descuentos, tinta: 'rojo' },
    { k: 'infonavit', t: 'INFONAVIT', ancho: 13, color: C.descuentos, tinta: 'rojo' },
    { k: 'neto', t: 'NETO', ancho: 15, color: C.neto, tinta: 'verde' },
  ], base.recibos);

  // 5) Revisión ISR
  hoja('Revisión ISR', 'Revisión de cálculos — ISR (Art. 96)', [
    { k: 'nombre', t: 'TRABAJADOR', ancho: 32, color: C.identidad },
    { k: 'nombreMes', t: 'MES', ancho: 12, color: C.identidad },
    { k: 'gravado', t: 'GRAVADO@DEL MES', ancho: 14, color: C.ingresos },
    { k: 'isrRetenido', t: 'ISR@RETENIDO', ancho: 13, color: C.descuentos, tinta: 'rojo' },
    { k: 'subsidio', t: 'SUBSIDIO', ancho: 12, color: C.ingresos },
    { k: 'isrBrutoTabla', t: 'ART. 96@BRUTO', ancho: 13, color: C.totalIngresos },
    { k: 'isrNetoTabla', t: 'ART. 96@NETO', ancho: 13, color: C.totalIngresos },
    { k: 'diferencia', t: 'DIFERENCIA', ancho: 14, color: C.totalDescuentos, tinta: 'rojo' },
  ], isr.filas, [
    { valor: `${isr.resumen.conDiferencia} con diferencia`, fondo: C.totalAzul },
    { valor: '', fondo: C.totalAzul }, { valor: '', fondo: C.totalAzul }, { valor: '', fondo: C.totalAzul },
    { valor: '', fondo: C.totalAzul }, { valor: '', fondo: C.totalAzul }, { valor: '', fondo: C.totalAzul },
    { valor: money(isr.resumen.totalDiferencia), fondo: C.totalRojo, tinta: 'rojo' },
  ]);

  // 6) Revisión IMSS / Infonavit
  hoja('Revisión IMSS', 'Revisión de cálculos — IMSS e Infonavit', [
    { k: 'nombre', t: 'TRABAJADOR', ancho: 32, color: C.identidad },
    { k: 'nombreMes', t: 'MES', ancho: 12, color: C.identidad },
    { k: 'dias', t: 'DÍAS', ancho: 7, color: C.ingresos, conteo: true },
    { k: 'sdi', t: 'SDI', ancho: 12, color: C.ingresos },
    { k: 'imssRetenido', t: 'IMSS@RETENIDO', ancho: 13, color: C.descuentos, tinta: 'rojo' },
    { k: 'imssRecalc', t: 'IMSS@RECALC.', ancho: 13, color: C.totalDescuentos, tinta: 'rojo' },
    { k: 'difImss', t: 'DIF.@IMSS', ancho: 12, color: C.totalDescuentos, tinta: 'rojo' },
    { k: 'infonavit', t: 'INFONAVIT@DESC.', ancho: 14, color: C.descuentos, tinta: 'rojo' },
    { k: 'infRecalc', t: 'INF.@RECALC.', ancho: 13, color: C.totalDescuentos, tinta: 'rojo' },
    { k: 'difInf', t: 'DIF.@INF.', ancho: 12, color: C.totalDescuentos, tinta: 'rojo' },
  ], imss.filas, [
    { valor: `IMSS: ${imss.resumen.imssConDiferencia} · Inf.: ${imss.resumen.infonavitConDiferencia}`, fondo: C.totalAzul },
    { valor: '', fondo: C.totalAzul }, { valor: '', fondo: C.totalAzul }, { valor: '', fondo: C.totalAzul },
    { valor: '', fondo: C.totalAzul }, { valor: '', fondo: C.totalAzul },
    { valor: money(imss.resumen.imssTotalDiferencia), fondo: C.totalRojo, tinta: 'rojo' },
    { valor: '', fondo: C.totalAzul }, { valor: '', fondo: C.totalAzul },
    { valor: money(imss.resumen.infonavitTotalDiferencia), fondo: C.totalRojo, tinta: 'rojo' },
  ]);

  const buffer = await aBuffer(wb);
  return { buffer, nombre: `Revision_nomina_${emp.rfc || 'empresa'}_${anio}.xlsx` };
}

/**
 * PDF formal de DIFERENCIAS — datos originales (timbrados) vs. recalculados.
 *
 * Lista sólo lo relevante de las revisiones de ISR e IMSS/Infonavit: a quién, en
 * qué mes y concepto, cuánto se timbró, cuánto debió ser y la diferencia. Es el
 * reporte que acompaña a la revisión del año.
 */
export async function generarPdfRevision(
  companyId: string, anio: number,
): Promise<{ buffer: Buffer; nombre: string }> {
  const [isr, imss, empRow] = await Promise.all([
    revision.revisionCalculosIsr(companyId, anio),
    revision.revisionCalculosImss(companyId, anio),
    query<any>(`SELECT business_name, rfc FROM companies WHERE id = $1`, [companyId]),
  ]);
  const emp = empRow.rows[0] || {};

  const filas: any[] = [];
  for (const f of isr.filas || []) {
    if (f.marca) filas.push({
      trabajador: f.nombre || f.rfc, mes: f.nombreMes, concepto: 'ISR',
      original: f.isrRetenido, recalculado: r2(f.isrRetenido + f.diferencia), diferencia: f.diferencia,
    });
  }
  for (const f of imss.filas || []) {
    if (f.marcaImss) filas.push({
      trabajador: f.nombre || f.rfc, mes: f.nombreMes, concepto: 'IMSS',
      original: f.imssRetenido, recalculado: f.imssRecalc, diferencia: f.difImss,
    });
    if (f.marcaInf) filas.push({
      trabajador: f.nombre || f.rfc, mes: f.nombreMes, concepto: 'Infonavit',
      original: f.infonavit, recalculado: f.infRecalc, diferencia: f.difInf,
    });
    else if (f.posibleOmisionInf) filas.push({
      trabajador: f.nombre || f.rfc, mes: f.nombreMes, concepto: 'Infonavit — posible omisión',
      original: f.infonavit, recalculado: null, diferencia: null,
    });
  }
  filas.sort((a, b) => String(a.trabajador).localeCompare(String(b.trabajador), 'es'));
  const totalDif = r2(filas.reduce((s, f) => s + (Number(f.diferencia) || 0), 0));

  const buffer = await reporteTablaPdf({
    titulo: 'Revisión de nómina — diferencias de cálculo',
    empresa: emp.business_name || '',
    rfc: emp.rfc || '',
    subtitulos: [`Ejercicio ${anio}`, `Diferencias detectadas: ${filas.length}`],
    columnas: [
      { titulo: 'Trabajador', clave: 'trabajador', ancho: 30, align: 'left' },
      { titulo: 'Mes', clave: 'mes', ancho: 10, align: 'left' },
      { titulo: 'Concepto', clave: 'concepto', ancho: 20, align: 'left' },
      { titulo: 'Original (timbrado)', clave: 'original', ancho: 13, align: 'right', pesos: true },
      { titulo: 'Recalculado', clave: 'recalculado', ancho: 13, align: 'right', pesos: true },
      { titulo: 'Diferencia', clave: 'diferencia', ancho: 13, align: 'right', pesos: true },
    ],
    filas,
    totales: { trabajador: `${filas.length} diferencia(s)`, diferencia: totalDif },
    orientacion: 'landscape',
    nota: 'Datos originales (timbrados ante el SAT) vs. recalculados con LISR Art. 96 (ISR), LSS (IMSS) y Ley del Infonavit. '
      + 'La diferencia entre la retención por periodo y el cálculo mensual puede ser normal; se listan sólo las relevantes. '
      + 'El Infonavit se recalcula cuando el trabajador tiene su crédito en el expediente.',
    firmas: ['Elaboró', 'Revisó'],
  });
  return { buffer, nombre: `Revision_nomina_diferencias_${emp.rfc || 'empresa'}_${anio}.pdf` };
}
