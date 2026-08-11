/**
 * /mensajes — recados entre usuarios de la misma empresa.
 *
 * Sin `requireCapability` ni `requireModule`: mandar un recado no es un
 * privilegio de nadie. El cajero tiene que poder avisarle al de compras que se
 * acabó algo, y el de compras contestarle. La única frontera es la empresa, y
 * la impone el servicio en cada consulta.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as service from './mensajes.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}
const userId = (req: Request) => String(req.user?.userId);

/** GET /mensajes — bandeja (recibidos por omisión) */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const mensajes = await service.bandeja(companyId(req), userId(req), {
      buzon: req.query.buzon === 'enviados' ? 'enviados' : 'recibidos',
      soloNoLeidos: req.query.soloNoLeidos === 'true',
    });
    res.json({ success: true, data: { mensajes } });
  })
);

/** GET /mensajes/no-leidos — el número del menú */
router.get(
  '/no-leidos',
  asyncHandler(async (req: Request, res: Response) => {
    const n = await service.noLeidos(companyId(req), userId(req));
    res.json({ success: true, data: { noLeidos: n } });
  })
);

/** GET /mensajes/destinatarios — a quién le puedo escribir */
router.get(
  '/destinatarios',
  asyncHandler(async (req: Request, res: Response) => {
    const usuarios = await service.destinatarios(companyId(req), userId(req));
    res.json({ success: true, data: { usuarios } });
  })
);

/** POST /mensajes — mandar */
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const m = await service.enviar(companyId(req), userId(req), {
      paraUserId: req.body?.paraUserId,
      asunto:     req.body?.asunto,
      cuerpo:     req.body?.cuerpo,
      respondeA:  req.body?.respondeA,
    });
    res.status(201).json({ success: true, data: m });
  })
);

/** POST /mensajes/:id/leido */
router.post(
  '/:id/leido',
  asyncHandler(async (req: Request, res: Response) => {
    const r = await service.marcarLeido(companyId(req), userId(req), req.params.id);
    res.json({ success: true, data: r });
  })
);

/** POST /mensajes/leer-todo */
router.post(
  '/leer-todo',
  asyncHandler(async (req: Request, res: Response) => {
    const n = await service.marcarTodoLeido(companyId(req), userId(req));
    res.json({ success: true, data: { marcados: n } });
  })
);

export default router;
