/**
 * PDFs de ventas y cobranza — se sirven inline para verse en el navegador.
 *
 *   1) generateSalesSummaryPDF   → resumen por mes y año: venta, cobrada,
 *      no cobrada y adeudo acumulado.
 *   2) generateUnpaidInvoicesPDF → TODAS las facturas no pagadas en una lista
 *      plana cronológica, sin agrupar por cliente ni filtrar por antigüedad.
 *
 * Mismo patrón que receivables-pdf.service.ts: helpers de pdfkit del módulo
 * cfdi, header repetido por página y paginación X/Y con bufferPages.
 */

import PDFDocument from 'pdfkit';
import * as companiesService from '../companies/companies.service';
import { getOptimizedLogo } from '../cfdi/logo-cache';
import { drawPageNumbers, fmtMoney, PAGE_LEFT, PAGE_RIGHT, PAGE_TOP } from '../cfdi/pdf-helpers';
import * as reportsService from './reports.service';

const BOTTOM_MARGIN = 60; // reservado para la paginación

function fmtDate(d: any): string {
  // DD/MM/AAAA con ceros (estándar de fecha de NEXO en todos los reportes).
  try { return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch { return ''; }
}

/** Caja de total en el header. Devuelve el ancho usado. */
function totalBox(
  doc: any, x: number, label: string, value: string, color: string, sub?: string
) {
  const W = 128;
  doc.roundedRect(x, PAGE_TOP, W, 52, 6).fillAndStroke('#f8fafc', '#cbd5e1');
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#64748b').text(label, x + 8, PAGE_TOP + 7, { width: W - 16 });
  doc.font('Helvetica-Bold').fontSize(13).fillColor(color).text(value, x + 8, PAGE_TOP + 20, { width: W - 16 });
  if (sub) {
    doc.font('Helvetica').fontSize(7).fillColor('#64748b').text(sub, x + 8, PAGE_TOP + 39, { width: W - 16 });
  }
  return W;
}

/* ───────────────────── 1) Resumen por mes y año ───────────────────── */

export async function generateSalesSummaryPDF(companyId: string): Promise<Buffer> {
  const [company, report] = await Promise.all([
    companiesService.getCompanyById(companyId),
    reportsService.getSalesSummaryReport(companyId),
  ]);
  const logoBuf = await getOptimizedLogo((company as any).logo_path);

  const doc = new PDFDocument({ size: 'letter', margin: 40, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));

  const HEADER_BOTTOM = PAGE_TOP + 62;
  const BODY_TOP = HEADER_BOTTOM + 14;

  // Columnas: Fecha | Facturas | Venta | Cobrada | No cobrada | Adeudo total
  const C = {
    fecha: PAGE_LEFT + 2,
    facturas: PAGE_LEFT + 108,
    venta: PAGE_LEFT + 150,
    cobrada: PAGE_LEFT + 235,
    noCobrada: PAGE_LEFT + 320,
    adeudo: PAGE_LEFT + 410,
  };
  const NUM_W = 80;

  const drawHeader = () => {
    if (logoBuf) {
      try { doc.image(logoBuf, PAGE_LEFT, PAGE_TOP, { fit: [56, 56] }); } catch { /* logo opcional */ }
    }
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a')
      .text('RESUMEN DE VENTAS Y COBRANZA', PAGE_LEFT + 66, PAGE_TOP);
    doc.font('Helvetica').fontSize(8).fillColor('#475569')
      .text((company.business_name || '').toUpperCase(), PAGE_LEFT + 66, PAGE_TOP + 19);
    doc.text(`RFC: ${company.rfc || '—'}`, PAGE_LEFT + 66, PAGE_TOP + 30);
    doc.text(`Impreso el: ${new Date().toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      PAGE_LEFT + 66, PAGE_TOP + 41);

    let x = PAGE_RIGHT - 128 * 2 - 8;
    x += totalBox(doc, x, 'VENTAS TOTALES', `$ ${fmtMoney(report.totals.sales)}`, '#0f172a',
      `${report.totals.invoice_count} factura(s)`) + 8;
    totalBox(doc, x, 'POR COBRAR', `$ ${fmtMoney(report.totals.unpaid)}`, '#dc2626',
      `Cobrado: $ ${fmtMoney(report.totals.paid)}`);

    doc.moveTo(PAGE_LEFT, HEADER_BOTTOM).lineTo(PAGE_RIGHT, HEADER_BOTTOM)
      .strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.fillColor('#000000');
  };

  const drawTableHead = (y: number) => {
    doc.rect(PAGE_LEFT, y - 3, PAGE_RIGHT - PAGE_LEFT, 16).fill('#1e3a8a');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
    doc.text('FECHA', C.fecha + 4, y + 1);
    doc.text('FACT.', C.facturas, y + 1, { width: 34, align: 'right' });
    doc.text('VENTA', C.venta, y + 1, { width: NUM_W, align: 'right' });
    doc.text('COBRADA', C.cobrada, y + 1, { width: NUM_W, align: 'right' });
    doc.text('NO COBRADA', C.noCobrada, y + 1, { width: NUM_W, align: 'right' });
    doc.text('ADEUDO TOTAL', C.adeudo, y + 1, { width: NUM_W + 25, align: 'right' });
    doc.fillColor('#000000');
    return y + 20;
  };

  drawHeader();
  let y = drawTableHead(BODY_TOP);

  const ensureRoom = (needed: number) => {
    if (y + needed > doc.page.height - BOTTOM_MARGIN) {
      doc.addPage();
      drawHeader();
      y = drawTableHead(BODY_TOP);
    }
  };

  if (report.months.length === 0) {
    doc.font('Helvetica').fontSize(11).fillColor('#475569')
      .text('Todavía no hay facturas timbradas que resumir.', PAGE_LEFT, y + 6);
  }

  let currentYear: number | null = null;
  for (const m of report.months) {
    // Al cambiar de año, cerramos el anterior con su subtotal.
    if (currentYear !== null && m.year !== currentYear) {
      const yr = report.years.find((y2) => y2.year === currentYear);
      if (yr) {
        ensureRoom(20);
        doc.rect(PAGE_LEFT, y - 2, PAGE_RIGHT - PAGE_LEFT, 15).fill('#e2e8f0');
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a');
        doc.text(`TOTAL ${yr.year}`, C.fecha + 4, y + 2);
        doc.text(String(yr.invoice_count), C.facturas, y + 2, { width: 34, align: 'right' });
        doc.text(`$ ${fmtMoney(yr.sales)}`, C.venta, y + 2, { width: NUM_W, align: 'right' });
        doc.text(`$ ${fmtMoney(yr.paid)}`, C.cobrada, y + 2, { width: NUM_W, align: 'right' });
        doc.text(`$ ${fmtMoney(yr.unpaid)}`, C.noCobrada, y + 2, { width: NUM_W, align: 'right' });
        doc.fillColor('#000000');
        y += 20;
      }
    }
    currentYear = m.year;

    ensureRoom(16);
    doc.font('Helvetica').fontSize(8).fillColor('#0f172a');
    doc.text(m.label, C.fecha + 4, y);
    doc.fillColor('#64748b').text(String(m.invoice_count), C.facturas, y, { width: 34, align: 'right' });
    doc.fillColor('#0f172a').text(`$ ${fmtMoney(m.sales)}`, C.venta, y, { width: NUM_W, align: 'right' });
    doc.fillColor('#16a34a').text(`$ ${fmtMoney(m.paid)}`, C.cobrada, y, { width: NUM_W, align: 'right' });
    doc.fillColor(m.unpaid > 0 ? '#dc2626' : '#64748b')
      .text(`$ ${fmtMoney(m.unpaid)}`, C.noCobrada, y, { width: NUM_W, align: 'right' });
    doc.font('Helvetica-Bold').fillColor('#b45309')
      .text(`$ ${fmtMoney(m.cumulative_debt)}`, C.adeudo, y, { width: NUM_W + 25, align: 'right' });
    y += 14;
    doc.moveTo(PAGE_LEFT, y - 2).lineTo(PAGE_RIGHT, y - 2).strokeColor('#f1f5f9').lineWidth(0.5).stroke();
  }

  // Subtotal del último año.
  if (currentYear !== null) {
    const yr = report.years.find((y2) => y2.year === currentYear);
    if (yr) {
      ensureRoom(20);
      doc.rect(PAGE_LEFT, y - 2, PAGE_RIGHT - PAGE_LEFT, 15).fill('#e2e8f0');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a');
      doc.text(`TOTAL ${yr.year}`, C.fecha + 4, y + 2);
      doc.text(String(yr.invoice_count), C.facturas, y + 2, { width: 34, align: 'right' });
      doc.text(`$ ${fmtMoney(yr.sales)}`, C.venta, y + 2, { width: NUM_W, align: 'right' });
      doc.text(`$ ${fmtMoney(yr.paid)}`, C.cobrada, y + 2, { width: NUM_W, align: 'right' });
      doc.text(`$ ${fmtMoney(yr.unpaid)}`, C.noCobrada, y + 2, { width: NUM_W, align: 'right' });
      doc.fillColor('#000000');
      y += 20;
    }
  }

  // Gran total.
  if (report.months.length > 0) {
    ensureRoom(24);
    doc.rect(PAGE_LEFT, y, PAGE_RIGHT - PAGE_LEFT, 18).fill('#1e3a8a');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
    doc.text('TOTAL GENERAL', C.fecha + 4, y + 5);
    doc.text(String(report.totals.invoice_count), C.facturas, y + 5, { width: 34, align: 'right' });
    doc.text(`$ ${fmtMoney(report.totals.sales)}`, C.venta, y + 5, { width: NUM_W, align: 'right' });
    doc.text(`$ ${fmtMoney(report.totals.paid)}`, C.cobrada, y + 5, { width: NUM_W, align: 'right' });
    doc.text(`$ ${fmtMoney(report.totals.unpaid)}`, C.noCobrada, y + 5, { width: NUM_W, align: 'right' });
    doc.text(`$ ${fmtMoney(report.totals.unpaid)}`, C.adeudo, y + 5, { width: NUM_W + 25, align: 'right' });
    doc.fillColor('#000000');
    y += 26;

    doc.font('Helvetica').fontSize(7).fillColor('#94a3b8')
      .text('"Cobrada" incluye pagos timbrados y notas de crédito aplicadas, de modo que Venta = Cobrada + No cobrada. ' +
        '"Adeudo total" es la suma acumulada de lo no cobrado hasta ese mes.',
        PAGE_LEFT, y, { width: PAGE_RIGHT - PAGE_LEFT });
  }

  drawPageNumbers(doc);
  doc.end();
  return new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
}

/* ───────────────────── 2) Facturas no pagadas ───────────────────── */

export async function generateUnpaidInvoicesPDF(companyId: string): Promise<Buffer> {
  const [company, report] = await Promise.all([
    companiesService.getCompanyById(companyId),
    reportsService.getUnpaidInvoicesReport(companyId),
  ]);
  const logoBuf = await getOptimizedLogo((company as any).logo_path);

  const doc = new PDFDocument({ size: 'letter', margin: 40, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));

  const HEADER_BOTTOM = PAGE_TOP + 62;
  const BODY_TOP = HEADER_BOTTOM + 14;

  const C = {
    fecha: PAGE_LEFT + 2,
    dias: PAGE_LEFT + 56,
    folio: PAGE_LEFT + 92,
    cliente: PAGE_LEFT + 152,
    total: PAGE_LEFT + 315,
    abonado: PAGE_LEFT + 388,
    saldo: PAGE_LEFT + 448,
  };

  const drawHeader = () => {
    if (logoBuf) {
      try { doc.image(logoBuf, PAGE_LEFT, PAGE_TOP, { fit: [56, 56] }); } catch { /* logo opcional */ }
    }
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a')
      .text('FACTURAS NO PAGADAS', PAGE_LEFT + 66, PAGE_TOP);
    doc.font('Helvetica').fontSize(8).fillColor('#475569')
      .text((company.business_name || '').toUpperCase(), PAGE_LEFT + 66, PAGE_TOP + 19);
    doc.text(`RFC: ${company.rfc || '—'}`, PAGE_LEFT + 66, PAGE_TOP + 30);
    doc.text(`Impreso el: ${new Date().toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      PAGE_LEFT + 66, PAGE_TOP + 41);
    doc.fontSize(7).fillColor('#94a3b8')
      .text('Todas las facturas con saldo, sin importar la antigüedad.', PAGE_LEFT + 66, PAGE_TOP + 52);

    totalBox(doc, PAGE_RIGHT - 128, 'SALDO POR COBRAR', `$ ${fmtMoney(report.totals.balance)}`, '#dc2626',
      `${report.totals.invoice_count} factura(s)`);

    doc.moveTo(PAGE_LEFT, HEADER_BOTTOM).lineTo(PAGE_RIGHT, HEADER_BOTTOM)
      .strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.fillColor('#000000');
  };

  const drawTableHead = (y: number) => {
    doc.rect(PAGE_LEFT, y - 3, PAGE_RIGHT - PAGE_LEFT, 16).fill('#1e3a8a');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
    doc.text('FECHA', C.fecha + 4, y + 1);
    doc.text('DÍAS', C.dias, y + 1, { width: 28, align: 'right' });
    doc.text('FACTURA', C.folio + 4, y + 1);
    doc.text('CLIENTE', C.cliente + 4, y + 1);
    doc.text('IMPORTE', C.total, y + 1, { width: 66, align: 'right' });
    doc.text('PAGADO', C.abonado, y + 1, { width: 54, align: 'right' });
    doc.text('SALDO', C.saldo, y + 1, { width: 66, align: 'right' });
    doc.fillColor('#000000');
    return y + 20;
  };

  drawHeader();
  let y = drawTableHead(BODY_TOP);

  const ensureRoom = (needed: number) => {
    if (y + needed > doc.page.height - BOTTOM_MARGIN) {
      doc.addPage();
      drawHeader();
      y = drawTableHead(BODY_TOP);
    }
  };

  if (report.rows.length === 0) {
    doc.font('Helvetica').fontSize(11).fillColor('#16a34a')
      .text('Sin facturas pendientes: toda la cartera está cobrada.', PAGE_LEFT, y + 6);
  }

  for (const r of report.rows) {
    ensureRoom(16);
    doc.font('Helvetica').fontSize(7.5).fillColor('#0f172a');
    doc.text(fmtDate(r.date_issued), C.fecha + 4, y);
    // La antigüedad se colorea sola: a más días, más urgente.
    doc.fillColor(r.days > 90 ? '#dc2626' : r.days > 30 ? '#d97706' : '#64748b')
      .text(String(r.days), C.dias, y, { width: 28, align: 'right' });
    doc.fillColor('#0f172a').text(r.invoice, C.folio + 4, y, { width: 56 });
    doc.text((r.customer || '').slice(0, 42), C.cliente + 4, y, { width: 158 });
    doc.text(`$ ${fmtMoney(r.total)}`, C.total, y, { width: 66, align: 'right' });
    doc.fillColor('#16a34a').text(`$ ${fmtMoney(r.paid)}`, C.abonado, y, { width: 54, align: 'right' });
    doc.font('Helvetica-Bold').fillColor('#dc2626')
      .text(`$ ${fmtMoney(r.balance)}`, C.saldo, y, { width: 66, align: 'right' });
    y += 14;
    doc.moveTo(PAGE_LEFT, y - 2).lineTo(PAGE_RIGHT, y - 2).strokeColor('#f1f5f9').lineWidth(0.5).stroke();
  }

  if (report.rows.length > 0) {
    ensureRoom(24);
    doc.rect(PAGE_LEFT, y, PAGE_RIGHT - PAGE_LEFT, 18).fill('#1e3a8a');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
    doc.text(`TOTAL — ${report.totals.invoice_count} factura(s)`, C.fecha + 4, y + 5);
    doc.text(`$ ${fmtMoney(report.totals.total)}`, C.total, y + 5, { width: 66, align: 'right' });
    doc.text(`$ ${fmtMoney(report.totals.paid)}`, C.abonado, y + 5, { width: 54, align: 'right' });
    doc.text(`$ ${fmtMoney(report.totals.balance)}`, C.saldo, y + 5, { width: 66, align: 'right' });
    doc.fillColor('#000000');
    y += 26;

    doc.font('Helvetica').fontSize(7).fillColor('#94a3b8')
      .text('"Pagado" incluye pagos timbrados y notas de crédito aplicadas. "Días" es la antigüedad desde la emisión: ' +
        'ámbar a más de 30, rojo a más de 90.',
        PAGE_LEFT, y, { width: PAGE_RIGHT - PAGE_LEFT });
  }

  drawPageNumbers(doc);
  doc.end();
  return new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
}

export default { generateSalesSummaryPDF, generateUnpaidInvoicesPDF };
