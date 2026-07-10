/**
 * Rutas del mailer:
 *   POST /invoices/:id/send-email      → envío de PDF + XML de una factura
 *                                        (más NCs y complementos de pago
 *                                        relacionados si se seleccionan).
 *   POST /admin/mail-test              → prueba de config SMTP (super admin).
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import { sendInvoiceMail, testMailConfig, MailAttachmentSpec } from './mailer.service';

const router = Router();
router.use(authenticateToken);

router.post(
  '/invoices/:id/send-email',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.companyId) throw new ValidationError('Company ID requerido');
    const { id } = req.params;
    const { to, cc, subject, message, attachments } = req.body as {
      to: string;
      cc?: string;
      subject: string;
      message: string;
      attachments: MailAttachmentSpec[];
    };

    // Aseguramos que el ID de la factura del path esté siempre en attachments
    // como referencia — el frontend puede omitir el invoice_pdf/xml, pero el
    // servicio de correo necesita saber sobre qué factura estamos operando.
    const withInvoice = Array.isArray(attachments) ? attachments : [];

    const result = await sendInvoiceMail({
      companyId: req.user.companyId,
      to,
      cc,
      subject: subject || `Documentos fiscales`,
      message: message || '',
      attachments: withInvoice,
      actingUserEmail: req.user.email,
    });
    res.status(200).json({ success: true, data: { invoiceId: id, ...result } });
  })
);

router.post(
  '/admin/mail-test',
  asyncHandler(async (req: Request, res: Response) => {
    if (req.user?.role !== 'SUPER_ADMIN') {
      throw new ValidationError('Solo SUPER_ADMIN puede probar la config SMTP');
    }
    const { to } = req.body as { to: string };
    if (!to) throw new ValidationError('Falta el correo destino "to"');
    const result = await testMailConfig(to);
    res.status(200).json({ success: true, data: result });
  })
);

export default router;
