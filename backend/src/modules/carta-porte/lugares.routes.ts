/**
 * lugares.routes — CRUD del catálogo de Lugares frecuentes.
 *
 *   GET    /carta-porte/lugares?q=&tipo=&incluirInactivos=
 *   GET    /carta-porte/lugares/:id
 *   POST   /carta-porte/lugares                        (crea o hace upsert por alias)
 *   PATCH  /carta-porte/lugares/:id                    (edición completa)
 *   DELETE /carta-porte/lugares/:id                    (soft delete)
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as svc from './lugares.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID requerido');
  return req.user.companyId;
}

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const rows = await svc.list(companyId(req), {
    q: String(req.query.q || '').trim() || undefined,
    tipo: String(req.query.tipo || '').trim() || undefined,
    incluirInactivos: req.query.incluirInactivos === 'true',
  });
  res.json({ items: rows });
}));

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const row = await svc.getById(companyId(req), req.params.id);
  if (!row) { res.status(404).json({ error: 'No encontrado' }); return; }
  res.json(row);
}));

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const row = await svc.create(companyId(req), req.body);
  res.status(201).json(row);
}));

router.patch('/:id', asyncHandler(async (req: Request, res: Response) => {
  const row = await svc.update(companyId(req), req.params.id, req.body);
  res.json(row);
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const r = await svc.deactivate(companyId(req), req.params.id);
  res.json(r);
}));

export default router;
