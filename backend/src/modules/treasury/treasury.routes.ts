/**
 * /treasury — programación de pagos a proveedores (Fase 6 ALMACEN).
 *
 *  Lectura: cualquier usuario de la empresa.
 *  Pagar / reprogramar / cancelar / alta manual: ADMIN, MANAGER.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, requireCapability } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as service from './treasury.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

/** GET /treasury/payments — lista de pagos programados */
router.get(
  '/payments',
  asyncHandler(async (req: Request, res: Response) => {
    const payments = await service.listPayments(companyId(req), {
      status: req.query.status as any,
      supplierId: req.query.supplierId as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
    });
    res.json({ success: true, data: { payments } });
  })
);

/** GET /treasury/summary — KPIs (vencido / esta semana / pendiente total) */
router.get(
  '/summary',
  asyncHandler(async (req: Request, res: Response) => {
    const summary = await service.getSummary(companyId(req));
    res.json({ success: true, data: summary });
  })
);

/** POST /treasury/payments — alta manual */
router.post(
  '/payments',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.createManual(companyId(req), req.body);
    res.status(201).json({ success: true, data: result });
  })
);

/** POST /treasury/payments/:id/pay — marcar pagado (libera crédito) */
router.post(
  '/payments/:id/pay',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.markPaid(companyId(req), req.params.id, {
      paidAt: req.body?.paidAt,
      notes: req.body?.notes,
    });
    res.json({ success: true, data: result });
  })
);

/** PUT /treasury/payments/:id/reschedule — cambiar fecha de vencimiento */
router.put(
  '/payments/:id/reschedule',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.reschedule(companyId(req), req.params.id, req.body?.dueDate);
    res.json({ success: true, data: result });
  })
);

/** POST /treasury/payments/:id/cancel — cancelar pago (libera crédito) */
router.post(
  '/payments/:id/cancel',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.cancelPayment(companyId(req), req.params.id, req.body?.motivo);
    res.json({ success: true, data: result });
  })
);

export default router;
