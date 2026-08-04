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
    /* motivoSat es la clave del Anexo 20 (c_MotivoCancelacion); `motivo` es la
     * nota interna en texto libre. Se separan porque son cosas distintas y
     * antes sólo viajaba la segunda: el SAT nunca supo por qué se cancelaba. */
    const result = await service.cancelCreditNote(
      companyId(req),
      req.params.id,
      req.body?.motivo,
      req.body?.motivoSat || '02',
      req.body?.folioSustitucion,
      req.body?.soloLocal === true,
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
        `La nota de crédito ${row.serie || 'NC'}-${row.folio} NO ESTÁ TIMBRADA ante el SAT, así que no existe un XML que descargar. ` +
        `El sistema guarda el XML sólo cuando el PAC devuelve el timbre; si esta nota de crédito ` +
        `figura como timbrada pero no tiene XML, se registró sin llegar al SAT. ` +
        `Verifica su folio fiscal en verificacfdi.facturaelectronica.sat.gob.mx.`
      );
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
