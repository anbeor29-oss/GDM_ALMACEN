/**
 * ecommerce-media.service — FOTOS de producto (rebanada 6).
 *
 * La imagen se OPTIMIZA a JPEG (máx 900px, calidad 80) al subir y se guarda como
 * BYTEA en `ec_product_media` (persistente en Render, como el logo de la empresa).
 * El storefront la sirve por un endpoint público por id (UUID no adivinable).
 */
import sharp from 'sharp';
import { query } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';

const MAX_PX = 900;
const JPEG_Q = 80;
const MAX_IMG = 6; // tope de imágenes por producto

async function assertProductoDeEmpresa(companyId: string, productId: string) {
  const r = await query(`SELECT 1 FROM products WHERE id=$1 AND company_id=$2 AND deleted_at IS NULL`, [productId, companyId]);
  if (!r.rows[0]) throw new NotFoundError('Producto no encontrado en esta empresa.');
}

/** Sube y optimiza una imagen para un producto. Devuelve el id. */
export async function subirImagen(companyId: string, productId: string, buffer: Buffer) {
  await assertProductoDeEmpresa(companyId, productId);
  if (!buffer || !buffer.length) throw new ValidationError('No llegó ningún archivo.');
  const cnt = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ec_product_media WHERE product_id=$1`, [productId]);
  if (Number(cnt.rows[0].n) >= MAX_IMG) throw new ValidationError(`Máximo ${MAX_IMG} imágenes por producto.`);
  let jpg: Buffer;
  try {
    jpg = await sharp(buffer)
      .resize(MAX_PX, MAX_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_Q, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new ValidationError('El archivo no es una imagen válida.');
  }
  const r = await query<{ id: string }>(
    `INSERT INTO ec_product_media (company_id, product_id, imagen, content_type, orden)
     VALUES ($1,$2,$3,'image/jpeg', COALESCE((SELECT MAX(orden)+1 FROM ec_product_media WHERE product_id=$2),0))
     RETURNING id`,
    [companyId, productId, jpg]);
  return { id: r.rows[0].id };
}

/** Ids + orden de las imágenes de un producto (sin binario), para el cockpit. */
export async function listarImagenes(companyId: string, productId: string) {
  await assertProductoDeEmpresa(companyId, productId);
  const r = await query<any>(
    `SELECT id, orden FROM ec_product_media WHERE product_id=$1 ORDER BY orden, created_at`, [productId]);
  return r.rows;
}

export async function eliminarImagen(companyId: string, mediaId: string) {
  const r = await query(`DELETE FROM ec_product_media WHERE id=$1 AND company_id=$2 RETURNING id`, [mediaId, companyId]);
  if (!r.rows[0]) throw new NotFoundError('Imagen no encontrada.');
  return { id: mediaId };
}

/** Público: bytes de la imagen por id (para <img src> del storefront). */
export async function obtenerImagen(mediaId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const r = await query<{ imagen: Buffer; content_type: string }>(
    `SELECT imagen, content_type FROM ec_product_media WHERE id=$1`, [mediaId]);
  const row = r.rows[0];
  if (!row || !row.imagen) return null;
  return { buffer: row.imagen, contentType: row.content_type || 'image/jpeg' };
}
