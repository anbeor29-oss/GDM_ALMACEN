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
import * as remesas from './remesas.service';

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
      sinRemesa: req.query.sinRemesa === 'true',
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

/* ═══════════════ REMESAS — la lista del viernes para el lunes ═══════════════ */

/** GET /treasury/payment-runs — corridas con sus totales */
router.get(
  '/payment-runs',
  asyncHandler(async (req: Request, res: Response) => {
    const runs = await remesas.listarRemesas(companyId(req), {
      from:   req.query.from as string | undefined,
      to:     req.query.to as string | undefined,
      status: req.query.status as string | undefined,
    });
    res.json({ success: true, data: { runs } });
  })
);

/** GET /treasury/payment-runs/:id — el reporte que se lleva al banco */
router.get(
  '/payment-runs/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await remesas.detalleRemesa(companyId(req), req.params.id);
    res.json({ success: true, data });
  })
);

/** POST /treasury/payment-runs — arma la remesa con las facturas elegidas */
router.post(
  '/payment-runs',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await remesas.crearRemesa(companyId(req), {
      paymentDate: req.body?.paymentDate,
      notes:       req.body?.notes,
      paymentIds:  req.body?.paymentIds,
    }, { userId: req.user?.userId, email: req.user?.email });
    res.status(201).json({ success: true, data: result });
  })
);

/** POST /treasury/payment-runs/:id/payments — agregar más facturas */
router.post(
  '/payment-runs/:id/payments',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await remesas.agregarPagosARemesa(
      companyId(req), req.params.id, req.body?.paymentIds || []
    );
    res.json({ success: true, data: result });
  })
);

/** DELETE /treasury/payment-runs/:id/payments/:paymentId — sacar una factura */
router.delete(
  '/payment-runs/:id/payments/:paymentId',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await remesas.quitarPagoDeRemesa(
      companyId(req), req.params.id, req.params.paymentId
    );
    res.json({ success: true, data: result });
  })
);

/** PUT /treasury/payment-runs/:id/status — autorizar, pagar o cancelar */
router.put(
  '/payment-runs/:id/status',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const status = String(req.body?.status || '').toUpperCase() as remesas.EstadoRemesa;
    if (!status) throw new ValidationError('status es obligatorio');
    const result = await remesas.cambiarEstadoRemesa(
      companyId(req), req.params.id, status,
      { userId: req.user?.userId, email: req.user?.email }
    );
    res.json({ success: true, data: result });
  })
);

export default router;
