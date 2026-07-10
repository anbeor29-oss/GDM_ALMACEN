/**
 * Generación del PDF de Nota de Crédito (CFDI 4.0 tipo E — Egreso).
 *
 * Layout:
 *  ┌────────────────────────────────────────────────────────────┐
 *  │ [LOGO]  NOTA DE CRÉDITO    │  FOLIO  NC-000001              │
 *  │         ACME...            │  FECHA  17/06/2026             │
 *  │         RFC / Régimen      │  UUID, MONEDA, NO. CERT        │
 *  ├────────────────────────────────────────────────────────────┤
 *  │ RECEPTOR                                                    │
 *  ├────────────────────────────────────────────────────────────┤
 *  │ CFDI RELACIONADO                                            │
 *  │   Tipo Relación: 01 — Nota de crédito de los documentos…    │
 *  │   Folio fiscal: UUID de la factura origen                  │
 *  │   Factura: FAC-000016                                       │
 *  ├────────────────────────────────────────────────────────────┤
 *  │ CONCEPTO                                                    │
 *  │   Egreso por el motivo capturado                            │
 *  ├────────────────────────────────────────────────────────────┤
 *  │                       Subtotal:  (negativo)                 │
 *  │                       IVA:       (negativo)                 │
 *  │                       TOTAL NC:  $ X (rojo)                 │
 *  │                                                             │
 *  │  Importe en letra: …                                        │
 *  └────────────────────────────────────────────────────────────┘
 */

import PDFDocument from 'pdfkit';
import { query } from '../../config/database';
import { NotFoundError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import * as companiesService from '../companies/companies.service';
import * as customersService from '../customers/customers.service';
import {
  PDFDoc, PAGE_LEFT, PAGE_RIGHT, fmtMoney, montoEnLetra,
  drawCommonHeader, drawReceptor, drawFooter, drawTimbreFiscal, drawPageNumbers, loadRegimenDesc,
  extractTimbreData, buildQrSatPng, drawCancelledWatermark,
} from './pdf-helpers';
import { getCompanyLogo } from './logo-cache';
import { MOTIVOS } from '../credit-notes/credit-notes.service';

export async function generateCreditNotePDF(companyId: string, creditNoteId: string): Promise<Buffer> {
  const r = await query(
    `SELECT cn.*, i.serie AS inv_serie, i.folio AS inv_folio, i.cfdi_uuid AS inv_uuid
       FROM credit_notes cn
       LEFT JOIN invoices i ON i.id = cn.invoice_id
      WHERE cn.id = $1 AND cn.company_id = $2 AND cn.deleted_at IS NULL`,
    [creditNoteId, companyId]
  );
  const note: any = r.rows[0];
  if (!note) throw new NotFoundError('Nota de crédito no encontrada');

  const company = await companiesService.getCompanyById(companyId);
  const customer = await customersService.getCustomerById(companyId, note.customer_id);

  const [regE, regR] = await Promise.all([
    loadRegimenDesc(company.fiscal_regime),
    loadRegimenDesc(customer.fiscal_regime),
  ]);

  const doc = new PDFDocument({ size: 'letter', margin: 40, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));

  const folio = `${note.serie || 'NC'}-${String(note.folio).padStart(6, '0')}`;
  const logoBuf = await getCompanyLogo((company as any).id);
  let y = drawCommonHeader(doc, company, {
    titulo: 'NOTA DE CRÉDITO',
    folio,
    fecha: note.date_issued,
    uuid: note.uuid,
    moneda: note.currency || 'MXN',
    regimenDesc: regE,
    color: '#be123c',  // rojo/rosa — distintivo de Egreso
    logoBuf,
    xml: (note as any).xml_content,
  });

  y = drawReceptor(doc, y, customer, regR);

  // ─── Sección "CFDI Relacionado" ───
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b')
    .text('CFDI RELACIONADO (Anexo 20)', PAGE_LEFT, y);
  y += 14;

  // Caja con datos del relacionado
  const boxX = PAGE_LEFT;
  const boxW = PAGE_RIGHT - PAGE_LEFT;
  const boxH = 64;
  doc.roundedRect(boxX, y, boxW, boxH, 6).fillAndStroke('#fff1f2', '#fda4af');
  let by = y + 8;
  const tipoRel = note.tipo_relacion || '01';
  const motDesc = (MOTIVOS as Record<string, string>)[tipoRel] || '—';

  doc.font('Helvetica').fontSize(7.5).fillColor('#7c2d12').text('TIPO DE RELACIÓN', boxX + 10, by);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f172a')
    .text(`${tipoRel} — ${motDesc}`, boxX + 130, by - 1, { width: boxW - 140 });
  by += 16;
  doc.font('Helvetica').fontSize(7.5).fillColor('#7c2d12').text('FOLIO FACTURA', boxX + 10, by);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f172a')
    .text(note.inv_folio ? `${note.inv_serie}-${String(note.inv_folio).padStart(6, '0')}` : '—', boxX + 130, by - 1);
  by += 16;
  doc.font('Helvetica').fontSize(7.5).fillColor('#7c2d12').text('UUID FACTURA', boxX + 10, by);
  doc.font('Courier').fontSize(8).fillColor('#1e3a8a')
    .text(note.inv_uuid || '— sin UUID —', boxX + 130, by, { width: boxW - 140 });
  by += 16;

  y += boxH + 12;
  doc.fillColor('#000000');

  // ─── Concepto ───
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b')
    .text('CONCEPTO', PAGE_LEFT, y);
  y += 14;
  const headerY = y;
  doc.rect(PAGE_LEFT, headerY, PAGE_RIGHT - PAGE_LEFT, 18).fill('#be123c');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
  doc.text('CANT', PAGE_LEFT + 6,   headerY + 5);
  doc.text('DESCRIPCIÓN', PAGE_LEFT + 60,  headerY + 5);
  doc.text('IMPORTE',  PAGE_LEFT + 448, headerY + 5, { width: 60, align: 'right' });

  const rowY = headerY + 22;
  doc.fillColor('#0f172a').font('Helvetica').fontSize(9);
  doc.text('1', PAGE_LEFT + 6, rowY);
  doc.text(`Nota de crédito por ${note.motivo || motDesc}`, PAGE_LEFT + 60, rowY,
    { width: 380 });
  doc.font('Helvetica-Bold')
    .text(`$ ${fmtMoney(note.subtotal)}`, PAGE_LEFT + 448, rowY, { width: 60, align: 'right' });

  // Marco
  doc.rect(PAGE_LEFT, headerY, PAGE_RIGHT - PAGE_LEFT, rowY - headerY + 22)
    .lineWidth(0.5).strokeColor('#fda4af').stroke();
  doc.fillColor('#000000').strokeColor('#000000');

  y = rowY + 32;

  // ─── Totales (todos en rojo porque es Egreso) ───
  // Box más ancho y label corto en la línea grande para que el monto + MXN
  // quepa en una sola línea sin montarse con el texto del label.
  const boxLX = 300;
  const labelX = boxLX + 8;
  const valueX = boxLX + 110;
  const valueW = PAGE_RIGHT - valueX - 8;

  function line(label: string, value: string, big = false) {
    if (big) {
      doc.rect(boxLX, y - 2, PAGE_RIGHT - boxLX, 24).fill('#be123c');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11);
    } else {
      doc.fillColor('#374151').font('Helvetica').fontSize(9);
    }
    doc.text(label, labelX, y + (big ? 5 : 0), { width: valueX - labelX - 4, lineBreak: false, ellipsis: true });
    doc.text(value, valueX, y + (big ? 5 : 0), { width: valueW, align: 'right', lineBreak: false, ellipsis: true });
    y += big ? 28 : 14;
  }
  line('Subtotal', `$ ${fmtMoney(note.subtotal)}`);
  if (Number(note.iva) > 0) line('IVA', `$ ${fmtMoney(note.iva)}`);
  line('TOTAL NC', `$ ${fmtMoney(note.total)} ${note.currency || 'MXN'}`, true);

  const enLetra = montoEnLetra(Number(note.total), note.currency || 'MXN');
  doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#475569')
    .text('Importe en letra:', PAGE_LEFT, y);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f172a')
    .text(enLetra, PAGE_LEFT + 90, y, { width: PAGE_RIGHT - PAGE_LEFT - 90 });
  const enLetraH = doc.heightOfString(enLetra, { width: PAGE_RIGHT - PAGE_LEFT - 90 });
  y += Math.max(16, enLetraH + 6);

  // Bloque oficial SAT — con QR real del portal si la NC está timbrada.
  const tNc = extractTimbreData(note.xml_content);
  const qrPngNc = await buildQrSatPng({
    uuid: tNc.uuid || note.uuid,
    rfcEmisor: tNc.rfcEmisor || (company as any).rfc,
    rfcReceptor: tNc.rfcReceptor || (customer as any).rfc,
    total: tNc.total || note.total,
    selloCfd: tNc.selloCfd,
  });
  drawTimbreFiscal(doc, y + 4, {
    uuid: note.uuid,
    fechaTimbrado: note.pac_timestamp || note.date_issued,
    color: '#be123c',
    xml: note.xml_content,
    qrPng: qrPngNc,
  });

  drawFooter(
    doc,
    note.uuid
      ? 'Este documento es una representación impresa de un CFDI de Egreso (Nota de Crédito) válido.'
      : 'Representación borrador. Sin sello del SAT no tiene validez fiscal.'
  );
  drawPageNumbers(doc);
  if (note.status === 'CANCELLED') {
    drawCancelledWatermark(doc);
  }

  doc.end();
  return new Promise((resolve, reject) => {
    doc.on('end', () => {
      logger.info(`PDF Nota de Crédito generado: ${folio}`);
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);
  });
}
