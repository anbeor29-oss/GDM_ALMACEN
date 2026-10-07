/**
 * activos-export — Excel y PDF de las cédulas de DEPRECIACIÓN y AMORTIZACIÓN,
 * con el encabezado de la casa (empresa · reporte · fecha), igual que el resto.
 *
 * Los datos salen de `listarActivos` —lo MISMO que ve la pantalla—, separados en
 * las dos cédulas: depreciación (tangibles, gasto 701 / acumulada 171) y
 * amortización (intangibles y diferidos, gasto 702 / acumulada 183). Cada
 * renglón trae su ClaveProdServ (código + descripción del SAT) y DÓNDE cae en el
 * algoritmo: el rubro y su fundamento LISR, derivados del agrupador de la cuenta.
 *
 * El Excel reusa `nomina/estilo-excel`; el PDF, `utils/reporte-pdf`.
 */
import { query } from '../../config/database';
import { listarActivos } from './activos-fijos.service';
import { ExcelJS, C, titulo, dato, encabezado, celda, totales, anchos, aBuffer } from '../nomina/estilo-excel';
import { reporteTablaPdf, ColumnaPdf } from '../../utils/reporte-pdf';
import { fechaHoraMx, fechaMx } from '../../utils/fecha-mx';

async function empresaDe(companyId: string) {
  const r = await query<any>('SELECT business_name, rfc FROM companies WHERE id=$1', [companyId]);
  return { business_name: r.rows[0]?.business_name || '', rfc: r.rows[0]?.rfc || '' };
}

/** Parte la cédula: depreciación (tangibles) y amortización (intangibles/diferidos). */
function partir(activos: any[]) {
  return {
    dep: activos.filter((a) => !a.intangible),
    amo: activos.filter((a) => a.intangible),
  };
}

const sum = (filas: any[], k: string) =>
  Math.round(filas.reduce((s, x) => s + (Number(x[k]) || 0), 0) * 100) / 100;

/* ── Excel: una hoja por cédula ─────────────────────────────────────────────── */

const COLS_XLSX = [
  'CLAVE SAT', 'DESCRIPCIÓN SAT', 'CONCEPTO', 'RUBRO (ALGORITMO)', 'CUENTA', 'ADQUIRIDO',
  'MOI', 'RESIDUAL', 'TASA', 'ANUAL', 'MENSUAL', 'ACUMULADA', 'PENDIENTE', 'EN LIBROS', 'FUNDAMENTO LISR',
];

function hoja(wb: any, nombre: string, tituloTxt: string, emp: any, filas: any[]) {
  const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 6 }] });
  titulo(ws, tituloTxt, COLS_XLSX.length);
  dato(ws, 3, 1, `Empresa:   ${emp.business_name}`, true);
  dato(ws, 3, 7, `RFC:   ${emp.rfc}`);
  dato(ws, 4, 1, `Generado:   ${fechaHoraMx()}`);
  encabezado(ws, 6, COLS_XLSX.map((t) => ({ texto: t, color: C.identidad })));

  let fila = 7;
  for (const a of filas) {
    celda(ws, fila, 1, a.clave_prod_serv || '', { centrado: false });
    celda(ws, fila, 2, a.clave_prod_serv_desc || '');
    celda(ws, fila, 3, a.descripcion || '');
    celda(ws, fila, 4, a.categoria_etiqueta || '');
    celda(ws, fila, 5, a.cuenta_activo || '', { centrado: false });
    celda(ws, fila, 6, fechaMx(a.fecha_adquisicion) || '');
    celda(ws, fila, 7, Number(a.moi) || 0);
    celda(ws, fila, 8, Number(a.valor_residual) || 0);
    celda(ws, fila, 9, `${a.tasa_pct || 0}%`);
    celda(ws, fila, 10, Number(a.dep_anual) || 0);
    celda(ws, fila, 11, Number(a.dep_mensual) || 0);
    celda(ws, fila, 12, Number(a.acumulada) || 0);
    celda(ws, fila, 13, Number(a.pendiente) || 0);
    celda(ws, fila, 14, Number(a.valor_en_libros) || 0);
    celda(ws, fila, 15, a.fundamento || '');
    fila++;
  }
  totales(ws, fila, [
    { valor: '' }, { valor: '' }, { valor: '' }, { valor: '' }, { valor: '' },
    { valor: 'TOTALES', centrado: false },
    { valor: sum(filas, 'moi') }, { valor: '' }, { valor: '' },
    { valor: sum(filas, 'dep_anual') }, { valor: sum(filas, 'dep_mensual') },
    { valor: sum(filas, 'acumulada') }, { valor: sum(filas, 'pendiente') },
    { valor: sum(filas, 'valor_en_libros') }, { valor: '' },
  ]);
  anchos(ws, [14, 34, 30, 22, 12, 12, 14, 12, 8, 13, 13, 14, 13, 14, 34]);
}

export async function cedulaExcel(companyId: string): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, activos] = await Promise.all([empresaDe(companyId), listarActivos(companyId)]);
  const { dep, amo } = partir(activos);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GDM NEXO';
  hoja(wb, 'Depreciación', 'Cédula de depreciación (LISR 34-35)', emp, dep);
  hoja(wb, 'Amortización', 'Cédula de amortización (LISR 33)', emp, amo);
  return { buffer: await aBuffer(wb), nombre: 'Cedulas_depreciacion_amortizacion.xlsx' };
}

/* ── PDF: las dos cédulas en sus secciones ──────────────────────────────────── */

const COLS_PDF: ColumnaPdf[] = [
  { titulo: 'Clave SAT', clave: 'clave_prod_serv', ancho: 7 },
  { titulo: 'Descripción SAT', clave: 'clave_prod_serv_desc', ancho: 14 },
  { titulo: 'Concepto', clave: 'descripcion', ancho: 14 },
  { titulo: 'Rubro (algoritmo)', clave: 'categoria_etiqueta', ancho: 12 },
  { titulo: 'Cuenta', clave: 'cuenta_activo', ancho: 6 },
  { titulo: 'MOI', clave: 'moi', ancho: 8, pesos: true },
  { titulo: 'Tasa', clave: 'tasa_txt', ancho: 4, align: 'right' },
  { titulo: 'Mensual', clave: 'dep_mensual', ancho: 8, pesos: true },
  { titulo: 'Acumulada', clave: 'acumulada', ancho: 8, pesos: true },
  { titulo: 'En libros', clave: 'valor_en_libros', ancho: 8, pesos: true },
  { titulo: 'Fundamento LISR', clave: 'fundamento', ancho: 12 },
];

const filaPdf = (a: any) => ({ ...a, tasa_txt: `${a.tasa_pct || 0}%` });
const seccionPdf = (t: string) => ({ descripcion: t, _bold: true, _fondo: '#DCE6F5' });
const subtotalPdf = (filas: any[]) => ({
  descripcion: 'Subtotal', _bold: true,
  moi: sum(filas, 'moi'), dep_mensual: sum(filas, 'dep_mensual'),
  acumulada: sum(filas, 'acumulada'), valor_en_libros: sum(filas, 'valor_en_libros'),
});

export async function cedulaPdf(companyId: string): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, activos] = await Promise.all([empresaDe(companyId), listarActivos(companyId)]);
  const { dep, amo } = partir(activos);

  const filas: Array<Record<string, any>> = [];
  filas.push(seccionPdf('DEPRECIACIÓN'));
  filas.push(...dep.map(filaPdf));
  if (dep.length) filas.push(subtotalPdf(dep));
  filas.push(seccionPdf('AMORTIZACIÓN'));
  filas.push(...amo.map(filaPdf));
  if (amo.length) filas.push(subtotalPdf(amo));

  const buffer = await reporteTablaPdf({
    titulo: 'Cédulas de depreciación y amortización',
    empresa: emp.business_name,
    rfc: emp.rfc,
    subtitulos: ['Tasas máximas LISR arts. 33-35 · línea recta · MOI = costo neto sin IVA'],
    columnas: COLS_PDF,
    filas,
    orientacion: 'landscape',
    nota: 'La «Clave SAT» es la ClaveProdServ del CFDI con su descripción oficial; el «Rubro» y el '
      + '«Fundamento» indican dónde cae cada activo en el algoritmo de NEXO (por el agrupador de su cuenta). '
      + 'Las tasas son los máximos LISR, ajustables por activo.',
  });
  return { buffer, nombre: 'Cedulas_depreciacion_amortizacion.pdf' };
}
