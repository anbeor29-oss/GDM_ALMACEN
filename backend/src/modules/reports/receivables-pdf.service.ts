/**
 * PDF de Reporte de Cobranza — facturas con saldo > 0.20 por cliente,
 * con desglose de abonos (pagos) y notas de crédito.
 *
 *  · Reutiliza los helpers de PDFs del módulo cfdi (fmtMoney, drawPageNumbers).
 *  · Multi-página automático: cuando la Y baja del margen inferior, agregamos
 *    página nueva y repetimos el encabezado de la tabla.
 *  · Numeración "Página X/Y" en esquina inferior izquierda (bufferPages).
 */

import PDFDocument from 'pdfkit';
import * as companiesService from '../companies/companies.service';
import { getOptimizedLogo } from '../cfdi/logo-cache';
import { drawPageNumbers, fmtMoney, PAGE_LEFT, PAGE_RIGHT, PAGE_TOP } from '../cfdi/pdf-helpers';
import * as reportsService from './reports.service';
import logger from '../../middleware/logger';

const BOTTOM_MARGIN = 60; // reservado para paginación

function fmtDate(d: any): string {
  try { return new Date(d).toLocaleDateString('es-MX'); } catch { return ''; }
}

export async function generateReceivablesReportPDF(
  companyId: string,
  customerId?: string
): Promise<Buffer> {
  const [company, report] = await Promise.all([
    companiesService.getCompanyById(companyId),
    reportsService.getReceivablesReport(companyId, customerId),
  ]);
  const logoBuf = await getOptimizedLogo((company as any).logo_path);

  const doc = new PDFDocument({ size: 'letter', margin: 40, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));

  const drawHeader = () => {
    if (logoBuf) {
      try { doc.image(logoBuf, PAGE_LEFT, PAGE_TOP, { fit: [70, 70] }); } catch {}
    }
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a')
      .text('REPORTE DE COBRANZA', PAGE_LEFT + 82, PAGE_TOP);
    doc.font('Helvetica').fontSize(9).fillColor('#475569')
      .text((company.business_name || '').toUpperCase(), PAGE_LEFT + 82, PAGE_TOP + 22);
    doc.text(`RFC: ${company.rfc || '—'}`, PAGE_LEFT + 82, PAGE_TOP + 34);
    doc.text(`Fecha: ${new Date().toLocaleString('es-MX')}`, PAGE_LEFT + 82, PAGE_TOP + 46);
    doc.text(`Umbral saldo: > $${fmtMoney(report.threshold)}`, PAGE_LEFT + 82, PAGE_TOP + 58);

    // Totales generales
    const tX = PAGE_RIGHT - 200;
    doc.roundedRect(tX, PAGE_TOP, 200, 74, 6).fillAndStroke('#f1f5f9', '#cbd5e1');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b').text('TOTAL POR COBRAR', tX + 10, PAGE_TOP + 8);
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#dc2626')
      .text(`$ ${fmtMoney(report.totals.balance)}`, tX + 10, PAGE_TOP + 20);
    doc.font('Helvetica').fontSize(8).fillColor('#475569')
      .text(`${report.totals.invoice_count} factura(s) · ${report.customers.length} cliente(s)`, tX + 10, PAGE_TOP + 44);
    doc.text(`Facturado: $ ${fmtMoney(report.totals.invoiced)}`, tX + 10, PAGE_TOP + 56);

    doc.moveTo(PAGE_LEFT, PAGE_TOP + 88).lineTo(PAGE_RIGHT, PAGE_TOP + 88)
      .strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.fillColor('#000000');
  };

  drawHeader();
  let y = PAGE_TOP + 100;

  const ensureRoom = (needed: number) => {
    if (y + needed > doc.page.height - BOTTOM_MARGIN) {
      doc.addPage();
      drawHeader();
      y = PAGE_TOP + 100;
    }
  };

  if (report.customers.length === 0) {
    doc.font('Helvetica').fontSize(11).fillColor('#475569')
      .text(customerId
        ? 'Este cliente no tiene facturas con saldo mayor a $0.20.'
        : 'No hay facturas con saldo pendiente mayor a $0.20.',
        PAGE_LEFT, y);
  }

  for (const cust of report.customers) {
    ensureRoom(60);
    // Encabezado por cliente
    doc.roundedRect(PAGE_LEFT, y, PAGE_RIGHT - PAGE_LEFT, 32, 4)
      .fillAndStroke('#eff6ff', '#bfdbfe');
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1e3a8a')
      .text((cust.business_name || '').toUpperCase(), PAGE_LEFT + 8, y + 5);
    doc.font('Helvetica').fontSize(8).fillColor('#334155')
      .text(`RFC: ${cust.rfc || '—'} · ${cust.invoice_count} factura(s)`,
        PAGE_LEFT + 8, y + 19);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#dc2626')
      .text(`$ ${fmtMoney(cust.balance)}`, PAGE_RIGHT - 130, y + 10,
        { width: 120, align: 'right' });
    y += 40;

    // Header de la tabla de facturas del cliente
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b');
    doc.text('FOLIO',       PAGE_LEFT + 4,  y);
    doc.text('FECHA',       PAGE_LEFT + 90, y);
    doc.text('TOTAL',       PAGE_LEFT + 165, y, { width: 70, align: 'right' });
    doc.text('ABONADO',     PAGE_LEFT + 240, y, { width: 70, align: 'right' });
    doc.text('NOTAS CR.',   PAGE_LEFT + 315, y, { width: 70, align: 'right' });
    doc.text('SALDO',       PAGE_LEFT + 390, y, { width: 90, align: 'right' });
    y += 12;
    doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y)
      .strokeColor('#cbd5e1').lineWidth(0.5).stroke();
    y += 4;
    doc.fillColor('#000000');

    for (const inv of cust.invoices) {
      // Estimar altura del bloque de factura (fila principal + abonos + NC)
      const rows = 1 + inv.payments.length + inv.credit_notes.length;
      ensureRoom(14 + rows * 10 + 6);

      const folio = inv.serie ? `${inv.serie}-${inv.folio}` : String(inv.folio);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a');
      doc.text(folio,                              PAGE_LEFT + 4,   y);
      doc.font('Helvetica').fontSize(9);
      doc.text(fmtDate(inv.date_issued),           PAGE_LEFT + 90,  y);
      doc.text(`$ ${fmtMoney(inv.total)}`,         PAGE_LEFT + 165, y, { width: 70, align: 'right' });
      doc.text(`$ ${fmtMoney(inv.paid)}`,          PAGE_LEFT + 240, y, { width: 70, align: 'right' });
      doc.text(`$ ${fmtMoney(inv.credited)}`,      PAGE_LEFT + 315, y, { width: 70, align: 'right' });
      doc.font('Helvetica-Bold').fillColor('#dc2626')
        .text(`$ ${fmtMoney(inv.balance)}`,        PAGE_LEFT + 390, y, { width: 90, align: 'right' });
      doc.fillColor('#000000');
      y += 12;

      // Sub-líneas: pagos + NC (sangría)
      doc.font('Helvetica').fontSize(8).fillColor('#475569');
      for (const p of inv.payments) {
        doc.text(`↳ Abono ${p.folio || ''}  ${fmtDate(p.date)}`, PAGE_LEFT + 20, y);
        doc.text(`− $ ${fmtMoney(p.amount)}`, PAGE_LEFT + 240, y, { width: 70, align: 'right' });
        y += 10;
      }
      for (const n of inv.credit_notes) {
        doc.text(`↳ NC ${n.folio || ''}  ${fmtDate(n.date)}`, PAGE_LEFT + 20, y);
        doc.text(`− $ ${fmtMoney(n.total)}`, PAGE_LEFT + 315, y, { width: 70, align: 'right' });
        y += 10;
      }
      doc.fillColor('#000000');
      y += 4;
    }
    y += 8;
  }

  drawPageNumbers(doc);
  doc.end();
  return new Promise((resolve, reject) => {
    doc.on('end', () => {
      logger.info(`PDF Cobranza generado (${report.customers.length} clientes)`);
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);
  });
}
