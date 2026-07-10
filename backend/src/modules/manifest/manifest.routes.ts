/**
 * /manifest — firma del manifiesto PAC con e.firma (por empresa).
 *
 *  GET  /manifest          estado del manifiesto de MI empresa (último firmado)
 *  GET  /manifest/text     texto que se va a firmar (preview para la pantalla)
 *  POST /manifest/sign     firma con e.firma { cerB64, keyB64, password }
 *  GET  /manifest/pdf      constancia PDF descargable
 *
 * La empresa se toma SIEMPRE del JWT (req.user.companyId) — un admin solo
 * puede firmar el manifiesto de su propia empresa.
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import * as manifestService from './manifest.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

/* Estado del manifiesto (null si nunca se ha firmado) */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const manifest = await manifestService.getLatestManifest(companyId(req));
  res.status(200).json({ success: true, data: { manifest } });
}));

/* Preview del texto que se firmará */
router.get('/text', asyncHandler(async (req: Request, res: Response) => {
  const r = await query<{ rfc: string; business_name: string }>(
    `SELECT rfc, business_name FROM companies WHERE id = $1`,
    [companyId(req)]
  );
  if (r.rows.length === 0) throw new ValidationError('Empresa no encontrada');
  const text = manifestService.buildManifestText({
    rfc: r.rows[0].rfc,
    businessName: r.rows[0].business_name,
    date: new Date(),
  });
  res.status(200).json({ success: true, data: { text } });
}));

/* Firmar con e.firma */
router.post('/sign', asyncHandler(async (req: Request, res: Response) => {
  const { cerB64, keyB64, password } = req.body || {};
  const result = await manifestService.signManifest({
    companyId: companyId(req),
    userId: req.user?.userId,
    cerB64,
    keyB64,
    password,
  });
  res.status(200).json({
    success: true,
    message: 'Manifiesto firmado correctamente',
    data: result,
  });
}));

/* Constancia PDF */
router.get('/pdf', asyncHandler(async (req: Request, res: Response) => {
  const buf = await manifestService.getManifestPdf(companyId(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="manifiesto-firmado.pdf"');
  res.send(buf);
}));

export default router;
