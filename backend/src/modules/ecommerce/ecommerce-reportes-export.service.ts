/**
 * ecommerce-reportes-export — Excel y PDF del reporte de ventas web.
 *
 * Reusa la MISMA agregación que ve la pantalla (`reporteVentas`) y las bases de la
 * casa: `nomina/estilo-excel` para el Excel (una hoja por bloque) y `utils/reporte-pdf`
 * para el PDF (una tabla con secciones y columnas genéricas Concepto/Cant./Importe).
 */
import { query } from '../../config/database';
import { reporteVentas } from './ecommerce-reportes.service';
import { ExcelJS, C, titulo, dato, encabezado, celda, totales, anchos, aBuffer } from '../nomina/estilo-excel';
import { reporteTablaPdf, ColumnaPdf } from '../../utils/reporte-pdf';
import { fechaHoraMx, fechaMx } from '../../utils/fecha-mx';

type Opts = { desde?: string; hasta?: string; storeId?: string };

async function empresaDe(companyId: string) {
  const r = await query<any>('SELECT business_name, rfc FROM companies WHERE id=$1', [companyId]);
  return { business_name: r.rows[0]?.business_name || '', rfc: r.rows[0]?.rfc || '' };
}

const MESES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
function etiquetaPeriodo(periodo: string, periodicidad: string): string {
  const p = periodo.split('-');
  return periodicidad === 'mes' ? `${MESES[Number(p[1])]} ${p[0]}` : `${p[2]}/${p[1]}/${p[0]}`;
}

/* ── Excel: una hoja por bloque ─────────────────────────────────────────────── */

export async function reporteVentasExcel(companyId: string, opts: Opts): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, d] = await Promise.all([empresaDe(companyId), reporteVentas(companyId, opts)]);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GDM NEXO';

  // Resumen (KPIs)
  const rs = wb.addWorksheet('Resumen');
  titulo(rs, 'Reporte de ventas web', 2);
  dato(rs, 3, 1, `Empresa:   ${emp.business_name}`, true);
  dato(rs, 4, 1, `RFC:   ${emp.rfc}`);
  dato(rs, 5, 1, `Periodo:   ${fechaMx(d.rango.desde)} al ${fechaMx(d.rango.hasta)}`);
  dato(rs, 6, 1, `Generado:   ${fechaHoraMx()}`);
  const kpis: Array<[string, any]> = [
    ['Ventas (confirmadas)', d.kpis.ventas],
    ['Pedidos', d.kpis.pedidos],
    ['Ticket promedio', d.kpis.ticketPromedio],
    ['Facturados', d.kpis.facturados],
    ['Pendientes de pago', d.kpis.pendientes],
    ['Monto pendiente', d.kpis.ventasPendientes],
    ['Descuentos (cupones)', d.kpis.descuentos],
    ['Envíos cobrados', d.kpis.envios],
    ['Cancelados', d.kpis.cancelados],
  ];
  encabezado(rs, 8, [{ texto: 'INDICADOR', color: C.identidad }, { texto: 'VALOR', color: C.identidad }]);
  let f = 9;
  for (const [k, v] of kpis) { celda(rs, f, 1, k, { centrado: false }); celda(rs, f, 2, v); f++; }
  anchos(rs, [28, 18]);

  // Ventas por periodo
  const sv = wb.addWorksheet('Ventas por periodo');
  encabezado(sv, 1, [
    { texto: d.periodicidad === 'mes' ? 'MES' : 'DÍA', color: C.identidad },
    { texto: 'PEDIDOS', color: C.identidad }, { texto: 'VENTAS', color: C.identidad },
  ]);
  f = 2;
  for (const s of d.serie) { celda(sv, f, 1, etiquetaPeriodo(s.periodo, d.periodicidad), { centrado: false }); celda(sv, f, 2, s.pedidos); celda(sv, f, 3, s.ventas); f++; }
  totales(sv, f, [{ valor: 'TOTAL', centrado: false }, { valor: d.kpis.pedidos }, { valor: d.kpis.ventas }]);
  anchos(sv, [16, 12, 16]);

  // Top productos
  const tp = wb.addWorksheet('Top productos');
  encabezado(tp, 1, [{ texto: 'PRODUCTO', color: C.identidad }, { texto: 'UNIDADES', color: C.identidad }, { texto: 'IMPORTE', color: C.identidad }]);
  f = 2;
  for (const p of d.topProductos) { celda(tp, f, 1, p.nombre, { centrado: false }); celda(tp, f, 2, p.unidades); celda(tp, f, 3, p.importe); f++; }
  anchos(tp, [44, 12, 16]);

  // Por tienda
  const pt = wb.addWorksheet('Por tienda');
  encabezado(pt, 1, [{ texto: 'TIENDA', color: C.identidad }, { texto: 'PEDIDOS', color: C.identidad }, { texto: 'VENTAS', color: C.identidad }]);
  f = 2;
  for (const t of d.porTienda) { celda(pt, f, 1, t.nombre, { centrado: false }); celda(pt, f, 2, t.pedidos); celda(pt, f, 3, t.ventas); f++; }
  anchos(pt, [34, 12, 16]);

  return { buffer: await aBuffer(wb), nombre: `Ventas_web_${d.rango.desde}_a_${d.rango.hasta}.xlsx` };
}

/* ── PDF: una tabla con secciones (columnas genéricas) ──────────────────────── */

const COLS_PDF: ColumnaPdf[] = [
  { titulo: 'Concepto', clave: 'concepto', ancho: 16 },
  { titulo: 'Cant.', clave: 'cant', ancho: 5, align: 'right' },
  { titulo: 'Importe', clave: 'importe', ancho: 8, pesos: true },
];
const seccion = (t: string) => ({ concepto: t, _bold: true, _fondo: '#DCE6F5' });

export async function reporteVentasPdf(companyId: string, opts: Opts): Promise<{ buffer: Buffer; nombre: string }> {
  const [emp, d] = await Promise.all([empresaDe(companyId), reporteVentas(companyId, opts)]);

  const filas: Array<Record<string, any>> = [];
  filas.push(seccion(`VENTAS POR ${d.periodicidad === 'mes' ? 'MES' : 'DÍA'}`));
  for (const s of d.serie) filas.push({ concepto: etiquetaPeriodo(s.periodo, d.periodicidad), cant: s.pedidos, importe: s.ventas });
  if (d.serie.length) filas.push({ concepto: 'Total', cant: d.kpis.pedidos, importe: d.kpis.ventas, _bold: true });
  filas.push(seccion('PRODUCTOS MÁS VENDIDOS'));
  for (const p of d.topProductos) filas.push({ concepto: p.nombre, cant: p.unidades, importe: p.importe });
  filas.push(seccion('POR TIENDA'));
  for (const t of d.porTienda) filas.push({ concepto: t.nombre, cant: t.pedidos, importe: t.ventas });

  const buffer = await reporteTablaPdf({
    titulo: 'Reporte de ventas web',
    empresa: emp.business_name,
    rfc: emp.rfc,
    rango: { desde: d.rango.desde, hasta: d.rango.hasta },
    subtitulos: [
      `Ventas: $${d.kpis.ventas.toLocaleString('es-MX', { minimumFractionDigits: 2 })}  ·  `
      + `Pedidos: ${d.kpis.pedidos}  ·  Ticket prom.: $${d.kpis.ticketPromedio.toLocaleString('es-MX', { minimumFractionDigits: 2 })}  ·  `
      + `Facturados: ${d.kpis.facturados}  ·  Pendientes: ${d.kpis.pendientes} ($${d.kpis.ventasPendientes.toLocaleString('es-MX', { minimumFractionDigits: 2 })})`,
    ],
    columnas: COLS_PDF,
    filas,
    orientacion: 'portrait',
    nota: '«Ventas» = pedidos confirmados (no pendientes de pago ni cancelados), por fecha del pedido. Importes con IVA.',
  });
  return { buffer, nombre: `Ventas_web_${d.rango.desde}_a_${d.rango.hasta}.pdf` };
}
