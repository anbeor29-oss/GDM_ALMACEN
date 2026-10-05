/**
 * /admin/facturacion — cobro POR USUARIO (modelo nuevo), sólo SUPER_ADMIN.
 *
 *  GET   /admin/facturacion/config            precio por usuario, timbres incluidos, extra
 *  PUT   /admin/facturacion/config            actualiza (sube por INPC)
 *  POST  /admin/facturacion/generar           genera/refresca la lista de un periodo {periodo?}
 *  GET   /admin/facturacion/lista?periodo=     lee la lista (con totales)
 *  POST  /admin/facturacion/:id/pagar         marca un cargo como pagado (prepago recibido)
 *  POST  /admin/facturacion/:id/suspender     corta el servicio por falta de pago (día 5)
 *  POST  /admin/facturacion/:id/reactivar     levanta la suspensión
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler } from '../../middleware/errorHandler';
import { requireSuperAdmin, audit } from './admin.middleware';
import * as fact from '../billing/facturacion-usuarios.service';

const router = Router();
router.use(authenticateToken);
router.use(requireSuperAdmin);

/** Normaliza el periodo: acepta 'YYYY-MM' o 'YYYY-MM-DD', devuelve 'YYYY-MM-DD' (día 1). */
function normPeriodo(p?: string): string | undefined {
  if (!p) return undefined;
  if (/^\d{4}-\d{2}$/.test(p)) return `${p}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return `${p.slice(0, 7)}-01`;
  return undefined;
}

router.get('/config', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await fact.getConfig() });
}));

router.put('/config', asyncHandler(async (req: Request, res: Response) => {
  const data = await fact.setConfig({
    precioUsuario: req.body?.precioUsuario != null ? Number(req.body.precioUsuario) : undefined,
    timbresIncluidos: req.body?.timbresIncluidos != null ? Number(req.body.timbresIncluidos) : undefined,
    timbreExtra: req.body?.timbreExtra != null ? Number(req.body.timbreExtra) : undefined,
    timbresPorUsuario: req.body?.timbresPorUsuario != null ? Number(req.body.timbresPorUsuario) : undefined,
    timbreExtraPorUsuario: req.body?.timbreExtraPorUsuario != null ? Number(req.body.timbreExtraPorUsuario) : undefined,
  });
  await audit(req, { action: 'FACTURACION_CONFIG', targetKind: 'facturacion_config', payload: data });
  res.json({ success: true, data });
}));

router.post('/generar', asyncHandler(async (req: Request, res: Response) => {
  const periodo = normPeriodo(req.body?.periodo);
  const data = await fact.generarLista(periodo, req.user?.userId);
  await audit(req, { action: 'FACTURACION_GENERAR', targetKind: 'facturacion_periodo', payload: { periodo: data.periodo, empresas: data.totales.empresas } });
  res.json({ success: true, data });
}));

router.get('/lista', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await fact.getLista(normPeriodo(String(req.query.periodo || ''))) });
}));

/* Consolidado: todas las empresas agrupadas (prueba sin cobro / reales) + consumo. */
router.get('/consolidado', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await fact.resumenConsolidado(normPeriodo(String(req.query.periodo || ''))) });
}));

router.post('/:id/pagar', asyncHandler(async (req: Request, res: Response) => {
  const data = await fact.marcarPagado(req.params.id, req.body?.facturaId);
  await audit(req, { action: 'FACTURACION_PAGAR', targetKind: 'facturacion_mensual', targetId: req.params.id });
  res.json({ success: true, data });
}));

router.post('/:id/suspender', asyncHandler(async (req: Request, res: Response) => {
  const data = await fact.suspender(req.params.id);
  await audit(req, { action: 'FACTURACION_SUSPENDER', targetKind: 'facturacion_mensual', targetId: req.params.id });
  res.json({ success: true, data });
}));

router.post('/:id/reactivar', asyncHandler(async (req: Request, res: Response) => {
  const data = await fact.reactivar(req.params.id);
  await audit(req, { action: 'FACTURACION_REACTIVAR', targetKind: 'facturacion_mensual', targetId: req.params.id });
  res.json({ success: true, data });
}));

export default router;
