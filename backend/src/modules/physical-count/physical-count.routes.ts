/**
 * /physical-counts — inventario físico y conciliación (Fase 6 ALMACEN §11).
 *
 *  Lectura y captura: cualquier usuario de la empresa (personal de conteo).
 *  Abrir / cerrar (autorizar ajustes) / cancelar: ADMIN, MANAGER.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, requireCapability } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as service from './physical-count.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}
function actor(req: Request) {
  return { userId: req.user?.userId, email: req.user?.email };
}

/** GET /physical-counts — lista */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const counts = await service.listCounts(companyId(req));
    res.json({ success: true, data: { counts } });
  })
);

/** GET /physical-counts/:id — detalle con items */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getCount(companyId(req), req.params.id);
    res.json({ success: true, data });
  })
);

/** POST /physical-counts — abrir conteo (congela existencia del sistema) */
router.post(
  '/',
  requireCapability('physical:count'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.openCount(companyId(req), req.body, actor(req));
    res.status(201).json({ success: true, data: result });
  })
);

/** PUT /physical-counts/:id/capture — capturar cantidades contadas */
router.put(
  '/:id/capture',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.captureItems(companyId(req), req.params.id, req.body?.items);
    res.json({ success: true, data: result });
  })
);

/** POST /physical-counts/:id/close — cerrar y aplicar ajustes (autorización) */
router.post(
  '/:id/close',
  requireCapability('physical:authorize'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.closeCount(companyId(req), req.params.id, actor(req));
    res.json({ success: true, data: result });
  })
);

/** POST /physical-counts/:id/cancel — cancelar conteo abierto */
router.post(
  '/:id/cancel',
  requireCapability('physical:authorize'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.cancelCount(companyId(req), req.params.id);
    res.json({ success: true, data: result });
  })
);

export default router;
