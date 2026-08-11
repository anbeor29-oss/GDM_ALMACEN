/**
 * /presencia — quién más tiene abierta esta pantalla.
 *
 * Sin `requireCapability`: saber que un compañero está en el mismo documento no
 * es un privilegio, es lo que evita que se pisen el trabajo. Cualquier usuario
 * autenticado de la empresa lo consulta, y sólo ve gente de SU empresa.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as service from './presencia.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

/* El nombre para mostrar no viaja en el JWT: lo resuelve el servicio contra
 * `users` en el mismo INSERT de la presencia. Aquí sólo hace falta el id. */
function usuario(req: Request) {
  return { userId: String(req.user?.userId) };
}

/**
 * POST /presencia/entrar — "aquí estoy", y de paso: ¿quién más?
 *
 * Es también el latido: el frente lo repite cada 30 segundos con el mismo
 * cuerpo. Un endpoint en vez de dos porque la respuesta que interesa —quién más
 * está— cambia con el tiempo y hay que refrescarla en cada latido de todos
 * modos.
 */
router.post(
  '/entrar',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.entrar(
      companyId(req), usuario(req),
      req.body?.recurso, req.body?.recursoId
    );
    res.json({ success: true, data });
  })
);

/** POST /presencia/salir — cerró la pantalla */
router.post(
  '/salir',
  asyncHandler(async (req: Request, res: Response) => {
    await service.salir(
      companyId(req), usuario(req).userId,
      String(req.body?.recurso || ''), String(req.body?.recursoId || '')
    );
    res.json({ success: true });
  })
);

/** GET /presencia/:recurso/:recursoId — sólo mirar, sin anunciarse */
router.get(
  '/:recurso/:recursoId',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.quienEsta(
      companyId(req), req.params.recurso, req.params.recursoId,
      usuario(req).userId
    );
    res.json({ success: true, data });
  })
);

export default router;
