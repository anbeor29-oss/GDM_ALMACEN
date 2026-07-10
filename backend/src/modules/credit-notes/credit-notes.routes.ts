/**
 * Endpoints de Notas de Crédito (CFDI 4.0 tipo E — Anexo 20).
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as service from './credit-notes.service';
import { generateCreditNotePDF } from '../cfdi/pdf-credit-note.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

router.get(
  '/motivos',
  asyncHandler(async (_req: Request, res: Response) => {
    res.status(200).json({ success: true, data: { motivos: service.MOTIVOS } });
  })
);

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const r = await service.listCreditNotes(companyId(req), {
      limit: parseInt(String(req.query.limit || '50'), 10),
      offset: parseInt(String(req.query.offset || '0'), 10),
    });
    res.status(200).json({ success: true, data: r });
  })
);

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const note = await service.createCreditNote(companyId(req), req.body);
    res.status(201).json({
      success: true,
      message: 'Nota de Crédito timbrada (modo MOCK)',
      data: note,
    });
  })
);

/** POST /credit-notes/:id/cancel — cancela la NC y recalcula factura padre. */
router.post(
  '/:id/cancel',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.cancelCreditNote(
      companyId(req), req.params.id, req.body?.motivo
    );
    res.status(200).json({
      success: true,
      message: 'Nota de Crédito cancelada',
      data: result,
    });
  })
);

/** GET /credit-notes/:id/pdf */
router.get(
  '/:id/pdf',
  asyncHandler(async (req: Request, res: Response) => {
    const buf = await generateCreditNotePDF(companyId(req), req.params.id);
    const disp = req.query.inline === '1' ? 'inline' : 'attachment';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disp}; filename="nota-credito-${req.params.id}.pdf"`);
    res.send(buf);
  })
);

/** GET /credit-notes/:id/xml — descarga el XML CFDI 4.0 tipo E (Egreso).
 *  Si la NC fue creada antes de la generación automática de XML, se
 *  reconstruye on-the-fly a partir de los campos persistidos. */
router.get(
  '/:id/xml',
  asyncHandler(async (req: Request, res: Response) => {
    const { query } = await import('../../config/database');
    const r = await query<any>(
      `SELECT cn.*, i.cfdi_uuid AS inv_uuid
         FROM credit_notes cn
         LEFT JOIN invoices i ON i.id = cn.invoice_id
        WHERE cn.id = $1 AND cn.company_id = $2 AND cn.deleted_at IS NULL`,
      [req.params.id, companyId(req)]
    );
    const row = r.rows[0];
    if (!row) throw new ValidationError('Nota de crédito no encontrada');

    let xml = row.xml_content as string | null;
    if (!xml) {
      const fecha = new Date(row.date_issued).toISOString().slice(0, 19);
      const moneda = row.currency || 'MXN';
      const esc = (s: any) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      xml = `<?xml version="1.0" encoding="UTF-8"?>\n<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="${row.serie || 'NC'}" Folio="${row.folio}" Fecha="${fecha}" TipoDeComprobante="E" Moneda="${moneda}" SubTotal="${Number(row.subtotal).toFixed(2)}" Total="${Number(row.total).toFixed(2)}" Exportacion="01"><cfdi:CfdiRelacionados TipoRelacion="${row.tipo_relacion || '01'}"><cfdi:CfdiRelacionado UUID="${row.inv_uuid || ''}"/></cfdi:CfdiRelacionados><cfdi:Conceptos><cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" ClaveUnidad="ACT" Descripcion="${esc(row.motivo || 'Nota de crédito')}" ValorUnitario="${Number(row.subtotal).toFixed(2)}" Importe="${Number(row.subtotal).toFixed(2)}" ObjetoImp="02"><cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="${Number(row.subtotal).toFixed(2)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${Number(row.iva).toFixed(2)}"/></cfdi:Traslados></cfdi:Impuestos></cfdi:Concepto></cfdi:Conceptos><cfdi:Impuestos TotalImpuestosTrasladados="${Number(row.iva).toFixed(2)}"><cfdi:Traslados><cfdi:Traslado Base="${Number(row.subtotal).toFixed(2)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${Number(row.iva).toFixed(2)}"/></cfdi:Traslados></cfdi:Impuestos></cfdi:Comprobante>`;
    }

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="nota-credito-${row.serie || 'NC'}-${row.folio}.xml"`
    );
    res.send(xml);
  })
);

export default router;
