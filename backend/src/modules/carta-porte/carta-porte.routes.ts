/**
 * carta-porte.routes — CRUD del Complemento Carta Porte 3.1.
 *
 *   GET    /invoices/:invoiceId/carta-porte  -> lee la CP (o null)
 *   PUT    /invoices/:invoiceId/carta-porte  -> reemplaza total (idempotente)
 *   DELETE /invoices/:invoiceId/carta-porte  -> quita la CP de una factura DRAFT
 *
 * Nota: se monta bajo /api/v1 en app.ts. Todas las rutas exigen JWT y filtran
 *       por company_id del usuario (nadie ve CP de otra empresa).
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import { parseCartaPorte } from './carta-porte.validators';
import { getByInvoiceId, upsert, remove } from './carta-porte.service';
import { buildCartaPorteXml } from './build-carta-porte-xml';
import { validateCartaPorte } from './validate-carta-porte';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

router.get(
  '/invoices/:invoiceId/carta-porte',
  asyncHandler(async (req: Request, res: Response) => {
    const cp = await getByInvoiceId(req.params.invoiceId);
    res.json({ cartaPorte: cp });
  }),
);

router.put(
  '/invoices/:invoiceId/carta-porte',
  asyncHandler(async (req: Request, res: Response) => {
    const input = parseCartaPorte(req.body);
    const r = await upsert(companyId(req), req.params.invoiceId, input);
    res.status(201).json({ id: r.id });
  }),
);

router.get(
  '/invoices/:invoiceId/carta-porte/validate',
  asyncHandler(async (req: Request, res: Response) => {
    const cp = await getByInvoiceId(req.params.invoiceId);
    if (!cp) { res.status(404).json({ error: 'Sin Carta Porte' }); return; }
    const violations = await validateCartaPorte(cp as any);
    res.json({
      valid: violations.filter(v => v.severidad === 'error').length === 0,
      violations,
    });
  }),
);

router.get(
  '/invoices/:invoiceId/carta-porte/xml',
  asyncHandler(async (req: Request, res: Response) => {
    const cp = await getByInvoiceId(req.params.invoiceId);
    if (!cp) { res.status(404).json({ error: 'Sin Carta Porte' }); return; }
    const xml = buildCartaPorteXml(cp as any);
    res.type('application/xml').send(xml);
  }),
);

router.delete(
  '/invoices/:invoiceId/carta-porte',
  asyncHandler(async (req: Request, res: Response) => {
    const r = await remove(companyId(req), req.params.invoiceId);
    res.json(r);
  }),
);

export default router;
