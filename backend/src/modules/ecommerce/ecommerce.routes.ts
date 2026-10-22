/**
 * /ecommerce — módulo Comercio Electrónico.
 *
 * Plan en docs/ECOMMERCE_PLAN.md. Estas rutas se montan con `gated('ecommerce')`
 * (authenticateToken + requireModule('ecommerce')), así que sólo entran usuarios de
 * una empresa con `modulos_habilitados` que incluya `ecommerce` (o SUPER_ADMIN).
 *
 * Rebanada 1: /estado. Rebanada 2: CRUD de TIENDAS.
 */
import { Router, Request, Response } from 'express';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as tiendas from './ecommerce-tiendas.service';

const router = Router();

/** La empresa activa del usuario (el módulo es por empresa). */
function companyId(req: Request): string {
  const id = req.user?.companyId;
  if (!id) throw new ValidationError('Tu usuario no tiene empresa activa para operar la tienda.');
  return id;
}

/** GET /ecommerce/estado — salud del módulo + contadores. */
router.get('/estado', asyncHandler(async (req: Request, res: Response) => {
  const cid = req.user?.companyId || null;
  res.json({
    success: true,
    data: {
      modulo: 'ecommerce',
      etapa: 'rebanada-2 (tiendas)',
      companyId: cid,
      tiendas: cid ? await tiendas.contarTiendas(cid) : 0,
      pedidos: 0,
    },
  });
}));

/* ────────────────────────  TIENDAS  ──────────────────────── */
router.get('/tiendas', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: { tiendas: await tiendas.listarTiendas(companyId(req)) } });
}));

router.post('/tiendas', asyncHandler(async (req: Request, res: Response) => {
  const t = await tiendas.crearTienda(companyId(req), req.body);
  res.status(201).json({ success: true, data: t, message: `Tienda «${t.nombre}» creada.` });
}));

router.put('/tiendas/:id', asyncHandler(async (req: Request, res: Response) => {
  const t = await tiendas.actualizarTienda(companyId(req), req.params.id, req.body);
  res.json({ success: true, data: t });
}));

router.delete('/tiendas/:id', asyncHandler(async (req: Request, res: Response) => {
  const t = await tiendas.eliminarTienda(companyId(req), req.params.id);
  res.json({ success: true, message: `Tienda «${t.nombre}» dada de baja.` });
}));

export default router;
