/**
 * Inventory Export Service — reportes de inventario (§12) a Excel y PDF.
 *
 *  Un REGISTRO de reportes define, para cada uno, su título, columnas
 *  (con tipo de formato) y la consulta que trae las filas. Dos generadores
 *  —toExcel (xlsx) y toPdf (pdfkit)— producen el archivo desde esa definición,
 *  así agregar un reporte nuevo es solo declarar su entrada.
 */

import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { query } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import * as companiesService from '../companies/companies.service';
import { getOptimizedLogo } from '../cfdi/logo-cache';
import { drawPageNumbers, fmtMoney, PAGE_TOP } from '../cfdi/pdf-helpers';

type ColType = 'text' | 'money' | 'qty' | 'int' | 'date' | 'pct';

interface Column {
  key: string;
  label: string;
  type?: ColType;
  width?: number;   // ancho relativo para el PDF
}

interface ReportDef {
  key: string;
  title: string;
  columns: Column[];
  needsPeriod?: boolean;
  fetch: (companyId: string, params: ExportParams) => Promise<any[]>;
}

export interface ExportParams {
  from?: string;
  to?: string;
  warehouseId?: string;
}

/* ─────────────────────  REGISTRO DE REPORTES (§12)  ───────────────────── */

const REPORTS: Record<string, ReportDef> = {
  stock: {
    key: 'stock',
    title: 'Existencias por almacén',
    columns: [
      { key: 'sku', label: 'SKU', width: 1 },
      { key: 'product_name', label: 'Producto', width: 3 },
      { key: 'warehouse_code', label: 'Almacén', width: 1 },
      { key: 'quantity', label: 'Existencia', type: 'qty', width: 1 },
      { key: 'avg_cost', label: 'Costo prom.', type: 'money', width: 1 },
      { key: 'stock_value', label: 'Valuación', type: 'money', width: 1.2 },
      { key: 'semaforo', label: 'Semáforo', width: 1 },
    ],
    fetch: async (companyId) => (await query(
      `SELECT p.sku, p.name AS product_name, w.code AS warehouse_code,
              ws.quantity, ws.avg_cost, ws.quantity * ws.avg_cost AS stock_value,
              CASE WHEN ws.quantity <= 0 THEN 'AGOTADO'
                   WHEN ws.stock_minimum > 0 AND ws.quantity <= ws.stock_minimum THEN 'CRITICO'
                   WHEN ws.stock_minimum > 0 AND ws.quantity <= ws.stock_minimum*1.2 THEN 'PREVENTIVO'
                   ELSE 'SUFICIENTE' END AS semaforo
         FROM warehouse_stock ws
         JOIN warehouses w ON w.id = ws.warehouse_id AND w.deleted_at IS NULL
         JOIN products  p ON p.id = ws.product_id   AND p.deleted_at IS NULL
        WHERE w.company_id = $1
        ORDER BY p.name, w.code`, [companyId])).rows,
  },

  'below-min': {
    key: 'below-min',
    title: 'Productos bajo mínimo',
    columns: [
      { key: 'sku', label: 'SKU', width: 1 },
      { key: 'product_name', label: 'Producto', width: 3 },
      { key: 'warehouse_code', label: 'Almacén', width: 1 },
      { key: 'quantity', label: 'Existencia', type: 'qty', width: 1 },
      { key: 'stock_minimum', label: 'Mínimo', type: 'qty', width: 1 },
      { key: 'stock_maximum', label: 'Máximo', type: 'qty', width: 1 },
      { key: 'semaforo', label: 'Semáforo', width: 1 },
    ],
    fetch: async (companyId) => (await query(
      `SELECT sku, product_name, warehouse_code, quantity, stock_minimum, stock_maximum, semaforo
         FROM v_products_below_minimum
        WHERE company_id = $1 AND semaforo IN ('AGOTADO','CRITICO','PREVENTIVO')
        ORDER BY CASE semaforo WHEN 'AGOTADO' THEN 0 WHEN 'CRITICO' THEN 1 ELSE 2 END, product_name`,
      [companyId])).rows,
  },

  projection: {
    key: 'projection',
    title: 'Proyección de faltantes a 15 días',
    columns: [
      { key: 'sku', label: 'SKU', width: 1 },
      { key: 'product_name', label: 'Producto', width: 3 },
      { key: 'warehouse_code', label: 'Almacén', width: 1 },
      { key: 'quantity', label: 'Existencia', type: 'qty', width: 1 },
      { key: 'daily_consumption', label: 'Consumo/día', type: 'qty', width: 1 },
      { key: 'days_to_minimum', label: 'Días al mín.', type: 'qty', width: 1 },
      { key: 'suggested_qty', label: 'Sugerido', type: 'qty', width: 1 },
    ],
    fetch: async (companyId) => (await query(
      `SELECT sku, product_name, warehouse_code, quantity, daily_consumption,
              days_to_minimum, suggested_qty
         FROM v_projected_stockout_15d
        WHERE company_id = $1 AND reorder_needed = true
        ORDER BY days_to_minimum NULLS FIRST, product_name`, [companyId])).rows,
  },

  rotation: {
    key: 'rotation',
    title: 'Rotación de productos',
    columns: [
      { key: 'sku', label: 'SKU', width: 1 },
      { key: 'name', label: 'Producto', width: 3 },
      { key: 'total_qty', label: 'Existencia', type: 'qty', width: 1 },
      { key: 'qty_out_30', label: 'Ventas 30d', type: 'qty', width: 1 },
      { key: 'qty_out_90', label: 'Ventas 90d', type: 'qty', width: 1 },
      { key: 'rotation_30d', label: 'Rotación', type: 'qty', width: 1 },
      { key: 'days_without_movement', label: 'Días s/mov.', type: 'int', width: 1 },
    ],
    fetch: async (companyId) => (await query(
      `SELECT sku, name, total_qty, qty_out_30, qty_out_90, rotation_30d, days_without_movement
         FROM v_inventory_rotation
        WHERE company_id = $1
        ORDER BY rotation_30d DESC NULLS LAST, qty_out_30 DESC`, [companyId])).rows,
  },

  valuation: {
    key: 'valuation',
    title: 'Valuación de inventario por almacén',
    columns: [
      { key: 'code', label: 'Almacén', width: 1 },
      { key: 'name', label: 'Nombre', width: 3 },
      { key: 'products_count', label: 'Productos', type: 'int', width: 1 },
      { key: 'total_units', label: 'Unidades', type: 'qty', width: 1 },
      { key: 'total_value', label: 'Valuación', type: 'money', width: 1.5 },
    ],
    fetch: async (companyId) => (await query(
      `SELECT w.code, w.name,
              COUNT(ws.id) FILTER (WHERE ws.quantity > 0) AS products_count,
              COALESCE(SUM(ws.quantity), 0) AS total_units,
              COALESCE(SUM(ws.quantity * ws.avg_cost), 0) AS total_value
         FROM warehouses w
         LEFT JOIN warehouse_stock ws ON ws.warehouse_id = w.id
        WHERE w.company_id = $1 AND w.deleted_at IS NULL
        GROUP BY w.code, w.name
        ORDER BY total_value DESC`, [companyId])).rows,
  },

  kardex: {
    key: 'kardex',
    title: 'Movimientos de inventario (kardex)',
    needsPeriod: true,
    columns: [
      { key: 'created_at', label: 'Fecha', type: 'date', width: 1.3 },
      { key: 'movement_type', label: 'Tipo', width: 1.3 },
      { key: 'sku', label: 'SKU', width: 1 },
      { key: 'product_name', label: 'Producto', width: 2.5 },
      { key: 'quantity', label: 'Cantidad', type: 'qty', width: 1 },
      { key: 'route', label: 'Origen→Destino', width: 1.3 },
      { key: 'reason', label: 'Motivo', width: 2.5 },
    ],
    fetch: async (companyId, p) => (await query(
      `SELECT m.created_at, m.movement_type, p.sku, p.name AS product_name, m.quantity,
              COALESCE(wf.code,'—') || '→' || COALESCE(wt.code,'—') AS route,
              m.reason
         FROM inventory_movements m
         JOIN products p ON p.id = m.product_id
         LEFT JOIN warehouses wf ON wf.id = m.warehouse_from_id
         LEFT JOIN warehouses wt ON wt.id = m.warehouse_to_id
        WHERE m.company_id = $1
          AND ($2::date IS NULL OR m.created_at >= $2::date)
          AND ($3::date IS NULL OR m.created_at < ($3::date + INTERVAL '1 day'))
        ORDER BY m.created_at DESC
        LIMIT 5000`,
      [companyId, p.from || null, p.to || null])).rows,
  },

  'count-differences': {
    key: 'count-differences',
    title: 'Diferencias de inventario físico',
    columns: [
      { key: 'folio', label: 'Conteo', type: 'int', width: 0.8 },
      { key: 'warehouse_code', label: 'Almacén', width: 1 },
      { key: 'sku', label: 'SKU', width: 1 },
      { key: 'product_name', label: 'Producto', width: 3 },
      { key: 'system_qty', label: 'Sistema', type: 'qty', width: 1 },
      { key: 'counted_qty', label: 'Contado', type: 'qty', width: 1 },
      { key: 'difference', label: 'Diferencia', type: 'qty', width: 1 },
      { key: 'value_difference', label: 'Valor dif.', type: 'money', width: 1.2 },
    ],
    fetch: async (companyId) => (await query(
      `SELECT pc.folio, w.code AS warehouse_code, p.sku, p.name AS product_name,
              i.system_qty, i.counted_qty, i.difference,
              i.difference * i.avg_cost AS value_difference
         FROM physical_count_items i
         JOIN physical_counts pc ON pc.id = i.physical_count_id
         JOIN warehouses w ON w.id = pc.warehouse_id
         JOIN products p ON p.id = i.product_id
        WHERE pc.company_id = $1 AND pc.status = 'CLOSED'
          AND i.counted_qty IS NOT NULL AND i.difference <> 0
        ORDER BY pc.folio DESC, p.name`, [companyId])).rows,
  },

  'purchase-pending': {
    key: 'purchase-pending',
    title: 'Órdenes de compra pendientes',
    columns: [
      { key: 'folio', label: 'Folio', type: 'int', width: 0.8 },
      { key: 'status', label: 'Estado', width: 1.3 },
      { key: 'warehouse_code', label: 'Almacén', width: 1 },
      { key: 'supplier_name', label: 'Proveedor', width: 2.5 },
      { key: 'items_count', label: 'Items', type: 'int', width: 0.8 },
      { key: 'estimated_total', label: 'Estimado', type: 'money', width: 1.3 },
      { key: 'needed_by_date', label: 'Necesidad', type: 'date', width: 1.2 },
    ],
    fetch: async (companyId) => (await query(
      `SELECT po.folio, po.status, w.code AS warehouse_code,
              COALESCE(s.business_name,'—') AS supplier_name,
              COUNT(poi.id) AS items_count,
              COALESCE(SUM(poi.quantity_ordered * COALESCE(poi.last_purchase_price,0)),0) AS estimated_total,
              po.needed_by_date
         FROM purchase_orders po
         JOIN warehouses w ON w.id = po.warehouse_id
         LEFT JOIN customers s ON s.id = po.supplier_id
         LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
        WHERE po.company_id = $1
          AND po.status IN ('PENDING','QUOTED','APPROVED','PURCHASED','RECEIVED_PARTIAL')
        GROUP BY po.folio, po.status, w.code, s.business_name, po.needed_by_date
        ORDER BY po.needed_by_date NULLS LAST, po.folio DESC`, [companyId])).rows,
  },

  'payments-week': {
    key: 'payments-week',
    title: 'Pagos a proveedores programados',
    columns: [
      { key: 'due_date', label: 'Vence', type: 'date', width: 1.2 },
      { key: 'supplier_name', label: 'Proveedor', width: 3 },
      { key: 'supplier_rfc', label: 'RFC', width: 1.3 },
      { key: 'amount', label: 'Monto', type: 'money', width: 1.3 },
      { key: 'bucket', label: 'Estatus', width: 1.2 },
    ],
    fetch: async (companyId) => (await query(
      `SELECT sp.due_date, c.business_name AS supplier_name, c.rfc AS supplier_rfc, sp.amount,
              CASE WHEN sp.due_date < CURRENT_DATE THEN 'VENCIDO'
                   WHEN sp.due_date <= CURRENT_DATE + 7 THEN 'ESTA SEMANA'
                   ELSE 'PROXIMO' END AS bucket
         FROM supplier_payments_schedule sp
         JOIN customers c ON c.id = sp.supplier_id
        WHERE sp.company_id = $1 AND sp.status = 'PENDING'
        ORDER BY sp.due_date`, [companyId])).rows,
  },
};

export function getReport(key: string): ReportDef {
  const r = REPORTS[key];
  if (!r) throw new ValidationError(`Reporte '${key}' no existe. Válidos: ${Object.keys(REPORTS).join(', ')}`);
  return r;
}

export function listReports() {
  return Object.values(REPORTS).map((r) => ({
    key: r.key, title: r.title, needsPeriod: !!r.needsPeriod,
  }));
}

/* ─────────────────────  FORMATO DE CELDAS  ───────────────────── */

function fmtCell(value: any, type?: ColType): string {
  if (value == null) return '';
  switch (type) {
    case 'money': return `$ ${fmtMoney(value)}`;
    case 'qty':   return Number(value).toLocaleString('es-MX', { maximumFractionDigits: 3 });
    case 'int':   return String(Math.round(Number(value)));
    case 'pct':   return `${Number(value).toFixed(1)}%`;
    case 'date':  try { return new Date(value).toLocaleDateString('es-MX'); } catch { return String(value); }
    default:      return String(value);
  }
}

/* ─────────────────────  EXCEL (xlsx / SheetJS)  ───────────────────── */

export async function toExcel(reportKey: string, companyId: string, params: ExportParams): Promise<Buffer> {
  const def = getReport(reportKey);
  const rows = await def.fetch(companyId, params);

  const aoa: any[][] = [];
  aoa.push([def.title]);
  aoa.push([`Generado: ${new Date().toLocaleString('es-MX')}${params.from ? ` · Del ${params.from} al ${params.to || 'hoy'}` : ''}`]);
  aoa.push([]);
  aoa.push(def.columns.map((c) => c.label));
  for (const row of rows) {
    aoa.push(def.columns.map((c) => {
      const v = row[c.key];
      // En Excel dejamos los números como número (sin formato de texto) para
      // que sean sumables; solo fecha/text van como string legible.
      if (v != null && (c.type === 'money' || c.type === 'qty' || c.type === 'int' || c.type === 'pct')) {
        return Number(v);
      }
      return fmtCell(v, c.type);
    }));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = def.columns.map((c) => ({ wch: Math.max(10, (c.width || 1) * 12) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, def.title.slice(0, 28));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/* ─────────────────────  PDF (pdfkit)  ───────────────────── */

export async function toPdf(reportKey: string, companyId: string, params: ExportParams): Promise<Buffer> {
  const def = getReport(reportKey);
  const [company, rows] = await Promise.all([
    companiesService.getCompanyById(companyId),
    def.fetch(companyId, params),
  ]);
  const logoBuf = await getOptimizedLogo((company as any).logo_path);

  // Horizontal (landscape) para tablas anchas
  const doc = new PDFDocument({ size: 'letter', layout: 'landscape', margin: 36, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));

  const LEFT = 36;
  const RIGHT = doc.page.width - 36;
  const BOTTOM = doc.page.height - 48;
  const totalWidth = RIGHT - LEFT;
  const wsum = def.columns.reduce((a, c) => a + (c.width || 1), 0);

  const drawHeader = () => {
    if (logoBuf) { try { doc.image(logoBuf, LEFT, PAGE_TOP, { fit: [54, 54] }); } catch {} }
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a')
      .text(def.title.toUpperCase(), LEFT + 64, PAGE_TOP);
    doc.font('Helvetica').fontSize(8).fillColor('#475569')
      .text((company.business_name || '').toUpperCase(), LEFT + 64, PAGE_TOP + 20);
    doc.text(`RFC: ${company.rfc || '—'} · Generado: ${new Date().toLocaleString('es-MX')}` +
             (params.from ? ` · Del ${params.from} al ${params.to || 'hoy'}` : ''),
             LEFT + 64, PAGE_TOP + 31);
    doc.text(`${rows.length} registro(s)`, LEFT + 64, PAGE_TOP + 42);
    doc.moveTo(LEFT, PAGE_TOP + 58).lineTo(RIGHT, PAGE_TOP + 58).strokeColor('#e2e8f0').lineWidth(1).stroke();
  };

  const drawColHeaders = (y: number) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#334155');
    let x = LEFT;
    for (const c of def.columns) {
      const w = ((c.width || 1) / wsum) * totalWidth;
      const align = (c.type && c.type !== 'text' && c.type !== 'date') ? 'right' : 'left';
      doc.text(c.label, x + 2, y, { width: w - 4, align });
      x += w;
    }
    doc.moveTo(LEFT, y + 12).lineTo(RIGHT, y + 12).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
    return y + 16;
  };

  drawHeader();
  let y = drawColHeaders(PAGE_TOP + 66);

  doc.font('Helvetica').fontSize(7.5).fillColor('#0f172a');
  let zebra = false;
  for (const row of rows) {
    if (y + 14 > BOTTOM) {
      doc.addPage();
      drawHeader();
      y = drawColHeaders(PAGE_TOP + 66);
      doc.font('Helvetica').fontSize(7.5).fillColor('#0f172a');
    }
    if (zebra) {
      doc.rect(LEFT, y - 2, totalWidth, 13).fillColor('#f8fafc').fill();
      doc.fillColor('#0f172a');
    }
    zebra = !zebra;
    let x = LEFT;
    for (const c of def.columns) {
      const w = ((c.width || 1) / wsum) * totalWidth;
      const align = (c.type && c.type !== 'text' && c.type !== 'date') ? 'right' : 'left';
      doc.text(fmtCell(row[c.key], c.type), x + 2, y, { width: w - 4, align, ellipsis: true, lineBreak: false });
      x += w;
    }
    y += 13;
  }

  if (rows.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#94a3b8')
      .text('Sin registros para este reporte.', LEFT, y + 10);
  }

  drawPageNumbers(doc);
  doc.end();
  await new Promise<void>((resolve) => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}
