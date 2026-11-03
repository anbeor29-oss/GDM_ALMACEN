/**
 * tiempo-extra-excel.service — reportes del TIEMPO EXTRAORDINARIO de un periodo
 * (etapa 5 del `.md`, para el TE): Excel del detalle y PDF por trabajador, con la
 * misma paleta/infra de los demás reportes de nómina.
 */
import { query } from '../../config/database';
import * as te from './tiempo-extra.service';
import { reporteTablaPdf } from '../../utils/reporte-pdf';

async function encabezado(companyId: string, periodoId: string) {
  const emp = (await query<any>(`SELECT business_name, rfc, registro_patronal FROM companies WHERE id=$1`, [companyId])).rows[0] || {};
  const per = (await query<any>(
    `SELECT numero, tipo, TO_CHAR(fecha_inicio,'YYYY-MM-DD') AS ini, TO_CHAR(fecha_fin,'YYYY-MM-DD') AS fin
       FROM nomina_periodos WHERE id=$1 AND company_id=$2`, [periodoId, companyId])).rows[0] || {};
  return { emp, per };
}

export async function generarExcelTe(companyId: string, periodoId: string): Promise<{ buffer: Buffer; nombre: string }> {
  const { ExcelJS, C, titulo, dato, encabezado: enc, celda, totales, anchos, aBuffer } = await import('./estilo-excel');
  const { emp, per } = await encabezado(companyId, periodoId);
  const { filas, totales: tot } = await te.listar(companyId, periodoId);

  const cols = [
    { k: 'nombre', t: 'TRABAJADOR', ancho: 30, color: C.identidad },
    { k: 'fecha', t: 'FECHA', ancho: 12, color: C.identidad },
    { k: 'salida', t: 'SALIDA@PROG→REAL', ancho: 16, color: C.ingresos, texto: true },
    { k: 'horas_dobles', t: 'HORAS@DOBLES', ancho: 11, color: C.ingresos, conteo: true },
    { k: 'importe_dobles', t: 'IMPORTE@DOBLES', ancho: 14, color: C.totalIngresos },
    { k: 'horas_triples', t: 'HORAS@TRIPLES', ancho: 11, color: C.ingresos, conteo: true },
    { k: 'importe_triples', t: 'IMPORTE@TRIPLES', ancho: 14, color: C.totalIngresos },
    { k: 'total_bruto', t: 'TOTAL', ancho: 14, color: C.neto },
    { k: 'exento_isr', t: 'EXENTO@ISR', ancho: 13, color: C.ingresos, tinta: 'verde' as const },
    { k: 'gravado_isr', t: 'GRAVADO@ISR', ancho: 13, color: C.descuentos, tinta: 'rojo' as const },
    { k: 'estatus', t: 'ESTATUS', ancho: 12, color: C.identidad, texto: true },
  ];

  const wb = new ExcelJS.Workbook(); wb.creator = 'GDM NEXO';
  const ws = wb.addWorksheet('Tiempo extra', { views: [{ state: 'frozen', ySplit: 8 }] });
  titulo(ws, 'GDM NEXO · Tiempo extraordinario', cols.length);
  dato(ws, 3, 1, `Empresa:   ${emp.business_name || ''}`, true);
  dato(ws, 3, 5, `RFC:   ${emp.rfc || ''}`);
  dato(ws, 4, 1, `Reg. Patronal:   ${emp.registro_patronal || '(sin capturar)'}`);
  dato(ws, 4, 5, `Generado:   ${new Date().toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`);
  dato(ws, 5, 1, `Periodo:   ${per.tipo || ''} #${per.numero ?? ''} · ${per.ini || ''} a ${per.fin || ''}`);
  dato(ws, 6, 1, 'Dobles/triples y exento ISR según parámetros versionados (validar DOF). Lo autorizado es lo que se paga.');
  enc(ws, 8, cols.map((c) => ({ texto: c.t.replace('@', '\n'), color: c.color })));

  let fila = 9;
  for (const r of filas) {
    const salida = `${r.hora_salida_prog || ''}→${r.hora_salida_real || ''}`;
    cols.forEach((c, i) => {
      const v = (c as any).texto
        ? (c.k === 'salida' ? salida : r[c.k])
        : (c as any).conteo ? Number(r[c.k]) : r[c.k];
      celda(ws, fila, i + 1, v === null || v === undefined ? '' : v,
        { tinta: (c as any).tinta, pesos: !(c as any).texto && !(c as any).conteo, centrado: !!(c as any).conteo });
    });
    fila++;
  }
  totales(ws, fila, cols.map((c) => {
    const mapa: Record<string, any> = {
      nombre: `${filas.length} renglón(es)`, total_bruto: tot.bruto, exento_isr: tot.exento, gravado_isr: tot.gravado,
    };
    const v = mapa[c.k];
    return { valor: v === undefined ? '' : v, fondo: c.k === 'gravado_isr' ? C.totalRojo : c.k === 'exento_isr' ? C.totalVerde : C.totalAzul,
      tinta: (c as any).tinta };
  }));
  anchos(ws, cols.map((c) => c.ancho));

  const buffer = await aBuffer(wb);
  return { buffer, nombre: `Tiempo_extra_${emp.rfc || 'empresa'}_${per.ini || ''}.xlsx` };
}

export async function generarPdfTe(companyId: string, periodoId: string): Promise<{ buffer: Buffer; nombre: string }> {
  const { emp, per } = await encabezado(companyId, periodoId);
  const { filas, totales: tot } = await te.listar(companyId, periodoId);
  const buffer = await reporteTablaPdf({
    titulo: 'Tiempo extraordinario',
    empresa: emp.business_name || '', rfc: emp.rfc || '',
    subtitulos: [`Periodo ${per.tipo || ''} #${per.numero ?? ''} · ${per.ini || ''} a ${per.fin || ''}`, `${filas.length} renglón(es)`],
    columnas: [
      { titulo: 'Trabajador', clave: 'nombre', ancho: 26, align: 'left' },
      { titulo: 'Fecha', clave: 'fecha', ancho: 10, align: 'left' },
      { titulo: 'Dobles (h)', clave: 'horas_dobles', ancho: 9, align: 'right' },
      { titulo: 'Triples (h)', clave: 'horas_triples', ancho: 9, align: 'right' },
      { titulo: 'Total', clave: 'total_bruto', ancho: 11, align: 'right', pesos: true },
      { titulo: 'Exento', clave: 'exento_isr', ancho: 11, align: 'right', pesos: true },
      { titulo: 'Gravado', clave: 'gravado_isr', ancho: 11, align: 'right', pesos: true },
      { titulo: 'Estatus', clave: 'estatus', ancho: 11, align: 'left' },
    ],
    filas,
    totales: { nombre: `${filas.length} renglón(es)`, total_bruto: tot.bruto, exento_isr: tot.exento, gravado_isr: tot.gravado },
    orientacion: 'landscape',
    nota: 'Horas dobles/triples (LFT Art. 67/68) y parte exenta de ISR (LISR Art. 93-I, 50% con tope 5 UMA/semana) según parámetros versionados; valídalos contra el DOF. La tolerancia sólo detecta; lo autorizado es lo que se paga.',
    firmas: ['Elaboró', 'Autorizó'],
  });
  return { buffer, nombre: `Tiempo_extra_${emp.rfc || 'empresa'}_${per.ini || ''}.pdf` };
}
