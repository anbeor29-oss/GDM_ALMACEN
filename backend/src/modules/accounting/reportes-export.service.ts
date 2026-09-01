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
import { balanzaDelPeriodo, auxiliarDeCuenta, nombreMes } from './periodos.service';
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
