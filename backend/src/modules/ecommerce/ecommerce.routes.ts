/**
 * /ecommerce — módulo Comercio Electrónico.
 *
 * Plan en docs/ECOMMERCE_PLAN.md. Rutas montadas con `gated('ecommerce')`
 * (authenticateToken + requireModule('ecommerce')): sólo entran usuarios de una
 * empresa con `modulos_habilitados` que incluya `ecommerce` (o SUPER_ADMIN).
 *
 * R1 /estado · R2 TIENDAS · R3 PRODUCTOS e INVENTARIO embebidos (reusan los servicios
 * del ERP) + CATÁLOGO WEB.
 */
import { Router, Request, Response } from 'express';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import * as tiendas from './ecommerce-tiendas.service';
import * as catalogo from './ecommerce-catalogo.service';
import * as productsService from '../products/products.service';

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
      modulo: 'ecommerce', etapa: 'rebanada-4 (storefront público + pedidos)',
      companyId: cid,
      tiendas: cid ? await tiendas.contarTiendas(cid) : 0,
      publicados: cid ? await catalogo.contarPublicados(cid) : 0,
      pedidos: cid ? Number((await query(`SELECT COUNT(*)::int AS n FROM ec_order WHERE company_id=$1`, [cid])).rows[0]?.n || 0) : 0,
    },
  });
}));

/* ────────────────────────  TIENDAS  ──────────────────────── */
router.get('/tiendas', asyncHandler(async (req, res) => {
  res.json({ success: true, data: { tiendas: await tiendas.listarTiendas(companyId(req)) } });
}));
router.post('/tiendas', asyncHandler(async (req, res) => {
  const t = await tiendas.crearTienda(companyId(req), req.body);
  res.status(201).json({ success: true, data: t, message: `Tienda «${t.nombre}» creada.` });
}));
router.put('/tiendas/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await tiendas.actualizarTienda(companyId(req), req.params.id, req.body) });
}));
router.delete('/tiendas/:id', asyncHandler(async (req, res) => {
  const t = await tiendas.eliminarTienda(companyId(req), req.params.id);
  res.json({ success: true, message: `Tienda «${t.nombre}» dada de baja.` });
}));

/* ──────────  PRODUCTOS (embebido: reusa el servicio de productos del ERP)  ────────── */
router.get('/productos', asyncHandler(async (req, res) => {
  const r = await productsService.listProducts(companyId(req), {
    search: req.query.search ? String(req.query.search) : undefined,
    active: req.query.active === 'false' ? false : true,
    limit: Math.min(Number(req.query.limit) || 100, 500),
    offset: Number(req.query.offset) || 0,
    sortBy: 'name', sortOrder: 'ASC',
  });
  res.json({ success: true, data: r });
}));
router.post('/productos', asyncHandler(async (req, res) => {
  const p = await productsService.createProduct(companyId(req), req.body);
  res.status(201).json({ success: true, data: p });
}));
router.put('/productos/:id', asyncHandler(async (req, res) => {
  const p = await productsService.updateProduct(companyId(req), req.params.id, req.body);
  res.json({ success: true, data: p });
}));
router.delete('/productos/:id', asyncHandler(async (req, res) => {
  await productsService.deleteProduct(companyId(req), req.params.id);
  res.json({ success: true, message: 'Producto dado de baja.' });
}));

/* ──────────  INVENTARIO (embebido, lectura): existencias por almacén  ────────── */
router.get('/inventario', asyncHandler(async (req, res) => {
  const cid = companyId(req);
  const params: any[] = [cid];
  let filtroBusq = '';
  if (req.query.search) { params.push(`%${String(req.query.search)}%`); filtroBusq = `AND (p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`; }
  const r = await query<any>(
    `SELECT p.id AS product_id, p.sku, p.name, w.id AS warehouse_id, w.name AS almacen,
            ws.quantity::float AS existencia, ws.avg_cost::float AS costo_promedio
       FROM warehouse_stock ws
       JOIN products p   ON p.id = ws.product_id AND p.deleted_at IS NULL
       JOIN warehouses w ON w.id = ws.warehouse_id
      WHERE p.company_id = $1 ${filtroBusq}
      ORDER BY p.name, w.name`, params);
  res.json({ success: true, data: { renglones: r.rows } });
}));

/* ──────────  CATÁLOGO WEB  ────────── */
router.get('/catalogo', asyncHandler(async (req, res) => {
  res.json({ success: true, data: { catalogo: await catalogo.listarCatalogo(companyId(req), {
    search: req.query.search ? String(req.query.search) : undefined,
    soloPublicados: req.query.publicados === 'true',
  }) } });
}));
router.put('/catalogo/:productId', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await catalogo.guardarWeb(companyId(req), req.params.productId, req.body) });
}));
router.post('/catalogo/:productId/publicar', asyncHandler(async (req, res) => {
  const d = await catalogo.togglePublicado(companyId(req), req.params.productId, req.body?.publicado !== false);
  res.json({ success: true, data: d });
}));

export default router;
