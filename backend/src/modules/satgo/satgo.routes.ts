/**
 * /admin/satgo — configuración del proveedor fiscal SatGo (sólo SUPER_ADMIN).
 *
 *  GET   /admin/satgo/config      URL base, ambiente, si ya hay API key
 *  PUT   /admin/satgo/config      actualiza URL base / ambiente
 *  POST  /admin/satgo/bootstrap   { portalToken } → CreateKey → guarda la API key PERMANENTE cifrada
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler } from '../../middleware/errorHandler';
import { requireSuperAdmin, audit } from '../admin/admin.middleware';
import * as satgo from './satgo.service';

const router = Router();
router.use(authenticateToken);
router.use(requireSuperAdmin);

router.get('/config', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await satgo.getConfig() });
}));

router.put('/config', asyncHandler(async (req: Request, res: Response) => {
  const data = await satgo.setConfig({ baseUrl: req.body?.baseUrl, ambiente: req.body?.ambiente });
  await audit(req, { action: 'SATGO_CONFIG', targetKind: 'satgo_config', payload: { baseUrl: data.baseUrl, ambiente: data.ambiente } });
  res.json({ success: true, data });
}));

router.post('/bootstrap', asyncHandler(async (req: Request, res: Response) => {
  const data = await satgo.bootstrapApiKey(String(req.body?.portalToken || ''));
  await audit(req, { action: 'SATGO_BOOTSTRAP', targetKind: 'satgo_config' });
  res.json({ success: true, data });
}));

export default router;
