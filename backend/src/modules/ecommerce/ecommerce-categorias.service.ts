/**
 * ecommerce-categorias.service — CATEGORÍAS del catálogo web (rebanada 7).
 *
 * Secciones para que el comprador navegue la tienda. Viven por empresa en
 * `ec_category`; el producto se liga a la suya en `ec_product_channel.category_id`
 * (NULL = sin categoría). Borrar una categoría no borra productos: el FK deja su
 * `category_id` en NULL. Todo acotado por `company_id` (candado multi-tenant).
 */
import { query } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';

/** nombre → slug web: minúsculas, sin acentos, guiones. */
function slugify(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'categoria';
}

/** Un slug libre para la empresa (añade -2, -3… si choca). `exceptId` ignora la propia. */
async function slugLibre(companyId: string, base: string, exceptId?: string): Promise<string> {
  const r = await query<{ slug: string }>(
    `SELECT slug FROM ec_category WHERE company_id=$1 ${exceptId ? 'AND id <> $2' : ''}`,
    exceptId ? [companyId, exceptId] : [companyId]);
  const usados = new Set(r.rows.map((x) => x.slug.toLowerCase()));
  if (!usados.has(base)) return base;
  for (let i = 2; i < 1000; i++) { const s = `${base}-${i}`; if (!usados.has(s)) return s; }
  return `${base}-${Date.now()}`;
}

/** Categorías de la empresa con cuántos productos tienen asignados (y cuántos publicados). */
export async function listarCategorias(companyId: string) {
  const r = await query<any>(
    `SELECT cat.id, cat.nombre, cat.slug, cat.orden, cat.activa,
            COUNT(c.product_id)::int AS productos,
            COUNT(c.product_id) FILTER (WHERE c.publicado)::int AS publicados
       FROM ec_category cat
       LEFT JOIN ec_product_channel c ON c.category_id = cat.id
      WHERE cat.company_id = $1
      GROUP BY cat.id
      ORDER BY cat.orden, cat.nombre`, [companyId]);
  return r.rows;
}

export async function crearCategoria(companyId: string, d: any) {
  const nombre = String(d?.nombre || '').trim();
  if (!nombre) throw new ValidationError('Captura el nombre de la categoría.');
  const slug = await slugLibre(companyId, slugify(d?.slug || nombre));
  const r = await query<any>(
    `INSERT INTO ec_category (company_id, nombre, slug, orden, activa)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, nombre, slug, orden, activa`,
    [companyId, nombre.slice(0, 120), slug, Number(d?.orden) || 0, d?.activa === false ? false : true]);
  return r.rows[0];
}

export async function actualizarCategoria(companyId: string, id: string, d: any) {
  const ya = await query<any>(`SELECT id, nombre FROM ec_category WHERE id=$1 AND company_id=$2`, [id, companyId]);
  if (!ya.rows[0]) throw new NotFoundError('Categoría no encontrada.');
  const sets: string[] = []; const vals: any[] = [id, companyId]; let i = 3;
  if (d?.nombre !== undefined) {
    const nombre = String(d.nombre || '').trim();
    if (!nombre) throw new ValidationError('El nombre no puede quedar vacío.');
    sets.push(`nombre=$${i++}`); vals.push(nombre.slice(0, 120));
    // Si mandan slug lo respetan; si no, se re-deriva del nombre (siempre único).
    const slug = await slugLibre(companyId, slugify(d?.slug || nombre), id);
    sets.push(`slug=$${i++}`); vals.push(slug);
  } else if (d?.slug !== undefined) {
    const slug = await slugLibre(companyId, slugify(d.slug), id);
    sets.push(`slug=$${i++}`); vals.push(slug);
  }
  if (d?.orden !== undefined) { sets.push(`orden=$${i++}`); vals.push(Number(d.orden) || 0); }
  if (d?.activa !== undefined) { sets.push(`activa=$${i++}`); vals.push(!!d.activa); }
  if (!sets.length) return { actualizado: false };
  const r = await query<any>(
    `UPDATE ec_category SET ${sets.join(', ')}, updated_at=NOW()
      WHERE id=$1 AND company_id=$2 RETURNING id, nombre, slug, orden, activa`, vals);
  return r.rows[0];
}

/** Borra la categoría; sus productos quedan sin categoría (FK ON DELETE SET NULL). */
export async function borrarCategoria(companyId: string, id: string) {
  const r = await query<any>(`DELETE FROM ec_category WHERE id=$1 AND company_id=$2 RETURNING nombre`, [id, companyId]);
  if (!r.rows[0]) throw new NotFoundError('Categoría no encontrada.');
  return { nombre: r.rows[0].nombre };
}

/** Asigna (o quita, con null) la categoría de un producto. Crea el overlay web si falta. */
export async function asignarCategoriaProducto(companyId: string, productId: string, categoryId: string | null) {
  const prod = await query<any>(
    `SELECT 1 FROM products WHERE id=$1 AND company_id=$2 AND deleted_at IS NULL`, [productId, companyId]);
  if (!prod.rows[0]) throw new NotFoundError('Producto no encontrado en esta empresa.');
  if (categoryId) {
    const cat = await query<any>(`SELECT 1 FROM ec_category WHERE id=$1 AND company_id=$2`, [categoryId, companyId]);
    if (!cat.rows[0]) throw new ValidationError('La categoría no es de esta empresa.');
  }
  const r = await query<any>(
    `INSERT INTO ec_product_channel (company_id, product_id, category_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (product_id) DO UPDATE SET category_id=EXCLUDED.category_id, updated_at=NOW()
     RETURNING product_id, category_id`,
    [companyId, productId, categoryId]);
  return r.rows[0];
}
