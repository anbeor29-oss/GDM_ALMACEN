/**
 * reportes-export — Excel y PDF de los reportes de Contabilidad, con el
 * encabezado de la casa (empresa · nombre del reporte · fecha), igual que el de
 * Nómina que pidió el usuario.
 *
 * El Excel reusa los helpers de `nomina/estilo-excel` (misma paleta, para que
 * todo salga parejo); el PDF reusa `utils/reporte-pdf`. Los DATOS salen del
 * mismo motor que ya alimenta la pantalla (`periodos.service`), así que el
 * archivo dice exactamente lo que se ve.
 */

import { query } from '../../config/database';
import { NotFoundError } from '../../middleware/errorHandler';
import { balanzaDelPeriodo, auxiliarDeCuenta, contextoDelPeriodo, nombreMes } from './periodos.service';
import { situacionFinanciera, resultadoIntegral, juegoCompleto } from './estados-financieros.service';
import {
  ExcelJS, C, titulo, dato, encabezado, celda, totales, anchos, aBuffer,
} from '../nomina/estilo-excel';
import { reporteTablaPdf, ColumnaPdf } from '../../utils/reporte-pdf';

interface Empresa { business_name: string; rfc: string; }

async function empresaDe(companyId: string): Promise<Empresa> {
  const r = await query<any>('SELECT business_name, rfc FROM companies WHERE id=$1', [companyId]);
  const e = r.rows[0] || {};
  return { business_name: e.business_name || '', rfc: e.rfc || '' };
}

const fechaGen = () => new Date().toLocaleString('es-MX');

/* ── Balanza de comprobación ─────────────────────────────────────────────── */

export async function balanzaExcel(companyId: string, anio: number, mes: number): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, bal] = await Promise.all([empresaDe(companyId), balanzaDelPeriodo(companyId, anio, mes)]);
  if (!bal) throw new NotFoundError(`No hay balanza cargada para ${nombreMes(mes)} ${anio}.`);

  const cols = ['CÓDIGO', 'CUENTA', 'SALDO INICIAL', 'CARGOS', 'ABONOS', 'SALDO FINAL'];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GDM NEXO';
  const ws = wb.addWorksheet('Balanza', { views: [{ state: 'frozen', ySplit: 6 }] });

  titulo(ws, 'Balanza de comprobación', cols.length);
  dato(ws, 3, 1, `Empresa:   ${emp.business_name}`, true);
  dato(ws, 3, 4, `RFC:   ${emp.rfc}`);
  dato(ws, 4, 1, `Período:   ${nombreMes(mes)} ${anio}`);
  dato(ws, 4, 4, `Generado:   ${fechaGen()}`);
  encabezado(ws, 6, cols.map((t) => ({ texto: t, color: C.identidad })));

  let fila = 7;
  for (const f of bal.filas) {
    celda(ws, fila, 1, f.codigo, { centrado: false });
    celda(ws, fila, 2, f.nombre);
    celda(ws, fila, 3, Number(f.saldo_inicial));
    celda(ws, fila, 4, Number(f.cargos));
    celda(ws, fila, 5, Number(f.abonos));
    celda(ws, fila, 6, Number(f.saldo_final));
    fila++;
  }
  const sumIni = bal.filas.reduce((a: number, x: any) => a + Number(x.saldo_inicial), 0);
  const sumFin = bal.filas.reduce((a: number, x: any) => a + Number(x.saldo_final), 0);
  totales(ws, fila, [
    { valor: '' }, { valor: 'TOTALES', centrado: false },
    { valor: Math.round(sumIni * 100) / 100 }, { valor: bal.sumaCargos },
    { valor: bal.sumaAbonos }, { valor: Math.round(sumFin * 100) / 100 },
  ]);
  anchos(ws, [16, 44, 16, 16, 16, 16]);

  return { buffer: await aBuffer(wb), nombre: `Balanza_${anio}-${String(mes).padStart(2, '0')}.xlsx` };
}

/* ═══════════════════════════════════════════════════════════════════════════
   REPORTES ANUALES — 12 columnas (ene…dic), una por mes. Para trabajar el año de
   corrido: balanza (saldo final por cuenta), estado de resultados y situación
   financiera (por rubro). Mismo encabezado (empresa · reporte · fecha/hora).
   ═══════════════════════════════════════════════════════════════════════════ */
const MES3 = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

/** Junta los 12 meses de una extracción {clave, concepto, importe} en filas con 12
 *  valores, conservando el orden en que aparecen. */
async function matrizAnual(
  companyId: string, anio: number,
  extractor: (ctx: any) => Array<{ clave: string; concepto: string; importe: number }>,
): Promise<Array<{ concepto: string; valores: number[] }>> {
  const orden: string[] = [];
  const filas = new Map<string, { concepto: string; valores: number[] }>();
  for (let m = 1; m <= 12; m++) {
    const ctx = await contextoDelPeriodo(companyId, anio, m);
    if (!ctx) continue;
    for (const r of extractor(ctx)) {
      let f = filas.get(r.clave);
      if (!f) { f = { concepto: r.concepto, valores: new Array(12).fill(0) }; filas.set(r.clave, f); orden.push(r.clave); }
      f.valores[m - 1] = Number(r.importe) || 0;
    }
  }
  return orden.map((k) => filas.get(k)!);
}

function rubrosSituacion(ctx: any): Array<{ clave: string; concepto: string; importe: number }> {
  const sf: any = situacionFinanciera(ctx);
  const secs = [sf.activoCirculante, sf.activoNoCirculante, sf.pasivoCorto, sf.pasivoLargo, sf.capital];
  const out: Array<{ clave: string; concepto: string; importe: number }> = [];
  for (const sec of secs) {
    if (!sec) continue;
    for (const r of sec.rubros || []) out.push({ clave: r.clave, concepto: `${sec.nombre} · ${r.nombre}`, importe: Number(r.importe) || 0 });
  }
  return out;
}

async function armarExcelAnual(
  emp: any, anio: number, tituloRep: string, nombreBase: string, colsPre: string[],
  filas: Array<{ pre: (string | number)[]; valores: number[] }>, anchosPre: number[],
): Promise<{ buffer: Buffer; nombre: string }> {
  const cols = [...colsPre, ...MES3];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GDM NEXO';
  const ws = wb.addWorksheet('Anual', { views: [{ state: 'frozen', xSplit: colsPre.length, ySplit: 6 }] });
  titulo(ws, tituloRep, cols.length);
  dato(ws, 3, 1, `Empresa:   ${emp.business_name}`, true);
  dato(ws, 3, 4, `RFC:   ${emp.rfc}`);
  dato(ws, 4, 1, `Ejercicio:   ${anio} (enero a diciembre)`);
  dato(ws, 4, 4, `Generado:   ${fechaGen()}`);
  encabezado(ws, 6, cols.map((t) => ({ texto: t, color: C.identidad })));
  let fila = 7;
  for (const f of filas) {
    let col = 1;
    for (const p of f.pre) { celda(ws, fila, col, p, { centrado: false }); col++; }
    for (const v of f.valores) { celda(ws, fila, col, v); col++; }
    fila++;
  }
  // Sumas por columna (una por mes) al pie, para verificar de un vistazo.
  const sumas = new Array(12).fill(0);
  for (const f of filas) f.valores.forEach((v, j) => { sumas[j] += Number(v) || 0; });
  const preTot = colsPre.map((_, i) => ({ valor: i === 0 ? 'TOTALES' : '', centrado: false }));
  totales(ws, fila, [...preTot, ...sumas.map((s) => ({ valor: Math.round(s * 100) / 100 }))]);
  anchos(ws, [...anchosPre, ...new Array(12).fill(14)]);
  return { buffer: await aBuffer(wb), nombre: `${nombreBase}_anual_${anio}.xlsx` };
}

export async function reporteAnualExcel(
  companyId: string, anio: number, tipo: 'balanza' | 'situacion' | 'resultados',
): Promise<{ buffer: Buffer; nombre: string }> {
  const emp = await empresaDe(companyId);

  if (tipo === 'balanza') {
    const cuentas = new Map<string, { codigo: string; nombre: string; valores: number[]; presente: boolean[] }>();
    for (let m = 1; m <= 12; m++) {
      const bal = await balanzaDelPeriodo(companyId, anio, m);
      if (!bal) continue;
      for (const f of bal.filas) {
        let c = cuentas.get(f.codigo);
        if (!c) { c = { codigo: f.codigo, nombre: f.nombre, valores: new Array(12).fill(0), presente: new Array(12).fill(false) }; cuentas.set(f.codigo, c); }
        c.valores[m - 1] = Number(f.saldo_final);
        c.presente[m - 1] = true;
      }
    }
    if (cuentas.size === 0) throw new NotFoundError(`No hay balanza cargada en ${anio}.`);
    // Arrastre: una vez que la cuenta aparece, los meses sin movimiento conservan el
    // saldo del mes anterior, para que TODAS las cuentas estén en todas las columnas.
    for (const c of cuentas.values()) {
      for (let i = 1; i < 12; i++) {
        if (!c.presente[i] && c.presente.slice(0, i).some(Boolean)) c.valores[i] = c.valores[i - 1];
      }
    }
    const arr = [...cuentas.values()].sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
    return armarExcelAnual(emp, anio, 'Balanza de comprobación — anual (saldo final por mes)', 'Balanza',
      ['CÓDIGO', 'CUENTA'], arr.map((c) => ({ pre: [c.codigo, c.nombre], valores: c.valores })), [16, 40]);
  }

  const filas = tipo === 'resultados'
    ? await matrizAnual(companyId, anio, (ctx) =>
        (resultadoIntegral(ctx) as any).renglones.map((r: any) => ({ clave: r.clave, concepto: r.nombre, importe: Number(r.importe) || 0 })))
    : await matrizAnual(companyId, anio, rubrosSituacion);
  if (filas.length === 0) throw new NotFoundError(`No hay datos cargados en ${anio}.`);
  const tit = tipo === 'resultados'
    ? 'Estado de resultados — anual (acumulado por mes)'
    : 'Estado de situación financiera — anual (saldo por mes)';
  const base = tipo === 'resultados' ? 'Estado_de_resultados' : 'Situacion_financiera';
  return armarExcelAnual(emp, anio, tit, base, ['CONCEPTO'],
    filas.map((f) => ({ pre: [f.concepto], valores: f.valores })), [50]);
}

export async function balanzaPdf(companyId: string, anio: number, mes: number): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, bal] = await Promise.all([empresaDe(companyId), balanzaDelPeriodo(companyId, anio, mes)]);
  if (!bal) throw new NotFoundError(`No hay balanza cargada para ${nombreMes(mes)} ${anio}.`);

  const columnas: ColumnaPdf[] = [
    { titulo: 'Código', clave: 'codigo', ancho: 12 },
    { titulo: 'Cuenta', clave: 'nombre', ancho: 34 },
    { titulo: 'Saldo inicial', clave: 'saldo_inicial', ancho: 14, pesos: true },
    { titulo: 'Cargos', clave: 'cargos', ancho: 13, pesos: true },
    { titulo: 'Abonos', clave: 'abonos', ancho: 13, pesos: true },
    { titulo: 'Saldo final', clave: 'saldo_final', ancho: 14, pesos: true },
  ];
  const sumIni = bal.filas.reduce((a: number, x: any) => a + Number(x.saldo_inicial), 0);
  const sumFin = bal.filas.reduce((a: number, x: any) => a + Number(x.saldo_final), 0);

  const buffer = await reporteTablaPdf({
    titulo: 'Balanza de comprobación',
    empresa: emp.business_name, rfc: emp.rfc,
    subtitulos: [`Período: ${nombreMes(mes)} ${anio}`],
    columnas, filas: bal.filas,
    totales: {
      codigo: '', nombre: 'TOTALES',
      saldo_inicial: Math.round(sumIni * 100) / 100, cargos: bal.sumaCargos,
      abonos: bal.sumaAbonos, saldo_final: Math.round(sumFin * 100) / 100,
    },
    nota: bal.cuadra ? 'La balanza cuadra (cargos = abonos).' : `NO cuadra: diferencia ${bal.diferencia.toFixed(2)}.`,
  });
  return { buffer, nombre: `Balanza_${anio}-${String(mes).padStart(2, '0')}.pdf` };
}

/* ── Auxiliar de una cuenta ──────────────────────────────────────────────── */

export async function auxiliarExcel(companyId: string, codigo: string, anio: number, mes: number): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, aux] = await Promise.all([empresaDe(companyId), auxiliarDeCuenta(companyId, codigo, anio, mes)]);
  if (!aux) throw new NotFoundError(`No existe la cuenta ${codigo}.`);

  const cols = ['FECHA', 'FOLIO', 'CONCEPTO', 'CARGO', 'ABONO', 'SALDO'];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GDM NEXO';
  const ws = wb.addWorksheet('Auxiliar', { views: [{ state: 'frozen', ySplit: 7 }] });

  titulo(ws, 'Auxiliar de cuenta', cols.length);
  dato(ws, 3, 1, `Empresa:   ${emp.business_name}`, true);
  dato(ws, 3, 4, `RFC:   ${emp.rfc}`);
  dato(ws, 4, 1, `Cuenta:   ${aux.cuenta.codigo} · ${aux.cuenta.nombre}`);
  dato(ws, 4, 4, `Generado:   ${fechaGen()}`);
  dato(ws, 5, 1, `Período:   ${nombreMes(mes)} ${anio}   ·   Saldo inicial: ${(Number(aux.saldoInicial) || 0).toFixed(2)}`);
  encabezado(ws, 7, cols.map((t) => ({ texto: t, color: C.identidad })));

  let fila = 8;
  for (const m of aux.movimientos) {
    celda(ws, fila, 1, m.fecha, { centrado: true });
    celda(ws, fila, 2, m.folio, { centrado: true });
    celda(ws, fila, 3, m.linea_concepto || m.poliza_concepto || '');
    celda(ws, fila, 4, Number(m.cargo));
    celda(ws, fila, 5, Number(m.abono));
    celda(ws, fila, 6, Number(m.saldo));
    fila++;
  }
  const sumC = aux.movimientos.reduce((a: number, x: any) => a + Number(x.cargo), 0);
  const sumA = aux.movimientos.reduce((a: number, x: any) => a + Number(x.abono), 0);
  totales(ws, fila, [
    { valor: '' }, { valor: '' }, { valor: 'TOTALES', centrado: false },
    { valor: Math.round(sumC * 100) / 100 }, { valor: Math.round(sumA * 100) / 100 }, { valor: '' },
  ]);
  anchos(ws, [12, 8, 50, 15, 15, 15]);

  return { buffer: await aBuffer(wb), nombre: `Auxiliar_${aux.cuenta.codigo}_${anio}-${String(mes).padStart(2, '0')}.xlsx` };
}

export async function auxiliarPdf(companyId: string, codigo: string, anio: number, mes: number): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, aux] = await Promise.all([empresaDe(companyId), auxiliarDeCuenta(companyId, codigo, anio, mes)]);
  if (!aux) throw new NotFoundError(`No existe la cuenta ${codigo}.`);

  const columnas: ColumnaPdf[] = [
    { titulo: 'Fecha', clave: 'fecha', ancho: 12, align: 'center' },
    { titulo: 'Folio', clave: 'folio', ancho: 8, align: 'center' },
    { titulo: 'Concepto', clave: 'concepto', ancho: 42 },
    { titulo: 'Cargo', clave: 'cargo', ancho: 13, pesos: true },
    { titulo: 'Abono', clave: 'abono', ancho: 13, pesos: true },
    { titulo: 'Saldo', clave: 'saldo', ancho: 13, pesos: true },
  ];
  const filas = aux.movimientos.map((m: any) => ({
    fecha: m.fecha, folio: m.folio, concepto: m.linea_concepto || m.poliza_concepto || '',
    cargo: m.cargo, abono: m.abono, saldo: m.saldo,
  }));
  const sumC = aux.movimientos.reduce((a: number, x: any) => a + Number(x.cargo), 0);
  const sumA = aux.movimientos.reduce((a: number, x: any) => a + Number(x.abono), 0);

  const buffer = await reporteTablaPdf({
    titulo: 'Auxiliar de cuenta',
    empresa: emp.business_name, rfc: emp.rfc,
    subtitulos: [
      `Cuenta: ${aux.cuenta.codigo} · ${aux.cuenta.nombre}`,
      `Período: ${nombreMes(mes)} ${anio}   ·   Saldo inicial: ${(Number(aux.saldoInicial) || 0).toFixed(2)}`,
    ],
    columnas, filas,
    totales: { fecha: '', folio: '', concepto: 'TOTALES', cargo: Math.round(sumC * 100) / 100, abono: Math.round(sumA * 100) / 100, saldo: '' },
  });
  return { buffer, nombre: `Auxiliar_${aux.cuenta.codigo}_${anio}-${String(mes).padStart(2, '0')}.pdf` };
}

/* ── Estados financieros (Situación financiera y Estado de resultados) ─────── */

/** Una fila de un estado a dos columnas: concepto e importe. */
interface FilaEstado { concepto: string; importe: number | ''; bold?: boolean; sombra?: boolean; }

async function ctxDe(companyId: string, anio: number, mes: number) {
  const ctx = await contextoDelPeriodo(companyId, anio, mes);
  if (!ctx) throw new NotFoundError(`${nombreMes(mes)} ${anio} todavía no tiene saldos cargados.`);
  return ctx;
}

async function estadoExcel(emp: Empresa, tituloReporte: string, subtitulo: string, filas: FilaEstado[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GDM NEXO';
  const ws = wb.addWorksheet(tituloReporte.slice(0, 28), { views: [{ state: 'frozen', ySplit: 6 }] });
  titulo(ws, tituloReporte, 2);
  dato(ws, 3, 1, `Empresa:   ${emp.business_name}`, true);
  dato(ws, 4, 1, `RFC:   ${emp.rfc}`);
  dato(ws, 4, 2, `Generado:   ${fechaGen()}`);
  dato(ws, 5, 1, subtitulo);
  encabezado(ws, 6, [{ texto: 'CONCEPTO', color: C.identidad }, { texto: 'IMPORTE', color: C.identidad }]);
  let fila = 7;
  for (const f of filas) {
    const fondo = f.sombra ? C.totalAzul : undefined;
    celda(ws, fila, 1, f.concepto, { negrita: f.bold, fondo });
    celda(ws, fila, 2, f.importe === '' ? '' : Number(f.importe), { negrita: f.bold, fondo });
    fila++;
  }
  anchos(ws, [58, 20]);
  return aBuffer(wb);
}

function estadoPdf(emp: Empresa, tituloReporte: string, subtitulo: string, filas: FilaEstado[]): Promise<Buffer> {
  return reporteTablaPdf({
    titulo: tituloReporte, empresa: emp.business_name, rfc: emp.rfc, subtitulos: [subtitulo],
    orientacion: 'portrait',
    columnas: [
      { titulo: 'Concepto', clave: 'concepto', ancho: 62 },
      { titulo: 'Importe', clave: 'importe', ancho: 22, pesos: true },
    ],
    filas: filas.map((f) => ({
      concepto: f.concepto, importe: f.importe, _bold: f.bold, _fondo: f.sombra ? '#DCE6F5' : undefined,
    })),
  });
}

function filasSituacion(sf: any): FilaEstado[] {
  const filas: FilaEstado[] = [];
  const seccion = (sec: any) => {
    filas.push({ concepto: String(sec.nombre).toUpperCase(), importe: sec.total, bold: true });
    for (const r of sec.rubros) if (Math.abs(r.importe) >= 1) filas.push({ concepto: `    ${r.nombre}`, importe: r.importe });
  };
  seccion(sf.activoCirculante);
  seccion(sf.activoNoCirculante);
  filas.push({ concepto: 'ACTIVO TOTAL', importe: sf.activoTotal, bold: true, sombra: true });
  seccion(sf.pasivoCorto);
  seccion(sf.pasivoLargo);
  filas.push({ concepto: 'PASIVO TOTAL', importe: sf.pasivoTotal, bold: true, sombra: true });
  seccion(sf.capital);
  filas.push({ concepto: 'CAPITAL CONTABLE', importe: sf.capitalTotal, bold: true, sombra: true });
  filas.push({ concepto: 'PASIVO + CAPITAL', importe: Math.round((sf.pasivoTotal + sf.capitalTotal) * 100) / 100, bold: true, sombra: true });
  return filas;
}

function filasResultados(ri: any): FilaEstado[] {
  return ri.renglones
    .filter((r: any) => Math.abs(r.importe) >= 1 || !r.codigos) // subtotales siempre; rubros con cifra
    .map((r: any) => ({
      concepto: r.codigos ? `    ${r.nombre}` : String(r.nombre).toUpperCase(),
      importe: r.importe,
      bold: !r.codigos,
      sombra: r.clave === 'UTILIDAD_NETA',
    }));
}

export async function situacionExcel(companyId: string, anio: number, mes: number): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, ctx] = await Promise.all([empresaDe(companyId), ctxDe(companyId, anio, mes)]);
  const sf = situacionFinanciera(ctx);
  const buffer = await estadoExcel(emp, 'Estado de situación financiera', `Al cierre de ${nombreMes(mes)} ${anio}`, filasSituacion(sf));
  return { buffer, nombre: `Situacion_${anio}-${String(mes).padStart(2, '0')}.xlsx` };
}

export async function situacionPdf(companyId: string, anio: number, mes: number): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, ctx] = await Promise.all([empresaDe(companyId), ctxDe(companyId, anio, mes)]);
  const sf = situacionFinanciera(ctx);
  const buffer = await estadoPdf(emp, 'Estado de situación financiera', `Al cierre de ${nombreMes(mes)} ${anio}`, filasSituacion(sf));
  return { buffer, nombre: `Situacion_${anio}-${String(mes).padStart(2, '0')}.pdf` };
}

export async function resultadosExcel(companyId: string, anio: number, mes: number): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, ctx] = await Promise.all([empresaDe(companyId), ctxDe(companyId, anio, mes)]);
  const ri = resultadoIntegral(ctx);
  const buffer = await estadoExcel(emp, 'Estado de resultados', `Del período de ${nombreMes(mes)} ${anio}`, filasResultados(ri));
  return { buffer, nombre: `Resultados_${anio}-${String(mes).padStart(2, '0')}.xlsx` };
}

export async function resultadosPdf(companyId: string, anio: number, mes: number): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, ctx] = await Promise.all([empresaDe(companyId), ctxDe(companyId, anio, mes)]);
  const ri = resultadoIntegral(ctx);
  const buffer = await estadoPdf(emp, 'Estado de resultados', `Del período de ${nombreMes(mes)} ${anio}`, filasResultados(ri));
  return { buffer, nombre: `Resultados_${anio}-${String(mes).padStart(2, '0')}.pdf` };
}

/* ── Estados analíticos (Flujo, Cambios en capital, Razones) ───────────────── */

const mm = (mes: number) => String(mes).padStart(2, '0');

/** El juego completo del mes (como la pantalla): trae flujo, cambios y razones. */
async function juegoDe(companyId: string, anio: number, mes: number) {
  const ctx = await ctxDe(companyId, anio, mes);
  const mesAnt = mes === 1 ? 12 : mes - 1;
  const anioAnt = mes === 1 ? anio - 1 : anio;
  const ctxAnt = (await contextoDelPeriodo(companyId, anioAnt, mesAnt)) ?? undefined;
  const p = await balanzaDelPeriodo(companyId, anio, mes);
  const dias = p
    ? Math.round((new Date(p.fechaFin).getTime() - new Date(p.fechaInicio).getTime()) / 86400000) + 1
    : 30;
  return juegoCompleto(ctx, ctxAnt, dias);
}

/* Flujo de efectivo — dos columnas, por actividad. */
function filasFlujo(fe: any): FilaEstado[] {
  const filas: FilaEstado[] = [];
  const bloque = (nombre: string, rubros: any[], subtotal: number) => {
    filas.push({ concepto: nombre.toUpperCase(), importe: '', bold: true });
    for (const r of rubros) filas.push({ concepto: `    ${r.nombre}`, importe: r.importe });
    filas.push({ concepto: `    Flujo neto de ${nombre.toLowerCase()}`, importe: subtotal, bold: true });
  };
  bloque('Actividades de operación', fe.operacion, fe.flujoOperacion);
  bloque('Actividades de inversión', fe.inversion, fe.flujoInversion);
  bloque('Actividades de financiamiento', fe.financiamiento, fe.flujoFinanciamiento);
  filas.push({ concepto: 'INCREMENTO (DISMINUCIÓN) NETO DE EFECTIVO', importe: fe.incrementoNeto, bold: true, sombra: true });
  filas.push({ concepto: 'Efectivo al inicio del período', importe: fe.efectivoInicial });
  filas.push({ concepto: 'Efectivo al final del período', importe: fe.efectivoFinal, bold: true });
  return filas;
}

function flujoOFalla(fe: any) {
  if (!fe.disponible) throw new NotFoundError(fe.motivo || 'El flujo de efectivo necesita el mes anterior cargado.');
}

export async function flujoExcel(companyId: string, anio: number, mes: number): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, juego] = await Promise.all([empresaDe(companyId), juegoDe(companyId, anio, mes)]);
  flujoOFalla(juego.flujoEfectivo);
  const buffer = await estadoExcel(emp, 'Estado de flujo de efectivo', `Del período de ${nombreMes(mes)} ${anio} (método indirecto)`, filasFlujo(juego.flujoEfectivo));
  return { buffer, nombre: `Flujo_${anio}-${mm(mes)}.xlsx` };
}

export async function flujoPdf(companyId: string, anio: number, mes: number): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, juego] = await Promise.all([empresaDe(companyId), juegoDe(companyId, anio, mes)]);
  flujoOFalla(juego.flujoEfectivo);
  const buffer = await estadoPdf(emp, 'Estado de flujo de efectivo', `Del período de ${nombreMes(mes)} ${anio} (método indirecto)`, filasFlujo(juego.flujoEfectivo));
  return { buffer, nombre: `Flujo_${anio}-${mm(mes)}.pdf` };
}

/* Cambios en el capital contable — matriz (columnas dinámicas del capital). */
function cambiosOFalla(cc: any) {
  if (!cc.disponible) throw new NotFoundError(cc.motivo || 'Cambios en el capital necesita el mes anterior cargado.');
}

export async function cambiosExcel(companyId: string, anio: number, mes: number): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, juego] = await Promise.all([empresaDe(companyId), juegoDe(companyId, anio, mes)]);
  const cc = juego.cambiosCapital; cambiosOFalla(cc);
  const cols = ['CONCEPTO', ...cc.columnas.map((c: string) => c.toUpperCase()), 'TOTAL'];
  const wb = new ExcelJS.Workbook(); wb.creator = 'GDM NEXO';
  const ws = wb.addWorksheet('Cambios en capital', { views: [{ state: 'frozen', ySplit: 6 }] });
  titulo(ws, 'Estado de cambios en el capital contable', cols.length);
  dato(ws, 3, 1, `Empresa:   ${emp.business_name}`, true);
  dato(ws, 4, 1, `RFC:   ${emp.rfc}`);
  dato(ws, 5, 1, `Del período de ${nombreMes(mes)} ${anio}   ·   Generado: ${fechaGen()}`);
  encabezado(ws, 6, cols.map((t) => ({ texto: t, color: C.identidad })));
  let fila = 7;
  for (const r of cc.renglones) {
    const fondo = r.esSaldo ? C.totalAzul : undefined;
    celda(ws, fila, 1, r.concepto, { negrita: r.esSaldo, fondo });
    r.valores.forEach((v: number, i: number) => celda(ws, fila, 2 + i, Number(v), { negrita: r.esSaldo, fondo }));
    celda(ws, fila, 2 + r.valores.length, Number(r.total), { negrita: true, fondo });
    fila++;
  }
  anchos(ws, [30, ...cc.columnas.map(() => 16), 16]);
  return { buffer: await aBuffer(wb), nombre: `CambiosCapital_${anio}-${mm(mes)}.xlsx` };
}

export async function cambiosPdf(companyId: string, anio: number, mes: number): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, juego] = await Promise.all([empresaDe(companyId), juegoDe(companyId, anio, mes)]);
  const cc = juego.cambiosCapital; cambiosOFalla(cc);
  const columnas: ColumnaPdf[] = [
    { titulo: 'Concepto', clave: 'concepto', ancho: 26 },
    ...cc.columnas.map((c: string, i: number) => ({ titulo: c, clave: `c${i}`, ancho: 14, pesos: true })),
    { titulo: 'Total', clave: 'total', ancho: 14, pesos: true },
  ];
  const filas = cc.renglones.map((r: any) => {
    const row: Record<string, any> = { concepto: r.concepto, total: r.total, _bold: r.esSaldo, _fondo: r.esSaldo ? '#DCE6F5' : undefined };
    r.valores.forEach((v: number, i: number) => { row[`c${i}`] = v; });
    return row;
  });
  const buffer = await reporteTablaPdf({
    titulo: 'Estado de cambios en el capital contable', empresa: emp.business_name, rfc: emp.rfc,
    subtitulos: [`Del período de ${nombreMes(mes)} ${anio}`], orientacion: 'landscape', columnas, filas,
  });
  return { buffer, nombre: `CambiosCapital_${anio}-${mm(mes)}.pdf` };
}

/* Razones financieras — tabla ancha (razón, fórmula, valor, referencia, estado, interpretación). */
function valorRazon(r: any): string {
  if (r.valor === null || r.valor === undefined) return '—';
  const v = Number(r.valor);
  switch (r.unidad) {
    case 'VECES': return `${v.toFixed(2)}x`;
    case 'PORCENTAJE': return `${v.toFixed(2)}%`;
    case 'DIAS': return `${Math.round(v)} días`;
    case 'PESOS': return new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
    default: return String(v);
  }
}
const SEMAFORO_TXT: Record<string, string> = { VERDE: 'Bien', AMBAR: 'Atención', ROJO: 'Riesgo', SIN_DATO: 'Sin dato' };

export async function razonesExcel(companyId: string, anio: number, mes: number): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, juego] = await Promise.all([empresaDe(companyId), juegoDe(companyId, anio, mes)]);
  const rz: any[] = juego.razones;
  const cols = ['RAZÓN', 'FÓRMULA', 'VALOR', 'REFERENCIA', 'ESTADO', 'INTERPRETACIÓN'];
  const wb = new ExcelJS.Workbook(); wb.creator = 'GDM NEXO';
  const ws = wb.addWorksheet('Razones', { views: [{ state: 'frozen', ySplit: 6 }] });
  titulo(ws, 'Razones financieras', cols.length);
  dato(ws, 3, 1, `Empresa:   ${emp.business_name}`, true);
  dato(ws, 3, 4, `RFC:   ${emp.rfc}`);
  dato(ws, 4, 1, `Del período de ${nombreMes(mes)} ${anio}`);
  dato(ws, 4, 4, `Generado:   ${fechaGen()}`);
  encabezado(ws, 6, cols.map((t) => ({ texto: t, color: C.identidad })));
  let fila = 7;
  for (const r of rz) {
    celda(ws, fila, 1, r.nombre, { negrita: true });
    celda(ws, fila, 2, r.formula);
    celda(ws, fila, 3, valorRazon(r), { centrado: true });
    celda(ws, fila, 4, r.referencia || '', { centrado: true });
    celda(ws, fila, 5, SEMAFORO_TXT[r.semaforo] || r.semaforo,
      { centrado: true, tinta: r.semaforo === 'ROJO' ? 'rojo' : r.semaforo === 'VERDE' ? 'verde' : 'base' });
    celda(ws, fila, 6, r.interpretacion);
    fila++;
  }
  anchos(ws, [26, 26, 12, 12, 12, 64]);
  return { buffer: await aBuffer(wb), nombre: `Razones_${anio}-${mm(mes)}.xlsx` };
}

export async function razonesPdf(companyId: string, anio: number, mes: number): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, juego] = await Promise.all([empresaDe(companyId), juegoDe(companyId, anio, mes)]);
  const rz: any[] = juego.razones;
  const columnas: ColumnaPdf[] = [
    { titulo: 'Razón', clave: 'nombre', ancho: 20 },
    { titulo: 'Fórmula', clave: 'formula', ancho: 22 },
    { titulo: 'Valor', clave: 'valor', ancho: 10, align: 'center' },
    { titulo: 'Ref.', clave: 'referencia', ancho: 9, align: 'center' },
    { titulo: 'Estado', clave: 'estado', ancho: 9, align: 'center' },
    { titulo: 'Interpretación', clave: 'interpretacion', ancho: 40 },
  ];
  const filas = rz.map((r) => ({
    nombre: r.nombre, formula: r.formula, valor: valorRazon(r),
    referencia: r.referencia || '', estado: SEMAFORO_TXT[r.semaforo] || r.semaforo, interpretacion: r.interpretacion,
  }));
  const buffer = await reporteTablaPdf({
    titulo: 'Razones financieras', empresa: emp.business_name, rfc: emp.rfc,
    subtitulos: [`Del período de ${nombreMes(mes)} ${anio}`], orientacion: 'landscape', columnas, filas,
  });
  return { buffer, nombre: `Razones_${anio}-${mm(mes)}.pdf` };
}
