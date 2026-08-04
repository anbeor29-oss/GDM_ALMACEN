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
    /* motivoSat es la clave del Anexo 20; `motivo` es la nota interna. Antes
     * sólo viajaba la segunda y el SAT nunca supo por qué se cancelaba. */
    const result = await paymentsService.cancelPayment(
      companyId(req),
      req.params.id,
      req.body?.motivo,
      req.body?.motivoSat || '02',
      req.body?.folioSustitucion,
      req.body?.soloLocal === true,
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
    /* SI NO HAY XML TIMBRADO, NO SE ENTREGA NADA.
     *
     * Aquí se FABRICABA un XML a partir de los datos de la tabla cuando
     * xml_content venía vacío. Se veía como un CFDI —mismo namespace, misma
     * estructura— pero le faltaba lo único que lo hace válido: el
     * TimbreFiscalDigital y los sellos. Nadie que lo descargara podía notar la
     * diferencia sin abrirlo y buscar el nodo a mano.
     *
     * Eso convierte una carencia en un engaño: quien lo mande a su contador o lo
     * archive como respaldo fiscal creerá que tiene el comprobante, y sólo se
     * enterará de que no cuando el SAT se lo rechace o en una auditoría.
     *
     * Ahora se dice lo que pasa. Un error claro es mejor que un archivo que
     * parece correcto — sobre todo cuando el archivo es la prueba de un hecho
     * fiscal.
     */
    if (!xml) {
      throw new ValidationError(
        `El complemento de pago ${row.serie || 'P'}-${row.folio} NO ESTÁ TIMBRADO ante el SAT, así que no existe un XML que descargar. ` +
        `El sistema guarda el XML sólo cuando el PAC devuelve el timbre; si esta complemento de pago ` +
        `figura como timbrada pero no tiene XML, se registró sin llegar al SAT. ` +
        `Verifica su folio fiscal en verificacfdi.facturaelectronica.sat.gob.mx.`
      );
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
