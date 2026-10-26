/**
 * /storefront — API PÚBLICA del storefront (rebanada 4). SIN login.
 *
 * Es la tienda que ve el COMPRADOR, acotada por el slug. El cockpit del merchant
 * va aparte en /ecommerce (gated con requireModule('ecommerce')). Aquí NO hay
 * auth: cualquiera puede ver el catálogo y hacer un pedido de una tienda activa.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import * as sf from './ecommerce-storefront.service';

const router = Router();

/** GET /storefront/:slug — datos públicos de la tienda (branding + políticas). */
router.get('/:slug', asyncHandler(async (req, res) => {
  const t = await sf.tiendaPorSlug(req.params.slug);
  res.json({
    success: true,
    data: {
      id: t.id, nombre: t.nombre, slug: t.slug, moneda: t.moneda, logoUrl: t.logo_url,
      colorPrimario: t.color_primario, colorSecundario: t.color_secundario,
      politicas: {
        envio: t.politica_envio, devolucion: t.politica_devolucion,
        privacidad: t.politica_privacidad, terminos: t.terminos,
      },
    },
  });
}));

/** GET /storefront/:slug/productos — catálogo publicado (con precio y disponible). */
router.get('/:slug/productos', asyncHandler(async (req, res) => {
  const t = await sf.tiendaPorSlug(req.params.slug);
  const productos = await sf.catalogoPublico(t, {
    search: req.query.search ? String(req.query.search) : undefined,
  });
  res.json({ success: true, data: { productos } });
}));

/** POST /storefront/:slug/pedido — crea el pedido y reserva el stock. */
router.post('/:slug/pedido', asyncHandler(async (req, res) => {
  const t = await sf.tiendaPorSlug(req.params.slug);
  const r = await sf.crearPedido(t, req.body || {});
  res.status(201).json({ success: true, data: r, message: `Pedido ${r.numero} recibido.` });
}));

export default router;
