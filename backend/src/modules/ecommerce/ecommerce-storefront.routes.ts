/**
 * /storefront — API PÚBLICA del storefront (rebanada 4). SIN login.
 *
 * Es la tienda que ve el COMPRADOR, acotada por el slug. El cockpit del merchant
 * va aparte en /ecommerce (gated con requireModule('ecommerce')). Aquí NO hay
 * auth: cualquiera puede ver el catálogo y hacer un pedido de una tienda activa.
 */
import { Router, Request } from 'express';
import { asyncHandler, UnauthorizedError } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import logger from '../../middleware/logger';
import * as sf from './ecommerce-storefront.service';
import type { TiendaPublica } from './ecommerce-storefront.service';
import { metodosPublicos } from './ecommerce-envios.service';
import { buscarCupon, validarCupon } from './ecommerce-cupones.service';
import * as compradores from './ecommerce-compradores.service';
import { obtenerImagen } from './ecommerce-media.service';
import { mpConfigurado, crearPreferencia } from './ec-mercadopago.service';
import { procesarPagoMP } from './ec-fulfillment.service';

const router = Router();

/** Lee el token de comprador del header Authorization y devuelve su id si es válido
 *  PARA ESTA tienda (un token de otra tienda no cuenta). null si no hay sesión. */
function compradorDeReq(req: Request, store: TiendaPublica): string | null {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const t = compradores.verificarTokenComprador(m[1]);
    return t.storeId === store.id ? t.buyerId : null;
  } catch { return null; }
}
/** Exige sesión de comprador (perfil/pedidos). */
function requiereComprador(req: Request, store: TiendaPublica): string {
  const id = compradorDeReq(req, store);
  if (!id) throw new UnauthorizedError('Inicia sesión para ver tu cuenta.');
  return id;
}

/** Base pública del storefront para los back_urls de la pasarela. */
const STOREFRONT_PUBLIC = (process.env.STOREFRONT_PUBLIC_URL || 'https://hcgm.com.mx/erp').replace(/\/+$/, '');

/** GET /storefront/img/:mediaId — imagen pública de un producto (para <img src>). */
router.get('/img/:mediaId', asyncHandler(async (req, res) => {
  const img = await obtenerImagen(req.params.mediaId);
  if (!img) { res.status(404).end(); return; }
  res.set('Content-Type', img.contentType);
  res.set('Cache-Control', 'public, max-age=86400, immutable');
  res.send(img.buffer);
}));

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

/** GET /storefront/:slug/categorias — secciones activas con productos publicados. */
router.get('/:slug/categorias', asyncHandler(async (req, res) => {
  const t = await sf.tiendaPorSlug(req.params.slug);
  res.json({ success: true, data: { categorias: await sf.categoriasPublicas(t) } });
}));

/** GET /storefront/:slug/envios — métodos de envío activos de la tienda. */
router.get('/:slug/envios', asyncHandler(async (req, res) => {
  const t = await sf.tiendaPorSlug(req.params.slug);
  res.json({ success: true, data: { metodos: await metodosPublicos(t.id) } });
}));

/** POST /storefront/:slug/cupon — valida un cupón contra el total (con IVA) del carrito.
 *  Es una vista previa: al crear el pedido se re-valida de forma autoritativa. */
router.post('/:slug/cupon', asyncHandler(async (req, res) => {
  const t = await sf.tiendaPorSlug(req.params.slug);
  const codigo = String(req.body?.codigo || '').trim();
  const total = Number(req.body?.total) || 0;
  if (!codigo) { res.json({ success: true, data: { valido: false, mensaje: 'Captura el código del cupón.' } }); return; }
  const cup = await buscarCupon(t.company_id, codigo);
  if (!cup) { res.json({ success: true, data: { valido: false, mensaje: 'El cupón no existe.' } }); return; }
  const v = validarCupon(cup, total);
  res.json({
    success: true,
    data: v.ok ? { valido: true, codigo: cup.codigo, descuento: v.descuento } : { valido: false, mensaje: v.motivo },
  });
}));

/** GET /storefront/:slug/productos — catálogo publicado (con precio y disponible).
 *  `?categoria=<slug>` filtra a esa sección. */
router.get('/:slug/productos', asyncHandler(async (req, res) => {
  const t = await sf.tiendaPorSlug(req.params.slug);
  const productos = await sf.catalogoPublico(t, {
    search: req.query.search ? String(req.query.search) : undefined,
    categoria: req.query.categoria ? String(req.query.categoria) : undefined,
  });
  res.json({ success: true, data: { productos } });
}));

/* ──────────  CUENTAS DE COMPRADOR (rebanada 10)  ────────── */
/** POST /storefront/:slug/cuenta/registro — crea la cuenta y devuelve su token. */
router.post('/:slug/cuenta/registro', asyncHandler(async (req, res) => {
  const t = await sf.tiendaPorSlug(req.params.slug);
  res.status(201).json({ success: true, data: await compradores.registrar(t, req.body || {}) });
}));
/** POST /storefront/:slug/cuenta/login — inicia sesión y devuelve su token. */
router.post('/:slug/cuenta/login', asyncHandler(async (req, res) => {
  const t = await sf.tiendaPorSlug(req.params.slug);
  res.json({ success: true, data: await compradores.login(t, req.body || {}) });
}));
/** GET /storefront/:slug/cuenta/perfil — datos del comprador (requiere sesión). */
router.get('/:slug/cuenta/perfil', asyncHandler(async (req, res) => {
  const t = await sf.tiendaPorSlug(req.params.slug);
  res.json({ success: true, data: { comprador: await compradores.perfil(requiereComprador(req, t)) } });
}));
/** PUT /storefront/:slug/cuenta/perfil — actualiza sus datos (requiere sesión). */
router.put('/:slug/cuenta/perfil', asyncHandler(async (req, res) => {
  const t = await sf.tiendaPorSlug(req.params.slug);
  res.json({ success: true, data: { comprador: await compradores.actualizarPerfil(requiereComprador(req, t), req.body || {}) } });
}));
/** GET /storefront/:slug/cuenta/pedidos — historial del comprador (requiere sesión). */
router.get('/:slug/cuenta/pedidos', asyncHandler(async (req, res) => {
  const t = await sf.tiendaPorSlug(req.params.slug);
  res.json({ success: true, data: { pedidos: await compradores.misPedidos(requiereComprador(req, t)) } });
}));

/** POST /storefront/:slug/pedido — crea el pedido y reserva el stock. Si Mercado
 *  Pago está configurado, además crea la preferencia y devuelve la URL de pago. */
router.post('/:slug/pedido', asyncHandler(async (req, res) => {
  const t = await sf.tiendaPorSlug(req.params.slug);
  // Si el comprador tiene sesión, se liga el pedido a su cuenta (historial).
  const buyerId = compradorDeReq(req, t);
  const r = await sf.crearPedido(t, { ...(req.body || {}), buyerId: buyerId || undefined });

  let checkoutUrl: string | null = null;
  if (mpConfigurado()) {
    const tienda = `${STOREFRONT_PUBLIC}/t/${encodeURIComponent(t.slug)}`;
    const webhook = `${req.protocol}://${req.get('host')}/api/v1/storefront/webhook/mercadopago`;
    const pref = await crearPreferencia({
      orderId: r.orderId, numero: r.numero, moneda: r.moneda, items: r.lineas,
      backUrls: { success: tienda, failure: tienda, pending: tienda },
      notificationUrl: webhook,
    });
    if (pref) {
      checkoutUrl = pref.initPoint;
      await query(
        `INSERT INTO ec_payment_transaction (company_id, store_id, order_id, proveedor, estado, monto, moneda, preference_id)
         VALUES ($1,$2,$3,'mercadopago','PENDIENTE',$4,$5,$6)`,
        [t.company_id, t.id, r.orderId, r.total, r.moneda, pref.preferenceId]).catch(() => { /* best-effort */ });
    }
  }

  res.status(201).json({
    success: true,
    data: { numero: r.numero, estado: r.estado, total: r.total, moneda: r.moneda, checkoutUrl },
    message: `Pedido ${r.numero} recibido.`,
  });
}));

/** Webhook de Mercado Pago. Se responde 200 de inmediato y se procesa en segundo
 *  plano (confirmando el pago contra MP). GET sirve para la validación de MP. */
router.get('/webhook/mercadopago', (_req, res) => res.status(200).json({ ok: true }));
router.post('/webhook/mercadopago', (req, res) => {
  const paymentId = String((req.query['data.id'] as string) || req.body?.data?.id || req.query.id || '');
  const tipo = String(req.query.type || req.body?.type || req.body?.action || '');
  res.status(200).json({ ok: true });
  if (/payment/i.test(tipo) && paymentId) {
    procesarPagoMP(paymentId).catch((e) => logger.warn(`[webhook mp] ${e.message}`));
  }
});

export default router;
