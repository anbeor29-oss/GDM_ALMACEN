/**
 * ecommerce-catalogo.service — CATÁLOGO WEB (rebanada 3).
 *
 * Qué productos salen a la tienda y con qué contenido web. NO copia el producto: liga
 * `ec_product_channel` por `product_id` y, donde el campo web va NULL, el storefront usa
 * el dato del maestro (`products.name` / `base_price`). Todo acotado por `company_id`.
 */
import { query } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';

/** Lista TODOS los productos de la empresa con su estado web (publicado/precio web/…). */
export async function listarCatalogo(
  companyId: string, opts: { search?: string; soloPublicados?: boolean } = {},
) {
  const params: any[] = [companyId];
  const filtros = ['p.company_id = $1', 'p.deleted_at IS NULL'];
  if (opts.search) {
    params.push(`%${opts.search}%`);
    filtros.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR p.barcode ILIKE $${params.length})`);
  }
  if (opts.soloPublicados) filtros.push('c.publicado = TRUE');
  const r = await query<any>(
    `SELECT p.id AS product_id, p.sku, p.name, p.base_price::float AS base_price, p.barcode, p.is_active,
            COALESCE(c.publicado,false) AS publicado, COALESCE(c.destacado,false) AS destacado,
            c.precio_web::float AS precio_web, c.titulo_web, c.descripcion_web,
            c.seo_title, c.seo_description,
            c.category_id, cat.nombre AS categoria_nombre,
            (SELECT COUNT(*)::int FROM ec_product_media m WHERE m.product_id=p.id) AS num_imagenes
       FROM products p
       LEFT JOIN ec_product_channel c ON c.product_id = p.id
       LEFT JOIN ec_category cat ON cat.id = c.category_id
      WHERE ${filtros.join(' AND ')}
      ORDER BY (COALESCE(c.publicado,false)) DESC, p.name`, params);
  return r.rows;
}

export async function contarPublicados(companyId: string): Promise<number> {
  const r = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM ec_product_channel WHERE company_id = $1 AND publicado = TRUE`, [companyId]);
  return Number(r.rows[0]?.n) || 0;
}

/** El producto debe ser de la empresa (candado multi-tenant). */
async function assertProductoDeEmpresa(companyId: string, productId: string) {
  const r = await query<any>(
    `SELECT 1 FROM products WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`, [productId, companyId]);
  if (!r.rows[0]) throw new NotFoundError('Producto no encontrado en esta empresa.');
}

const numOrNull = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError('El precio web no puede ser negativo.');
  return n;
};

/** Crea/actualiza el contenido web de un producto (upsert por product_id). */
export async function guardarWeb(companyId: string, productId: string, d: any) {
  await assertProductoDeEmpresa(companyId, productId);
  // La categoría: si viene en el payload se guarda (null = sin categoría). Se valida
  // que sea de la empresa para no colgar un producto a la sección de otra.
  const categoryId = d?.categoryId ? String(d.categoryId) : null;
  if (categoryId) {
    const cat = await query<any>(`SELECT 1 FROM ec_category WHERE id=$1 AND company_id=$2`, [categoryId, companyId]);
    if (!cat.rows[0]) throw new ValidationError('La categoría no es de esta empresa.');
  }
  const r = await query<any>(
    `INSERT INTO ec_product_channel
       (company_id, product_id, publicado, destacado, precio_web, titulo_web, descripcion_web, seo_title, seo_description, category_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (product_id) DO UPDATE SET
       publicado=EXCLUDED.publicado, destacado=EXCLUDED.destacado, precio_web=EXCLUDED.precio_web,
       titulo_web=EXCLUDED.titulo_web, descripcion_web=EXCLUDED.descripcion_web,
       seo_title=EXCLUDED.seo_title, seo_description=EXCLUDED.seo_description,
       category_id=EXCLUDED.category_id, updated_at=NOW()
     RETURNING product_id, publicado`,
    [companyId, productId, Boolean(d?.publicado), Boolean(d?.destacado), numOrNull(d?.precioWeb),
     String(d?.tituloWeb || '').trim() || null, String(d?.descripcionWeb || '').trim() || null,
     String(d?.seoTitle || '').trim() || null, String(d?.seoDescription || '').trim() || null, categoryId]);
  return r.rows[0];
}

/** Atajo: publica/oculta un producto sin tocar el resto del contenido web. */
export async function togglePublicado(companyId: string, productId: string, publicado: boolean) {
  await assertProductoDeEmpresa(companyId, productId);
  const r = await query<any>(
    `INSERT INTO ec_product_channel (company_id, product_id, publicado)
     VALUES ($1,$2,$3)
     ON CONFLICT (product_id) DO UPDATE SET publicado=EXCLUDED.publicado, updated_at=NOW()
     RETURNING product_id, publicado`,
    [companyId, productId, Boolean(publicado)]);
  return r.rows[0];
}
