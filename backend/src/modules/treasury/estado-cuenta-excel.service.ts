/**
 * Estado de cuenta por EXCEL — plantilla + lector.
 *
 * A veces del banco sólo se consigue un RESUMEN (no un PDF/CSV completo). Para
 * esos casos se ofrece una plantilla de Excel con columnas fijas: el usuario
 * captura (o pega) los movimientos y la sube. Leer columnas es más confiable que
 * adivinar dónde termina una y empieza otra en un PDF pegado.
 *
 * Columnas (fila 1, encabezados):
 *   A Fecha (AAAA-MM-DD o DD/MM/AAAA) · B Concepto · C Cargo (sale) ·
 *   D Abono (entra) · E Saldo (opcional)
 * Una fila cuyo concepto sea "SALDO INICIAL" fija el saldo inicial del mes.
 */
import ExcelJS from 'exceljs';
import type { ResultadoExtraccion, MovimientoExtraido } from './extractor-movimientos.service';

const pesos = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const ROJO = 'FFB91C1C';

/** La plantilla en blanco: encabezados, un par de ejemplos y las instrucciones. */
export async function plantillaEstadoCuentaExcel(): Promise<{ buffer: Buffer; nombre: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GDM NEXO';
  const ws = wb.addWorksheet('Estado de cuenta');

  ws.columns = [
    { header: 'Fecha', key: 'fecha', width: 14 },
    { header: 'Concepto', key: 'concepto', width: 46 },
    { header: 'Cargo (sale)', key: 'cargo', width: 16 },
    { header: 'Abono (entra)', key: 'abono', width: 16 },
    { header: 'Saldo (opcional)', key: 'saldo', width: 16 },
  ];

  // Encabezado con formato.
  const enc = ws.getRow(1);
  enc.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  enc.alignment = { vertical: 'middle', horizontal: 'center' };
  enc.height = 20;
  enc.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO } }; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // Ejemplos (el usuario los borra). Se ignoran al leer (concepto empieza con "EJEMPLO").
  ws.addRow({ fecha: 'SALDO INICIAL', concepto: 'SALDO INICIAL', cargo: null, abono: null, saldo: 23500 });
  ws.addRow({ fecha: '2025-12-06', concepto: 'EJEMPLO · SPEI ENVIADO A PROVEEDOR', cargo: 3500, abono: null, saldo: 20000 });
  ws.addRow({ fecha: '2025-12-11', concepto: 'EJEMPLO · DEPOSITO RECIBIDO', cargo: null, abono: 6380, saldo: 26380 });
  for (let n = 2; n <= 4; n++) {
    ['C', 'D', 'E'].forEach((col) => { ws.getCell(`${col}${n}`).numFmt = '#,##0.00'; });
  }

  // Hoja de instrucciones aparte.
  const ins = wb.addWorksheet('Instrucciones');
  ins.getColumn(1).width = 100;
  const filas = [
    'Cómo llenar el estado de cuenta',
    '',
    '1. Un renglón por movimiento del banco, en orden de fecha.',
    '2. Fecha: AAAA-MM-DD (2025-12-06) o DD/MM/AAAA (06/12/2025).',
    '3. Cargo = lo que SALE de la cuenta (retiros, pagos, comisiones).',
    '4. Abono = lo que ENTRA (depósitos, cobros, transferencias recibidas).',
    '   Un movimiento usa Cargo O Abono, nunca los dos.',
    '5. Saldo es opcional; si lo pones, el sistema verifica que cuadre.',
    '6. La fila con concepto "SALDO INICIAL" fija el saldo con el que abre el mes',
    '   (pon el importe en la columna Saldo). Es opcional pero recomendable.',
    '7. Borra las filas de EJEMPLO antes de subir. No cambies los encabezados.',
    '8. Montos sin signo de pesos ni texto: 3500 o 3,500.00 (no "$3,500").',
  ];
  filas.forEach((t, i) => {
    const r = ins.addRow([t]);
    if (i === 0) r.font = { bold: true, size: 13, color: { argb: ROJO } };
  });

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, nombre: 'Plantilla_estado_de_cuenta.xlsx' };
}

/** Texto de una celda (maneja Date, número serial, fórmula, richText). */
function celdaTexto(v: any): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('text' in v) return String((v as any).text);
    if ('result' in v) return String((v as any).result ?? '');
    if ('richText' in v) return (v as any).richText.map((t: any) => t.text).join('');
    if ('hyperlink' in v) return String((v as any).text ?? '');
  }
  return String(v);
}

/** Un número de una celda: acepta 3500, "3,500.00", "$3,500", vacío = 0. */
function celdaNumero(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return pesos(v);
  if (typeof v === 'object' && 'result' in v) return pesos(Number((v as any).result) || 0);
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? pesos(n) : 0;
}

/** Fecha ISO a partir de Date, "AAAA-MM-DD", "DD/MM/AAAA" o serial de Excel. */
function aFechaISO(v: any, anio: number, mes: number): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // Serial de Excel (por si la celda quedó como número): días desde 1899-12-30.
  if (typeof v === 'number' && v > 59 && v < 60000) {
    return new Date(Date.UTC(1899, 11, 30 + Math.floor(v))).toISOString().slice(0, 10);
  }
  const s = celdaTexto(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (m) {
    const d = m[1].padStart(2, '0'); const mm = m[2].padStart(2, '0');
    let y = m[3]; if (y.length === 2) y = `20${y}`;
    return `${y}-${mm}-${d}`;
  }
  // Sólo día (DD): se completa con el mes/año del estado.
  m = /^(\d{1,2})$/.exec(s);
  if (m) return `${anio}-${String(mes).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/**
 * Lee la plantilla de Excel a la estructura del extractor. Mapea las columnas por
 * el NOMBRE del encabezado (tolerante a orden y sinónimos), no por posición fija.
 */
export async function movimientosDeExcel(
  buffer: Buffer, opts: { anio: number; mes: number },
): Promise<ResultadoExtraccion> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = wb.worksheets[0];
  const avisos: string[] = [];
  if (!ws) {
    return { banco: 'Excel', saldoInicial: null, saldoFinal: null, movimientos: [],
      totalRetiros: 0, totalDepositos: 0, conAdvertencia: 0, inferidos: 0, cuadra: false,
      avisos: ['El archivo no tiene ninguna hoja.'] };
  }

  // Localiza la fila de encabezados y mapea columnas por nombre.
  const col = { fecha: 0, concepto: 0, cargo: 0, abono: 0, saldo: 0 };
  let filaEnc = 0;
  for (let n = 1; n <= Math.min(ws.rowCount, 10) && !filaEnc; n++) {
    const row = ws.getRow(n);
    const nombres: Record<number, string> = {};
    row.eachCell((c, i) => { nombres[i] = celdaTexto(c.value).toLowerCase().trim(); });
    const idx = (re: RegExp) => Number(Object.keys(nombres).find((k) => re.test(nombres[Number(k)])) || 0);
    const fFecha = idx(/fecha/), fConcepto = idx(/concepto|descrip/);
    const fCargo = idx(/cargo|retiro|salida|dep[oó]sito|abono/); // sólo para confirmar que es encabezado
    if (fFecha && fConcepto && fCargo) {
      col.fecha = fFecha; col.concepto = fConcepto;
      col.cargo = idx(/cargo|retiro|salida/);
      col.abono = idx(/abono|dep[oó]sito|entrada/);
      col.saldo = idx(/saldo/);
      filaEnc = n;
    }
  }
  if (!filaEnc) {
    return { banco: 'Excel', saldoInicial: null, saldoFinal: null, movimientos: [],
      totalRetiros: 0, totalDepositos: 0, conAdvertencia: 0, inferidos: 0, cuadra: false,
      avisos: ['No se encontraron los encabezados (Fecha, Concepto, Cargo, Abono). Usa la plantilla y no cambies la fila 1.'] };
  }

  let saldoInicial: number | null = null;
  const movimientos: MovimientoExtraido[] = [];
  let orden = 0;

  for (let n = filaEnc + 1; n <= ws.rowCount; n++) {
    const row = ws.getRow(n);
    const concepto = celdaTexto(col.concepto ? row.getCell(col.concepto).value : '').trim();
    const cargo = celdaNumero(col.cargo ? row.getCell(col.cargo).value : 0);
    const abono = celdaNumero(col.abono ? row.getCell(col.abono).value : 0);
    const saldoCel = col.saldo ? row.getCell(col.saldo).value : null;
    const saldo = saldoCel === null || saldoCel === '' || saldoCel === undefined ? null : celdaNumero(saldoCel);

    // Fila de saldo inicial (fija el saldo del mes, no es movimiento).
    if (/saldo\s*inicial/i.test(concepto)) {
      if (saldo !== null) saldoInicial = saldo;
      continue;
    }
    if (/^ejemplo\b/i.test(concepto)) continue;          // filas de ejemplo de la plantilla
    if (!concepto && !cargo && !abono) continue;          // fila vacía

    const fecha = aFechaISO(col.fecha ? row.getCell(col.fecha).value : '', opts.anio, opts.mes);
    let advertencia = '';
    if (!fecha) advertencia = 'Fecha inválida o vacía.';
    if (cargo > 0 && abono > 0) advertencia = 'Trae Cargo y Abono a la vez; deja sólo uno.';
    if (!cargo && !abono) advertencia = 'Sin importe (ni cargo ni abono).';

    movimientos.push({
      fecha: fecha || `${opts.anio}-${String(opts.mes).padStart(2, '0')}-01`,
      concepto: concepto || '(sin concepto)',
      referencia: '',
      retiro: cargo, deposito: abono,
      saldo,
      saldoCalculado: 0,       // se arrastra abajo
      advertencia, inferido: false, duda: false,
      orden: orden++,
      lineaOrigen: `Excel fila ${n}`,
    });
  }

  // Arrastre del saldo y cuadre.
  let corriendo = saldoInicial ?? 0;
  for (const m of movimientos) { corriendo = pesos(corriendo + m.deposito - m.retiro); m.saldoCalculado = corriendo; }
  const totalRetiros = pesos(movimientos.reduce((a, m) => a + m.retiro, 0));
  const totalDepositos = pesos(movimientos.reduce((a, m) => a + m.deposito, 0));
  const saldoFinal = movimientos.length
    ? (movimientos[movimientos.length - 1].saldo ?? corriendo) : saldoInicial;
  const finalCalculado = pesos((saldoInicial ?? 0) - totalRetiros + totalDepositos);
  const cuadra = saldoFinal !== null && Math.abs(saldoFinal - finalCalculado) <= 0.02;

  if (!movimientos.length) avisos.push('No se leyó ningún movimiento. Revisa que las filas estén bajo los encabezados.');
  if (saldoInicial === null) avisos.push('Sin "SALDO INICIAL": no se puede verificar que el mes cuadre ni enlazar con el anterior.');
  if (saldoFinal !== null && saldoInicial !== null && !cuadra) {
    avisos.push(`No cuadra: con el saldo inicial y los movimientos da ${finalCalculado.toFixed(2)}, ` +
      `pero el último saldo es ${saldoFinal.toFixed(2)}.`);
  }
  const conAdvertencia = movimientos.filter((m) => m.advertencia).length;

  return {
    banco: 'Excel', saldoInicial, saldoFinal, movimientos,
    totalRetiros, totalDepositos, conAdvertencia, inferidos: 0, cuadra, avisos,
    esTarjeta: false,
  };
}

export default { plantillaEstadoCuentaExcel, movimientosDeExcel };
