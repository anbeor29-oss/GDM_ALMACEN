/**
 * /vigencias — vencimiento del sello (CSD) y la e.firma de la empresa en sesión.
 *  GET /vigencias   → { sellos[], minDias, nivel: OK|AVISO|DIARIO|BLOQUEO }
 */
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { authenticateToken } from '../../middleware/authentication';
import * as vigencias from './vigencias.service';

const router = Router();
router.use(authenticateToken);

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) { res.json({ success: true, data: { sellos: [], minDias: null, nivel: 'OK' } }); return; }
  res.json({ success: true, data: await vigencias.estadoVigencias(companyId) });
}));

export default router;
