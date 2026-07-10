/**
 * /cfdi-import — endpoints HTTP del wizard de importación.
 *
 *  POST /cfdi-import/preview     Body: { xmlBase64 }                  → PreviewResult
 *  POST /cfdi-import/commit      Body: CommitRequest                  → CommitResult
 *  GET  /cfdi-import/history?limit=50                                 → bitácora
 *
 *  Seguridad:
 *   · Solo usuarios autenticados (cualquier rol con company_id válido).
 *   · Límite hard de 1 MB en el body — el service revalida.
 *   · El XML jamás se ejecuta — solo se parsea con xml2js, sin XSLT, sin DTDs externos.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as service from './cfdi-import.service';
import { CommitRequest } from './cfdi-import.types';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

function decodeXml(body: any): Buffer {
  const b64 = body?.xmlBase64;
  if (!b64 || typeof b64 !== 'string') throw new ValidationError('xmlBase64 requerido');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 50)         throw new ValidationError('XML vacío o demasiado corto');
  if (buf.length > 1_048_576)  throw new ValidationError('XML excede 1 MB');
  return buf;
}

router.post('/preview', asyncHandler(async (req: Request, res: Response) => {
  const buf = decodeXml(req.body);
  const data = await service.preview(companyId(req), buf);
  res.json({ success: true, data });
}));

router.post('/commit', asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as CommitRequest;
  if (!body?.sha256 || !body?.xmlBase64) throw new ValidationError('sha256 + xmlBase64 requeridos');
  if (!body?.selection || !['emisor', 'receptor', 'none'].includes(body.selection.party)) {
    throw new ValidationError('selection.party debe ser "emisor" | "receptor" | "none"');
  }
  if (body.selection.party !== 'none' &&
      !['CUSTOMER', 'SUPPLIER'].includes((body.selection as any).partyKind)) {
    throw new ValidationError('selection.partyKind debe ser "CUSTOMER" | "SUPPLIER"');
  }
  if (!Array.isArray(body.selection.concept_indexes)) {
    throw new ValidationError('selection.concept_indexes debe ser array');
  }
  const data = await service.commit(
    companyId(req),
    req.user!.userId,
    req.user!.email,
    body
  );
  res.status(201).json({ success: true, data });
}));

router.get('/history', asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
  const rows  = await service.history(companyId(req), limit);
  res.json({ success: true, data: { entries: rows } });
}));

export default router;
