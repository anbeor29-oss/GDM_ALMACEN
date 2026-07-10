/**
 * Endpoints de Complemento de Pago (CFDI 4.0 tipo P).
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as paymentsService from './payments.service';
import { generatePaymentPDF } from '../cfdi/pdf-payment.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

/** POST /payments — crear complemento de pago (timbra en modo MOCK) */
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await paymentsService.createPayment(companyId(req), req.body);
    res.status(201).json({
      success: true,
      message: 'Complemento de Pago timbrado (modo MOCK)',
      data: result,
    });
  })
);

/** POST /payments/:id/cancel — cancela el complemento y recalcula estado
 *  de la factura padre. Requerido para poder cancelar después la factura. */
router.post(
  '/:id/cancel',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await paymentsService.cancelPayment(
      companyId(req), req.params.id, req.body?.motivo
    );
    res.status(200).json({
      success: true,
      message: 'Complemento de Pago cancelado',
      data: result,
    });
  })
);

/** GET /payments — listar pagos de la empresa */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const r = await paymentsService.listPayments(companyId(req), {
      limit: parseInt(String(req.query.limit || '50'), 10),
      offset: parseInt(String(req.query.offset || '0'), 10),
    });
    res.status(200).json({ success: true, data: r });
  })
);

/** GET /payments/by-invoice/:invoiceId — pagos de UNA factura */
router.get(
  '/by-invoice/:invoiceId',
  asyncHandler(async (req: Request, res: Response) => {
    const list = await paymentsService.getPaymentsByInvoice(companyId(req), req.params.invoiceId);
    res.status(200).json({ success: true, data: { count: list.length, payments: list } });
  })
);

/** GET /payments/:id/pdf — PDF del Complemento de Pago (download / preview) */
router.get(
  '/:id/pdf',
  asyncHandler(async (req: Request, res: Response) => {
    const buf = await generatePaymentPDF(companyId(req), req.params.id);
    const disp = req.query.inline === '1' ? 'inline' : 'attachment';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disp}; filename="pago-${req.params.id}.pdf"`);
    res.send(buf);
  })
);

/** GET /payments/:id/xml — descarga el XML CFDI 4.0 tipo P (Pago).
 *  Si el pago fue creado antes de tener generación de XML, se reconstruye
 *  on-the-fly a partir de los campos persistidos para que la descarga funcione. */
router.get(
  '/:id/xml',
  asyncHandler(async (req: Request, res: Response) => {
    const { query } = await import('../../config/database');
    const r = await query<any>(
      `SELECT p.*, i.cfdi_uuid AS inv_uuid, i.total AS inv_total
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
        WHERE p.id = $1 AND p.company_id = $2 AND p.deleted_at IS NULL`,
      [req.params.id, companyId(req)]
    );
    const row = r.rows[0];
    if (!row) throw new ValidationError('Pago no encontrado');

    let xml = row.xml_content as string | null;
    if (!xml) {
      // Reconstruimos a partir de datos persistidos (modo mock retroactivo)
      const fecha = new Date(row.payment_date).toISOString().slice(0, 19);
      const moneda = row.currency || 'MXN';
      xml = `<?xml version="1.0" encoding="UTF-8"?>\n<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:pago20="http://www.sat.gob.mx/Pagos20" Version="4.0" Serie="${row.serie || 'P'}" Folio="${row.folio}" Fecha="${fecha}" TipoDeComprobante="P" Moneda="XXX" SubTotal="0" Total="0" Exportacion="01"><cfdi:Conceptos><cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" ClaveUnidad="ACT" Descripcion="Pago" ValorUnitario="0" Importe="0" ObjetoImp="01"/></cfdi:Conceptos><cfdi:Complemento><pago20:Pagos Version="2.0"><pago20:Pago FechaPago="${fecha}" FormaDePagoP="${row.payment_form || '03'}" MonedaP="${moneda}" Monto="${Number(row.payment_amount).toFixed(2)}"><pago20:DoctoRelacionado IdDocumento="${row.inv_uuid || ''}" MonedaDR="${moneda}" NumParcialidad="1" ImpSaldoAnt="${Number(row.inv_total).toFixed(2)}" ImpPagado="${Number(row.payment_amount).toFixed(2)}" ImpSaldoInsoluto="0.00" ObjetoImpDR="01"/></pago20:Pago></pago20:Pagos></cfdi:Complemento></cfdi:Comprobante>`;
    }

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="pago-${row.serie || 'P'}-${row.folio}.xml"`
    );
    res.send(xml);
  })
);

export default router;
