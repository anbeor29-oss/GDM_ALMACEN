/**
 * ecommerce-storefront.service — STOREFRONT PÚBLICO (rebanada 4).
 *
 * La tienda que ve el COMPRADOR: SIN login, acotada por el slug de la tienda.
 * Lee el catálogo PUBLICADO (ec_product_channel) sobre los productos reales y
 * crea el pedido (ec_order) RESERVANDO el stock de forma transaccional contra
 * warehouse_stock − reservas activas (evita sobreventa). El cobro (pasarela) y
 * el paso pedido→CFDI→póliza llegan en la rebanada 5.
 */
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';

const IVA_DEFAULT = 0.16;
const MIN_RESERVA = 60; // minutos que vive la reserva sin pago

export interface TiendaPublica {
  id: string; company_id: string; nombre: string; slug: string; moneda: string;
  logo_url: string | null; color_primario: string; color_secundario: string;
  politica_envio: string | null; politica_devolucion: string | null;
  politica_privacidad: string | null; terminos: string | null;
}

/** Resuelve la tienda por su slug. Pública: sólo tiendas vivas y activas. */
export async function tiendaPorSlug(slug: string): Promise<TiendaPublica> {
  const r = await query<any>(
    `SELECT id, company_id, nombre, slug, moneda, logo_url, color_primario, color_secundario,
            politica_envio, politica_devolucion, politica_privacidad, terminos
       FROM ec_store
      WHERE lower(slug) = lower($1) AND activa = TRUE AND deleted_at IS NULL
      LIMIT 1`, [String(slug || '').trim()]);
  if (!r.rows[0]) throw new NotFoundError('Tienda no encontrada.');
  return r.rows[0];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
function tasaDe(p: { is_exempt?: boolean; tax_rate?: any }): number {
  if (p.is_exempt) return 0;
  const t = Number(p.tax_rate);
  return Number.isFinite(t) && t >= 0 ? t : IVA_DEFAULT;
}

/** Catálogo publicado de la tienda, con precio efectivo y stock disponible.
 *  `opts.categoria` = slug de categoría para filtrar esa sección. */
export async function catalogoPublico(store: TiendaPublica, opts: { search?: string; categoria?: string } = {}) {
  const params: any[] = [store.company_id];
  const filtros = ['p.company_id = $1', 'p.deleted_at IS NULL', 'p.is_active = TRUE', 'c.publicado = TRUE'];
  if (opts.search) {
    params.push(`%${opts.search}%`);
    filtros.push(`(COALESCE(c.titulo_web,p.name) ILIKE $${params.length} OR p.sku ILIKE $${params.length})`);
  }
  if (opts.categoria) {
    params.push(String(opts.categoria).toLowerCase());
    filtros.push(`lower(cat.slug) = $${params.length} AND cat.activa = TRUE`);
  }
  const r = await query<any>(
    `SELECT p.id AS product_id, p.sku,
            COALESCE(c.titulo_web, p.name) AS nombre, c.descripcion_web, c.destacado,
            COALESCE(c.precio_web, p.base_price)::float AS precio,
            COALESCE(p.tax_rate,0)::float AS tax_rate, COALESCE(p.is_exempt,false) AS is_exempt,
            c.category_id, cat.slug AS categoria_slug, cat.nombre AS categoria_nombre,
            (SELECT COUNT(*) FROM warehouse_stock ws WHERE ws.product_id=p.id)::int AS filas_stock,
            COALESCE((SELECT SUM(ws.quantity) FROM warehouse_stock ws WHERE ws.product_id=p.id),0)::float AS fisico,
            COALESCE((SELECT SUM(rv.cantidad) FROM ec_inventory_reservation rv
                       WHERE rv.product_id=p.id AND rv.estado='ACTIVA'
                         AND (rv.expira_at IS NULL OR rv.expira_at > NOW())),0)::float AS reservado,
            (SELECT m.id FROM ec_product_media m WHERE m.product_id=p.id ORDER BY m.orden, m.created_at LIMIT 1) AS media_id
       FROM products p
       JOIN ec_product_channel c ON c.product_id = p.id
       LEFT JOIN ec_category cat ON cat.id = c.category_id
      WHERE ${filtros.join(' AND ')}
      ORDER BY c.destacado DESC, c.orden, COALESCE(c.titulo_web, p.name)`, params);
  return r.rows.map((x: any) => {
    const tasa = tasaDe(x);
    // Sin filas de stock = producto no inventariado (servicio) → sin tope.
    const rastreado = Number(x.filas_stock) > 0;
    const disponible = rastreado ? Math.max(0, Math.floor(Number(x.fisico) - Number(x.reservado))) : null;
    return {
      productId: x.product_id, sku: x.sku, nombre: x.nombre, descripcion: x.descripcion_web,
      precio: r2(x.precio), tasaIva: tasa, precioConIva: r2(x.precio * (1 + tasa)),
      destacado: !!x.destacado, rastreado, disponible,
      imagenId: x.media_id || null,
      categoriaId: x.category_id || null, categoriaSlug: x.categoria_slug || null, categoriaNombre: x.categoria_nombre || null,
    };
  });
}

/** Categorías ACTIVAS de la tienda que tienen al menos un producto PUBLICADO y a la
 *  venta (para pintar el filtro del storefront). Ordenadas como en el cockpit. */
export async function categoriasPublicas(store: TiendaPublica) {
  const r = await query<any>(
    `SELECT cat.id, cat.nombre, cat.slug, COUNT(*)::int AS productos
       FROM ec_category cat
       JOIN ec_product_channel c ON c.category_id = cat.id AND c.publicado = TRUE
       JOIN products p ON p.id = c.product_id AND p.deleted_at IS NULL AND p.is_active = TRUE
      WHERE cat.company_id = $1 AND cat.activa = TRUE
      GROUP BY cat.id
      ORDER BY cat.orden, cat.nombre`, [store.company_id]);
  return r.rows.map((x: any) => ({ id: x.id, nombre: x.nombre, slug: x.slug, productos: Number(x.productos) }));
}

interface ItemPedido { productId: string; cantidad: number; }

/** Crea el pedido y RESERVA el stock en una sola transacción (sin sobreventa). */
export async function crearPedido(
  store: TiendaPublica,
  datos: {
    cliente: { nombre: string; email?: string; telefono?: string; direccion?: string; cp?: string };
    items: ItemPedido[]; notas?: string;
  },
) {
  const nombre = String(datos?.cliente?.nombre || '').trim();
  if (!nombre) throw new ValidationError('Captura tu nombre para el pedido.');
  const items = (datos?.items || []).filter((i) => i && i.productId && Number(i.cantidad) > 0);
  if (!items.length) throw new ValidationError('Tu carrito está vacío.');

  return transaction(async (client) => {
    let subtotal = 0, ivaTotal = 0;
    const renglones: any[] = [];

    for (const it of items) {
      const cantidad = Number(it.cantidad);
      const pr = await transactionQuery<any>(client,
        `SELECT p.id, p.sku, COALESCE(c.titulo_web,p.name) AS nombre,
                COALESCE(c.precio_web,p.base_price)::float AS precio,
                COALESCE(p.tax_rate,0)::float AS tax_rate, COALESCE(p.is_exempt,false) AS is_exempt
           FROM products p JOIN ec_product_channel c ON c.product_id=p.id
          WHERE p.id=$1 AND p.company_id=$2 AND p.deleted_at IS NULL AND p.is_active=TRUE AND c.publicado=TRUE`,
        [it.productId, store.company_id]);
      const p = pr.rows[0];
      if (!p) throw new ValidationError('Un producto del carrito ya no está disponible. Revísalo.');

      // Candado de sobreventa: se BLOQUEAN las filas de stock del producto (FOR
      // UPDATE) para serializar checkouts simultáneos. Si no hay filas, es un
      // producto no inventariado (servicio) y no se topa ni se reserva.
      const lockR = await transactionQuery<any>(client,
        `SELECT quantity FROM warehouse_stock WHERE product_id=$1 FOR UPDATE`, [p.id]);
      const rastreado = lockR.rows.length > 0;
      if (rastreado) {
        const fisico = lockR.rows.reduce((a: number, row: any) => a + Number(row.quantity), 0);
        const resvR = await transactionQuery<any>(client,
          `SELECT COALESCE(SUM(cantidad),0)::float AS reservado
             FROM ec_inventory_reservation
            WHERE product_id=$1 AND estado='ACTIVA' AND (expira_at IS NULL OR expira_at > NOW())`, [p.id]);
        const disponible = fisico - Number(resvR.rows[0].reservado);
        if (disponible < cantidad) {
          throw new ValidationError(`«${p.nombre}»: sólo quedan ${Math.max(0, Math.floor(disponible))} disponible(s).`);
        }
      }

      const tasa = tasaDe(p);
      const importe = r2(p.precio * cantidad);
      const iva = r2(importe * tasa);
      subtotal = r2(subtotal + importe);
      ivaTotal = r2(ivaTotal + iva);
      renglones.push({ productId: p.id, sku: p.sku, nombre: p.nombre, cantidad, precioUnit: r2(p.precio), tasa, importe, iva, rastreado });
    }

    const total = r2(subtotal + ivaTotal);

    // Folio por tienda (WEB-000001). La unicidad la garantiza ux_ec_order_numero.
    const cnt = await transactionQuery<any>(client,
      `SELECT COUNT(*)::int AS n FROM ec_order WHERE store_id=$1`, [store.id]);
    const numero = `WEB-${String(Number(cnt.rows[0].n) + 1).padStart(6, '0')}`;

    const ped = await transactionQuery<any>(client,
      `INSERT INTO ec_order
         (company_id, store_id, numero, estado, cliente_nombre, cliente_email, cliente_telefono,
          envio_direccion, envio_cp, notas, moneda, subtotal, iva, total)
       VALUES ($1,$2,$3,'PENDIENTE_PAGO',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, numero, estado, total`,
      [store.company_id, store.id, numero, nombre,
       datos.cliente.email || null, datos.cliente.telefono || null,
       datos.cliente.direccion || null, datos.cliente.cp || null, datos.notas || null,
       store.moneda, subtotal, ivaTotal, total]);
    const orderId = ped.rows[0].id;

    const expira = new Date(Date.now() + MIN_RESERVA * 60_000);
    for (const l of renglones) {
      await transactionQuery(client,
        `INSERT INTO ec_order_item (order_id, product_id, sku, nombre, cantidad, precio_unit, tasa_iva, importe, iva)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [orderId, l.productId, l.sku, l.nombre, l.cantidad, l.precioUnit, l.tasa, l.importe, l.iva]);
      if (l.rastreado) {
        await transactionQuery(client,
          `INSERT INTO ec_inventory_reservation (company_id, store_id, order_id, product_id, cantidad, estado, expira_at)
           VALUES ($1,$2,$3,$4,$5,'ACTIVA',$6)`,
          [store.company_id, store.id, orderId, l.productId, l.cantidad, expira]);
      }
    }

    return {
      orderId, numero, estado: ped.rows[0].estado, total: Number(ped.rows[0].total), moneda: store.moneda,
      lineas: renglones.map((l) => ({ nombre: l.nombre, cantidad: l.cantidad, precioConIva: r2(l.precioUnit * (1 + l.tasa)) })),
    };
  });
}
