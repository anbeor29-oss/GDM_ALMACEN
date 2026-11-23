/**
 * historial-facturas.service — HISTORIAL COMPLETO de facturas EMITIDAS (timbradas),
 * por cliente y por fecha, con su estado de pago: PAGADA (verde) / PENDIENTE (rojo) /
 * CANCELADA (gris). Alimenta la pestaña «Historial de facturas» de Cobranza detallada
 * y su Excel (pestaña verde). Incluye un PRONÓSTICO de cobranza por antigüedad del
 * saldo pendiente (0-30 / 31-60 / 61-90 / +90 días).
 *
 * El saldo sale como en el listado de facturas: total − pagos (no cancelados) − notas
 * de crédito (no canceladas). Ver [[pue-ppd-cobranza-regla]]: una PUE ya está pagada.
 */
import { query } from '../../config/database';
import { C, titulo, dato, encabezado, celda, totales, anchos, aBuffer, ExcelJS } from '../nomina/estilo-excel';

export interface FilaHistorial {
  fecha: string; cliente: string; rfc: string; serie: string; folio: number;
  total: number; pagado: number; saldo: number; moneda: string;
  estado: 'PAGADA' | 'PENDIENTE' | 'CANCELADA'; uuid: string | null; dias: number;
}
export interface Pronostico { rango: string; monto: number; facturas: number; }

const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

export async function historialFacturas(
  companyId: string, filtros: { desde?: string; hasta?: string; customerId?: string } = {}
): Promise<{ filas: FilaHistorial[]; totales: any; pronostico: Pronostico[] }> {
  const params: any[] = [companyId];
  const conds: string[] = ['i.company_id = $1', 'i.deleted_at IS NULL', 'i.is_stamped = TRUE'];
  if (filtros.desde) { params.push(filtros.desde); conds.push(`i.date_issued >= $${params.length}`); }
  if (filtros.hasta) { params.push(filtros.hasta); conds.push(`i.date_issued <= $${params.length}`); }
  if (filtros.customerId) { params.push(filtros.customerId); conds.push(`i.customer_id = $${params.length}`); }

  const SUB_PAGOS = `COALESCE((SELECT SUM(payment_amount) FROM payments WHERE invoice_id=i.id AND deleted_at IS NULL AND document_status <> 'CANCELLED'),0)`;
  const SUB_NC = `COALESCE((SELECT SUM(total) FROM credit_notes WHERE invoice_id=i.id AND deleted_at IS NULL AND status <> 'CANCELLED'),0)`;

  const r = await query<any>(
    `SELECT TO_CHAR(i.date_issued,'YYYY-MM-DD') AS fecha,
            c.business_name AS cliente, c.rfc AS rfc,
            COALESCE(i.serie,'FAC') AS serie, i.folio, i.total::numeric AS total,
            COALESCE(i.currency,'MXN') AS moneda, i.status AS status, i.cfdi_uuid AS uuid,
            COALESCE(i.payment_method,'') AS metodo,
            ${SUB_PAGOS}::numeric AS pagado,
            GREATEST(0, i.total - ${SUB_PAGOS} - ${SUB_NC})::numeric AS saldo,
            GREATEST(0, (CURRENT_DATE - i.date_issued::date))::int AS dias
       FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE ${conds.join(' AND ')}
      ORDER BY c.business_name, i.date_issued, i.folio`, params);

  const filas: FilaHistorial[] = r.rows.map((x: any) => {
    const total = r2(x.total);
    const cancelada = String(x.status) === 'CANCELLED';
    // REGLA PUE/PPD (ver [[pue-ppd-cobranza-regla]]): una PUE (Pago en Una Exhibición)
    // está PAGADA desde que se timbra —no lleva complemento de pago—, así que NUNCA es
    // cuenta por cobrar. Sólo la PPD (Parcialidades/Diferido) tiene saldo real
    // (total − pagos − NC). Sin esto, las PUE salían «pendientes» e inflaban la cobranza.
    const esPue = String(x.metodo || '').toUpperCase().startsWith('PUE');
    let estado: FilaHistorial['estado'];
    let pagado: number;
    let saldo: number;
    if (cancelada) { estado = 'CANCELADA'; pagado = 0; saldo = 0; }
    else if (esPue) { estado = 'PAGADA'; pagado = total; saldo = 0; }
    else { saldo = r2(x.saldo); pagado = r2(x.pagado); estado = saldo <= 0.01 ? 'PAGADA' : 'PENDIENTE'; }
    return {
      fecha: x.fecha, cliente: x.cliente, rfc: x.rfc, serie: x.serie, folio: Number(x.folio),
      total, pagado, saldo, moneda: x.moneda,
      estado, uuid: x.uuid || null, dias: Number(x.dias) || 0,
    };
  });

  const vivas = filas.filter((f) => f.estado !== 'CANCELADA');
  const pendientes = filas.filter((f) => f.estado === 'PENDIENTE');
  const tot = {
    facturas: vivas.length,
    pagadas: filas.filter((f) => f.estado === 'PAGADA').length,
    pendientes: pendientes.length,
    canceladas: filas.filter((f) => f.estado === 'CANCELADA').length,
    totalFacturado: r2(vivas.reduce((a, f) => a + f.total, 0)),
    totalPagado: r2(vivas.reduce((a, f) => a + f.pagado, 0)),
    totalPendiente: r2(pendientes.reduce((a, f) => a + f.saldo, 0)),
  };

  // Pronóstico de cobranza por ANTIGÜEDAD del saldo pendiente.
  const buckets: Array<{ rango: string; test: (d: number) => boolean }> = [
    { rango: 'Por vencer / 0-30 días', test: (d) => d <= 30 },
    { rango: '31-60 días', test: (d) => d > 30 && d <= 60 },
    { rango: '61-90 días', test: (d) => d > 60 && d <= 90 },
    { rango: 'Más de 90 días', test: (d) => d > 90 },
  ];
  const pronostico: Pronostico[] = buckets.map((b) => {
    const subset = pendientes.filter((f) => b.test(f.dias));
    return { rango: b.rango, monto: r2(subset.reduce((a, f) => a + f.saldo, 0)), facturas: subset.length };
  });

  return { filas, totales: tot, pronostico };
}

/** El mismo historial en EXCEL (pestaña VERDE), con el encabezado de la casa. */
export async function historialFacturasExcel(
  companyId: string, filtros: { desde?: string; hasta?: string; customerId?: string } = {}
): Promise<{ buffer: Buffer; nombre: string }> {
  const { filas, totales: tot, pronostico } = await historialFacturas(companyId, filtros);
  const emp = await query<any>(`SELECT business_name, rfc FROM companies WHERE id=$1`, [companyId]);
  const empresa = emp.rows[0]?.business_name || '';
  const rfc = emp.rows[0]?.rfc || '';

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Historial de facturas', { properties: { tabColor: { argb: C.neto } } }); // pestaña VERDE
  anchos(ws, [13, 34, 15, 10, 15, 15, 15, 14]);

  titulo(ws, 'Historial de facturas emitidas', 8);
  dato(ws, 3, 1, `Empresa: ${empresa}`, true);
  dato(ws, 3, 5, `RFC: ${rfc}`);
  const periodo = (filtros.desde || filtros.hasta) ? `${filtros.desde || '…'} a ${filtros.hasta || '…'}` : 'Todo el historial';
  dato(ws, 4, 1, `Periodo: ${periodo}`);
  dato(ws, 4, 5, `Generado: ${new Date().toLocaleString('es-MX')}`);

  const F = 6;
  encabezado(ws, F, [
    { texto: 'Fecha', color: C.identidad }, { texto: 'Cliente', color: C.identidad }, { texto: 'RFC', color: C.identidad },
    { texto: 'Folio', color: C.identidad }, { texto: 'Total', color: C.totalIngresos }, { texto: 'Pagado', color: C.neto },
    { texto: 'Saldo', color: C.totalDescuentos }, { texto: 'Estado', color: C.identidad },
  ]);

  let fila = F + 1;
  for (const f of filas) {
    const tinta = f.estado === 'PAGADA' ? 'verde' : f.estado === 'PENDIENTE' ? 'rojo' : 'gris';
    celda(ws, fila, 1, f.fecha, { centrado: true });
    celda(ws, fila, 2, f.cliente);
    celda(ws, fila, 3, f.rfc, { tinta: 'gris' });
    celda(ws, fila, 4, `${f.serie}-${String(f.folio).padStart(6, '0')}`, { centrado: true, tinta: 'gris' });
    celda(ws, fila, 5, f.total, { pesos: true });
    celda(ws, fila, 6, f.pagado, { pesos: true, tinta: 'verde' });
    celda(ws, fila, 7, f.saldo, { pesos: true, tinta: f.saldo > 0 ? 'rojo' : 'gris' });
    celda(ws, fila, 8, f.estado === 'PAGADA' ? '● Pagada' : f.estado === 'PENDIENTE' ? '● Pendiente' : '● Cancelada', { centrado: true, tinta });
    fila++;
  }

  totales(ws, fila, [
    { valor: 'TOTALES', centrado: false }, { valor: '' }, { valor: '' },
    { valor: `${tot.facturas} fac.`, centrado: true },
    { valor: tot.totalFacturado, fondo: C.totalAzul },
    { valor: tot.totalPagado, fondo: C.totalVerde, tinta: 'verde' },
    { valor: tot.totalPendiente, fondo: C.totalRojo, tinta: 'rojo' },
    { valor: `${tot.pagadas}✓ / ${tot.pendientes}✗`, centrado: true },
  ]);

  // Bloque de PRONÓSTICO por antigüedad.
  fila += 3;
  ws.getCell(fila, 1).value = 'Pronóstico de cobranza (por antigüedad del saldo)';
  ws.getCell(fila, 1).font = { bold: true, color: { argb: C.neto }, size: 12 };
  fila++;
  encabezado(ws, fila, [{ texto: 'Rango', color: C.identidad }, { texto: 'Facturas', color: C.identidad }, { texto: 'Saldo esperado', color: C.totalDescuentos }]);
  fila++;
  for (const p of pronostico) {
    celda(ws, fila, 1, p.rango);
    celda(ws, fila, 2, p.facturas, { centrado: true, pesos: false });
    celda(ws, fila, 3, p.monto, { pesos: true, tinta: 'rojo' });
    fila++;
  }
  celda(ws, fila, 1, 'Total por cobrar', { negrita: true });
  celda(ws, fila, 3, tot.totalPendiente, { pesos: true, negrita: true, tinta: 'rojo', fondo: C.totalRojo });

  const nombre = `Historial_facturas_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return { buffer: await aBuffer(wb), nombre };
}
