/**
 * /ecommerce — módulo Comercio Electrónico (rebanada 1: base + aislamiento).
 *
 * Plan completo en docs/ECOMMERCE_PLAN.md. Por ahora sólo expone el ESTADO del
 * módulo para confirmar el gating de punta a punta: estas rutas se montan con
 * `gated('ecommerce')` (authenticateToken + requireModule('ecommerce')), así que
 * sólo entran usuarios de una empresa con `modulos_habilitados` que incluya
 * `ecommerce` (o SUPER_ADMIN). Las tablas `ec_*` y la operación real llegan en las
 * siguientes rebanadas.
 */
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';

const router = Router();

/** GET /ecommerce/estado — salud del módulo + contadores (placeholder rebanada 1). */
router.get('/estado', asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      modulo: 'ecommerce',
      etapa: 'rebanada-1 (base + aislamiento)',
      companyId: req.user?.companyId || null,
      tiendas: 0,
      pedidos: 0,
    },
  });
}));

export default router;
