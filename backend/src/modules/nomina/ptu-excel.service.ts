/**
 * ptu-excel.service — el reparto de PTU en el MISMO formato de la lista de raya.
 *
 * Mismos acomodos y colores que `lista-de-raya.service` (ExcelJS + `estilo-excel`):
 * encabezado de la casa, bandas de color (REPARTO / ISR / NETO), un renglón por
 * trabajador y los totales. Sólo cambian los textos y las columnas, que aquí son las
 * del reparto (días, salario, lo que toca por días y por salario, PTU, exento,
 * gravado, ISR y neto) en vez de los conceptos de una nómina ordinaria.
 */
import { query } from '../../config/database';
import { ExcelJS, C, titulo, dato, banda, encabezado, celda, totales, anchos, aBuffer } from './estilo-excel';
import { obtener } from './ptu.service';

const n2 = (v: any) => Math.round((Number(v) || 0) * 100) / 100;

export async function generarExcel(companyId: string, periodoId: string): Promise<{ buffer: Buffer; nombre: string }> {
  const d = await obtener(companyId, periodoId);
  const p = d.periodo;
  const emp = await query<any>(`SELECT business_name, rfc, registro_patronal FROM companies WHERE id=$1`, [companyId]);
  const empresa = emp.rows[0] || {};

  // Con derecho primero, luego los excluidos.
  const filas = [...d.filas].sort((a: any, b: any) => Number(b.con_derecho) - Number(a.con_derecho));

  /* Columnas (como la lista de raya, con sus saltos de línea en el encabezado). */
  const cols = [
    '#', 'NOMBRE', 'DÍAS\nTRABAJADOS', 'SALARIO\nDIARIO', 'SALARIO\nDEVENGADO',
    'PTU POR\nDÍAS (50%)', 'PTU POR\nSALARIO (50%)', 'PTU\nTOTAL', 'EXENTO', 'GRAVADO',
    'ISR\n(ISPT)', 'NETO\nA RECIBIR',
  ];
  const iPtu = 8, iIsr = 11, iNeto = 12;   // 1-based

  const wb = new ExcelJS.Workbook();
  wb.creator = 'GDM NEXO';
  const ws = wb.addWorksheet('PTU', { views: [{ state: 'frozen', ySplit: 9, xSplit: 2 }] });

  titulo(ws, 'GDM NEXO · Reparto de utilidades (PTU)', cols.length);
  dato(ws, 3, 3, empresa.business_name || '', true);
  dato(ws, 3, 7, `Fecha:   ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })}`);
  dato(ws, 4, 3, `Período:   ${p.concepto || 'PTU'} · ${diaMx(p.fecha_inicio)} al ${diaMx(p.fecha_fin)} · Año ${p.anio}`);
  dato(ws, 4, 7, `Cantidad a repartir:   ${n2(d.cantidadRepartir).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
  dato(ws, 5, 3, `RFC:   ${empresa.rfc || ''}`);
  dato(ws, 5, 7, `Exención:   15 × UMA = ${n2(d.exencion_tope).toLocaleString('es-MX', { minimumFractionDigits: 2 })}  ·  ISR del ${d.anio_pago}`);
  dato(ws, 6, 3, `Reg. Patronal:   ${empresa.registro_patronal || '(sin capturar)'}`);
  dato(ws, 6, 7, `Reparto: 50% por días trabajados + 50% por salarios devengados (Art. 123 LFT)`);

  // Bandas de color: REPARTO (percepción) / ISR / NETO.
  banda(ws, 8, 1, iPtu + 2, '◀  REPARTO  (PERCEPCIÓN 003 · PTU)  ▶', C.ingresos);
  banda(ws, 8, iIsr, iIsr, '◀  ISR  ▶', C.descuentos);
  banda(ws, 8, iNeto, iNeto, '◀  NETO  ▶', C.neto);

  encabezado(ws, 9, cols.map((texto, i) => {
    const col = i + 1;
    if (col <= 2) return { texto, color: C.identidad };
    if (col === iPtu) return { texto, color: C.totalIngresos };
    if (col === iIsr) return { texto, color: C.descuentos };
    if (col === iNeto) return { texto, color: C.neto };
    return { texto, color: C.ingresos };
  }));

  const suma: Record<string, number> = {};
  const acc = (k: string, v: any) => { suma[k] = (suma[k] || 0) + (Number(v) || 0); };

  let fila = 10;
  filas.forEach((r: any, i: number) => {
    let col = 1;
    celda(ws, fila, col++, i + 1, { tinta: 'gris', centrado: true, pesos: false });
    celda(ws, fila, col++, r.con_derecho ? r.nombre : `${r.nombre}  (sin derecho${r.menos_60 ? ', <60 días' : ''})`);
    celda(ws, fila, col++, n2(r.dias), { pesos: false, centrado: true }); acc('dias', r.dias);
    celda(ws, fila, col++, n2(r.salario_diario));
    celda(ws, fila, col++, n2(r.salario_devengado)); acc('dev', r.salario_devengado);
    celda(ws, fila, col++, r.ptu_dias ? n2(r.ptu_dias) : ''); acc('pd', r.ptu_dias);
    celda(ws, fila, col++, r.ptu_salario ? n2(r.ptu_salario) : ''); acc('ps', r.ptu_salario);
    celda(ws, fila, col++, n2(r.ptu), { negrita: true }); acc('ptu', r.ptu);
    celda(ws, fila, col++, r.exento ? n2(r.exento) : ''); acc('ex', r.exento);
    celda(ws, fila, col++, r.gravado ? n2(r.gravado) : ''); acc('gr', r.gravado);
    celda(ws, fila, col++, r.isr ? n2(r.isr) : '', { tinta: 'rojo' }); acc('isr', r.isr);
    celda(ws, fila, col++, n2(r.neto), { tinta: 'verde', negrita: true }); acc('neto', r.neto);
    fila++;
  });

  const pie: Array<{ valor: any; fondo?: string; tinta?: any; centrado?: boolean }> = [
    { valor: '' },
    { valor: `TOTALES · ${d.totales.con_derecho} con derecho`, centrado: true },
    { valor: n2(suma.dias || 0), fondo: C.totalAzul, centrado: true },
    { valor: '' },
    { valor: n2(suma.dev || 0), fondo: C.totalAzul },
    { valor: n2(suma.pd || 0), fondo: C.totalAzul },
    { valor: n2(suma.ps || 0), fondo: C.totalAzul },
    { valor: n2(suma.ptu || 0), fondo: C.totalAzul },
    { valor: n2(suma.ex || 0), fondo: C.totalAzul },
    { valor: n2(suma.gr || 0), fondo: C.totalAzul },
    { valor: n2(suma.isr || 0), fondo: C.totalRojo, tinta: 'rojo' },
    { valor: n2(suma.neto || 0), fondo: C.totalVerde, tinta: 'verde' },
  ];
  totales(ws, fila, pie);
  fila += 2;

  if (d.avisos?.length) { for (const a of d.avisos) { dato(ws, fila, 2, a); fila++; } }

  anchos(ws, [6, 34, 13, 13, 15, 15, 16, 14, 12, 12, 12, 14]);

  const buffer = await aBuffer(wb);
  return { buffer, nombre: `ptu-${p.anio}-${String(p.numero).padStart(2, '0')}.xlsx` };
}

function diaMx(f: string): string {
  const [a, m, dd] = String(f).split('-');
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${Number(dd)} ${meses[Number(m) - 1]} ${a}`;
}
