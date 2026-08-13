/**
 * Generación del PDF del Complemento de Pago (CFDI 4.0 tipo P — Anexo 20).
 *
 * Layout:
 *  ┌───────────────────────────────────────────────────────────┐
 *  │ [LOGO]  COMPLEMENTO DE PAGO  │ FOLIO P-000001              │
 *  │         ACME...              │ FECHA 17/06/2026            │
 *  │         RFC / Régimen        │ FORMA PAGO 03 — Transf.     │
 *  │         Domicilio            │ UUID, MONEDA, NO. CERT      │
 *  ├───────────────────────────────────────────────────────────┤
 *  │ RECEPTOR (cliente)                                         │
 *  ├───────────────────────────────────────────────────────────┤
 *  │ DATOS DEL PAGO                                             │
 *  │   Fecha de pago | Forma de pago | Moneda | Tipo cambio    │
 *  │   Monto pagado  | Importe en letra                         │
 *  ├───────────────────────────────────────────────────────────┤
 *  │ DOCUMENTOS RELACIONADOS                                    │
 *  │   Folio | UUID | Moneda DR | Parcialidad | Saldo Anterior │
 *  │     | Importe pagado | Saldo Insoluto                      │
 *  └───────────────────────────────────────────────────────────┘
 */

import PDFDocument from 'pdfkit';
import { query } from '../../config/database';
import { NotFoundError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import * as companiesService from '../companies/companies.service';
import * as customersService from '../customers/customers.service';
import {
  PDFDoc, PAGE_LEFT, PAGE_RIGHT, fmtMoney, fmtDate, montoEnLetra,
  FORMA_PAGO, drawCommonHeader, drawReceptor, drawFooter, drawTimbreFiscal,
  drawPageNumbers, loadRegimenDesc, extractTimbreData, buildQrSatPng,
  drawCancelledWatermark,
} from './pdf-helpers';
import { getCompanyLogo } from './logo-cache';

export async function generatePaymentPDF(companyId: string, paymentId: string): Promise<Buffer> {
  // 1) Cargar el pago
  const r = await query(
    `SELECT p.* FROM payments p
      WHERE p.id = $1 AND p.company_id = $2 AND p.deleted_at IS NULL`,
    [paymentId, companyId]
  );
  const payment: any = r.rows[0];
  if (!payment) throw new NotFoundError('Pago no encontrado');

  /* 2) TODAS las facturas que liquida este pago.
   *
   * El PDF leía `payments.invoice_id` —UNA sola— mientras el XML timbrado ya
   * declaraba todos los DoctoRelacionado. El comprobante estaba bien y el papel
   * mentía: un depósito que cubría tres facturas se imprimía como si cubriera
   * una, y el cliente no podía cuadrar su estado de cuenta con lo que recibió.
   *
   * Los saldos y la parcialidad se leen de `payment_invoices` TAL COMO SE
   * TIMBRARON, no se recalculan: el CFDI ya se emitió con esas cifras y volver
   * a calcularlas con los saldos de hoy imprimiría números distintos a los del
   * XML que el cliente tiene. */
  const docsR = await query<any>(
    `SELECT pi.monto, pi.parcialidad, pi.saldo_anterior, pi.saldo_insoluto,
            i.serie, i.folio, i.cfdi_uuid, i.currency, i.customer_id
       FROM payment_invoices pi
       JOIN invoices i ON i.id = pi.invoice_id
      WHERE pi.payment_id = $1
      ORDER BY i.date_issued, i.folio`,
    [paymentId]
  );

  /* Respaldo para los pagos anteriores a la tabla puente (agosto 2026): ahí la
   * única relación es `payments.invoice_id`. Sin esto, sus PDF saldrían sin
   * ningún documento relacionado, que es peor que mostrar uno. */
  let documentos = docsR.rows;
  if (documentos.length === 0 && payment.invoice_id) {
    const uno = await query<any>(
      `SELECT $2::numeric AS monto, 1 AS parcialidad,
              i.total AS saldo_anterior,
              GREATEST(0, i.total - $2::numeric) AS saldo_insoluto,
              i.serie, i.folio, i.cfdi_uuid, i.currency, i.customer_id
         FROM invoices i WHERE i.id = $1`,
      [payment.invoice_id, payment.payment_amount]
    );
    documentos = uno.rows;
  }
  if (documentos.length === 0) {
    throw new NotFoundError('El pago no tiene facturas relacionadas');
  }

  // 2) Empresa + cliente
  const company = await companiesService.getCompanyById(companyId);
  const customer = await customersService.getCustomerById(companyId, payment.customer_id);

  /* Ya NO se recalculan saldos ni parcialidad aquí.
   *
   * Antes se derivaban de los pagos previos de UNA factura. Ahora vienen de
   * `payment_invoices`, que los guardó tal como se timbraron; recalcularlos hoy
   * daría cifras distintas a las del XML en cuanto entre otro pago o una nota
   * de crédito posterior. El papel debe decir lo mismo que el comprobante. */

  const [regE, regR] = await Promise.all([
    loadRegimenDesc(company.fiscal_regime),
    loadRegimenDesc(customer.fiscal_regime),
  ]);

  // 4) Generar PDF
  const doc = new PDFDocument({ size: 'letter', margin: 40, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));

  // Header con título morado/verde (color distintivo para CFDI de Pago)
  const folio = `${payment.serie || 'P'}-${String(payment.folio).padStart(6, '0')}`;
  const logoBuf = await getCompanyLogo((company as any).id);
  let y = drawCommonHeader(doc, company, {
    titulo: 'COMPLEMENTO DE PAGO',
    folio,
    fecha: payment.payment_date,
    forma: payment.payment_form,
    metodo: payment.payment_method,
    uuid: payment.uuid,
    moneda: payment.currency || 'MXN',
    regimenDesc: regE,
    color: '#15803d',  // verde — distintivo del CFDI de pago
    logoBuf,
    xml: (payment as any).xml_content,
  });

  y = drawReceptor(doc, y, customer, regR);

  // ─── Sección "Datos del Pago" ───
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b').text('DATOS DEL PAGO', PAGE_LEFT, y);
  y += 14;

  const fpDesc = FORMA_PAGO[payment.payment_form] || '';
  drawKV(doc, PAGE_LEFT,        y, 'Fecha del Pago:', fmtDate(payment.payment_date));
  drawKV(doc, PAGE_LEFT + 280,  y, 'Forma de Pago:', `${payment.payment_form} — ${fpDesc}`);
  y += 14;
  drawKV(doc, PAGE_LEFT,        y, 'Moneda P:', payment.currency || 'MXN');
  drawKV(doc, PAGE_LEFT + 280,  y, 'Tipo de Cambio:', '1.0000');
  y += 14;
  drawKV(doc, PAGE_LEFT,        y, 'Monto Pagado:', `$ ${fmtMoney(payment.payment_amount)} ${payment.currency || 'MXN'}`,
    { boldValue: true, valueColor: '#15803d' });
  y += 18;

  // Importe en letra del pago
  const enLetra = montoEnLetra(Number(payment.payment_amount), payment.currency || 'MXN');
  doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#475569')
    .text('Importe en letra:', PAGE_LEFT, y);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f172a')
    .text(enLetra, PAGE_LEFT + 90, y, { width: PAGE_RIGHT - PAGE_LEFT - 90 });
  const lineaH = doc.heightOfString(enLetra, { width: PAGE_RIGHT - PAGE_LEFT - 90 });
  y += Math.max(16, lineaH + 6);

  // ─── Sección "Documentos Relacionados" ───
  doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).strokeColor('#cbd5e1').lineWidth(1).stroke();
  y += 8;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b').text('DOCUMENTOS RELACIONADOS', PAGE_LEFT, y);
  y += 14;

  // Tabla de documentos relacionados
  const headerY = y;
  doc.rect(PAGE_LEFT, headerY, PAGE_RIGHT - PAGE_LEFT, 18).fill('#15803d');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5);
  // Anchos recalculados para que "SALDO INSOLUTO" quepa en una sola línea
  // en Helvetica-Bold 7.5 (~60pt) sin partirse "SALDO\\nINSOLUTO".
  const cols = {
    folio:   { x: PAGE_LEFT + 6,   w: 56 },
    uuid:    { x: PAGE_LEFT + 66,  w: 160 },
    moneda:  { x: PAGE_LEFT + 230, w: 32 },
    nparc:   { x: PAGE_LEFT + 264, w: 26 },
    salant:  { x: PAGE_LEFT + 292, w: 64 },
    pagado:  { x: PAGE_LEFT + 358, w: 64 },
    salins:  { x: PAGE_LEFT + 424, w: 86 },
  };
  doc.text('FOLIO',         cols.folio.x,   headerY + 5);
  doc.text('UUID',          cols.uuid.x,    headerY + 5);
  doc.text('MONEDA',        cols.moneda.x,  headerY + 5);
  doc.text('PARC.',         cols.nparc.x,   headerY + 5, { width: cols.nparc.w, align: 'center' });
  doc.text('SALDO ANT.',    cols.salant.x,  headerY + 5, { width: cols.salant.w, align: 'right' });
  doc.text('IMP. PAGADO',   cols.pagado.x,  headerY + 5, { width: cols.pagado.w, align: 'right' });
  doc.text('SALDO INSOLUTO',cols.salins.x,  headerY + 5, { width: cols.salins.w, align: 'right' });

  /* Una fila por documento. La tabla crece con el número de facturas que
   * liquida el pago; antes era una sola fila fija. */
  let rowY = headerY + 22;
  for (const d of documentos) {
    const pagado = Number(d.monto) || 0;
    const salAnt = Number(d.saldo_anterior) || 0;
    const salIns = Number(d.saldo_insoluto) || 0;

    doc.fillColor('#0f172a').font('Helvetica').fontSize(8);
    doc.text(`${d.serie || ''}-${String(d.folio).padStart(6, '0')}`, cols.folio.x, rowY);
    doc.font('Courier').fontSize(6.5).fillColor('#475569')
      .text(d.cfdi_uuid || '—', cols.uuid.x, rowY, { width: cols.uuid.w });
    doc.font('Helvetica').fontSize(8).fillColor('#0f172a')
      .text(d.currency || payment.currency || 'MXN', cols.moneda.x, rowY);
    doc.text(String(d.parcialidad ?? 1), cols.nparc.x, rowY, { width: cols.nparc.w, align: 'center' });
    doc.text(`$ ${fmtMoney(salAnt)}`, cols.salant.x, rowY, { width: cols.salant.w, align: 'right' });
    doc.font('Helvetica-Bold').fillColor('#15803d')
      .text(`$ ${fmtMoney(pagado)}`, cols.pagado.x, rowY, { width: cols.pagado.w, align: 'right' });
    doc.font('Helvetica').fillColor(salIns > 0 ? '#dc2626' : '#16a34a')
      .text(`$ ${fmtMoney(salIns)}`, cols.salins.x, rowY, { width: cols.salins.w, align: 'right' });

    rowY += 16;
  }

  /* Con varias facturas se imprime el total, porque la suma de los importes es
   * justamente lo que el cliente va a cotejar contra su transferencia. */
  if (documentos.length > 1) {
    const suma = documentos.reduce((a: number, d: any) => a + (Number(d.monto) || 0), 0);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a')
      .text(`${documentos.length} facturas`, cols.folio.x, rowY + 2)
      .text(`$ ${fmtMoney(suma)}`, cols.pagado.x, rowY + 2, { width: cols.pagado.w, align: 'right' });
    rowY += 16;
  }

  doc.rect(PAGE_LEFT, headerY, PAGE_RIGHT - PAGE_LEFT, rowY - headerY + 2)
    .lineWidth(0.5).strokeColor('#cbd5e1').stroke();
  doc.fillColor('#000000').strokeColor('#000000');

  // Bloque oficial SAT — datos y QR del portal desde el XML timbrado.
  const tPay = extractTimbreData((payment as any).xml_content);
  const qrPngPay = await buildQrSatPng({
    uuid: tPay.uuid || payment.uuid,
    rfcEmisor: tPay.rfcEmisor || (company as any).rfc,
    rfcReceptor: tPay.rfcReceptor || (customer as any).rfc,
    total: tPay.total || 0,
    selloCfd: tPay.selloCfd,
  });
  drawTimbreFiscal(doc, rowY + 30, {
    uuid: payment.uuid,
    fechaTimbrado: payment.pac_timestamp || payment.payment_date,
    color: '#15803d',
    xml: (payment as any).xml_content,
    qrPng: qrPngPay,
  });

  drawFooter(
    doc,
    payment.uuid
      ? 'Este documento es una representación impresa de un CFDI de Pago válido.'
      : 'Representación borrador. Sin sello del SAT no tiene validez fiscal.'
  );
  drawPageNumbers(doc);
  if ((payment as any).document_status === 'CANCELLED') {
    drawCancelledWatermark(doc);
  }

  doc.end();
  return new Promise((resolve, reject) => {
    doc.on('end', () => {
      logger.info(`PDF Complemento de Pago generado: ${folio}`);
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);
  });
}

/* ───────────── helpers internos ───────────── */

function drawKV(
  doc: PDFDoc, x: number, y: number, label: string, value: string,
  opts: { boldValue?: boolean; valueColor?: string } = {}
) {
  doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text(label, x, y);
  doc.font(opts.boldValue ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
    .fillColor(opts.valueColor || '#0f172a')
    .text(value, x + 90, y - 1, { width: 200 });
}
