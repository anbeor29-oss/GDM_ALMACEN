/**
 * /autofactura — Autofacturación (Anexo 20 / RMF 2.7.3).
 *
 * Se monta con `gated('contabilidad')` (authenticateToken + requireModule) en
 * app.ts, así que aquí req.user ya viene resuelto. Es comprobación de erogaciones
 * a enajenantes que no facturan (sector primario, etc.), y vive junto a las
 * pólizas de compra en Contabilidad.
 */
import { Router, Request, Response } from 'express';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as svc from './autofactura.service';

const router = Router();

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

/* ── Enajenantes ── */
router.get('/enajenantes', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await svc.listarEnajenantes(companyId(req)) });
}));
router.post('/enajenantes', asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ success: true, data: await svc.crearEnajenante(companyId(req), req.body) });
}));
router.put('/enajenantes/:id', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await svc.actualizarEnajenante(companyId(req), req.params.id, req.body) });
}));
router.delete('/enajenantes/:id', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await svc.borrarEnajenante(companyId(req), req.params.id) });
}));

/* ── Comprobantes (erogaciones) ── */
router.get('/comprobantes', asyncHandler(async (req: Request, res: Response) => {
  const anio = req.query.anio ? Number(req.query.anio) : undefined;
  const mes = req.query.mes ? Number(req.query.mes) : undefined;
  res.json({ success: true, data: await svc.listarComprobantes(companyId(req), anio, mes) });
}));
router.get('/comprobantes/:id', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await svc.obtenerComprobante(companyId(req), req.params.id) });
}));
router.post('/comprobantes', asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ success: true, data: await svc.crearComprobante(companyId(req), req.body) });
}));
router.delete('/comprobantes/:id', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await svc.borrarComprobante(companyId(req), req.params.id) });
}));
/* Timbrado: gated (rol SAT de adquirente + PAC de adquirentes). Ver el servicio. */
router.post('/comprobantes/:id/timbrar', asyncHandler(async (req: Request, res: Response) => {
  await svc.timbrarComprobante(companyId(req), req.params.id);
  res.json({ success: true });
}));

export default router;
