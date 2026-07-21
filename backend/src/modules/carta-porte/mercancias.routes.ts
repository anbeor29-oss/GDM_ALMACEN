/**
 * mercancias.routes — CRUD + listado de mercancías transportadas.
 *
 *   GET  /carta-porte/mercancias           — catálogo (plantillas)
 *   GET  /carta-porte/mercancias/bitacora  — bitácora por viaje (inspecciones)
 *   DELETE /carta-porte/mercancias/:id     — borra plantilla
 *
 * La creación se hace vía el Super Lector XML (bulk); no exponemos POST
 * manual porque el flujo real es siempre desde CFDI+CP importado.
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as svc from './mercancias.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID requerido');
  return req.user.companyId;
}

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const items = await svc.listCatalog(companyId(req), {
    search: req.query.search as string | undefined,
    clienteRfc: req.query.clienteRfc as string | undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  res.json({ items });
}));

router.get('/bitacora', asyncHandler(async (req: Request, res: Response) => {
  const items = await svc.listBitacora(companyId(req), {
    invoiceId: req.query.invoiceId as string | undefined,
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  res.json({ items });
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  await svc.removeCatalog(companyId(req), req.params.id);
  res.json({ success: true });
}));

export default router;
