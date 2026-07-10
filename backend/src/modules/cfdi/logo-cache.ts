/**
 * Caché en memoria de logos pre-optimizados para incrustar en PDFs.
 *
 *   - PDFKit no recomprime imágenes; si pasamos el JPG original (4000×2667, 3 MB)
 *     el PDF resultante pesa 3 MB y el navegador hace timeout al descargar.
 *   - Aquí redimensionamos a un thumbnail apto para el header (300×300 px,
 *     calidad JPEG 78) y cacheamos por hash del binario para que cada
 *     factura solo pague el costo de compresión una vez.
 *
 * En Render el filesystem NO es persistente (Backend Starter no tiene disco
 * mount), por eso la fuente primaria del logo es la columna `logo_data BYTEA`
 * de la tabla `companies`. Como fallback, si viene un `logoPath` legacy y el
 * archivo existe en el filesystem, también se lee de ahí (dev local).
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { query } from '../../config/database';
import logger from '../../middleware/logger';

interface LogoCacheEntry {
  sha1: string;
  buffer: Buffer;
}

const cache = new Map<string, LogoCacheEntry>();

/** Lado máximo en píxeles del thumbnail (se ajusta dentro de un cuadrado). */
const MAX_PX = 300;
/** Calidad JPEG del thumbnail — suficiente para impresión a 3×3 cm. */
const JPEG_QUALITY = 78;

/**
 * Optimiza un Buffer de imagen a JPEG 300×300 y lo cachea por hash del
 * contenido para no recomprimir en cada llamada.
 */
async function optimize(buffer: Buffer, cacheKey: string): Promise<Buffer | null> {
  try {
    const sha1 = crypto.createHash('sha1').update(buffer).digest('hex');
    const hit = cache.get(cacheKey);
    if (hit && hit.sha1 === sha1) return hit.buffer;

    const out = await sharp(buffer)
      .resize(MAX_PX, MAX_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    cache.set(cacheKey, { sha1, buffer: out });
    logger.info(`Logo optimizado (${cacheKey}): ${out.length} bytes`);
    return out;
  } catch (e) {
    logger.warn(`optimize logo falló: ${e instanceof Error ? e.message : 'desconocido'}`);
    return null;
  }
}

/**
 * Carga el logo de una empresa priorizando:
 *   1) `companies.logo_data` (BYTEA en BD — persistente en Render)
 *   2) `companies.logo_path` (filesystem — fallback dev local)
 *
 * Devuelve un Buffer JPEG 300×300 listo para `doc.image()`, o `null` si la
 * empresa no tiene logo cargado.
 */
export async function getCompanyLogo(companyId: string): Promise<Buffer | null> {
  if (!companyId) return null;
  try {
    const r = await query<{ logo_data: Buffer | null; logo_path: string | null }>(
      `SELECT logo_data, logo_path FROM companies WHERE id = $1`,
      [companyId]
    );
    const row = r.rows[0];
    if (!row) return null;

    // 1) BD (persistente)
    if (row.logo_data && row.logo_data.length > 0) {
      return await optimize(row.logo_data, `db:${companyId}`);
    }
    // 2) Filesystem (dev local con disco)
    if (row.logo_path && fs.existsSync(row.logo_path)) {
      const buffer = fs.readFileSync(row.logo_path);
      return await optimize(buffer, `fs:${row.logo_path}`);
    }
    return null;
  } catch (e) {
    logger.warn(`getCompanyLogo falló para ${companyId}: ${e instanceof Error ? e.message : 'desconocido'}`);
    return null;
  }
}

/**
 * Legacy: compatible con código que aún pasa el path directamente.
 * Nuevos callers deben usar getCompanyLogo(companyId).
 */
export async function getOptimizedLogo(logoPath: string | null | undefined): Promise<Buffer | null> {
  if (!logoPath || typeof logoPath !== 'string') return null;
  try {
    if (!fs.existsSync(logoPath)) return null;
    const buffer = fs.readFileSync(logoPath);
    return await optimize(buffer, `fs:${logoPath}`);
  } catch (e) {
    logger.warn(`getOptimizedLogo falló para ${logoPath}: ${e instanceof Error ? e.message : 'desconocido'}`);
    return null;
  }
}
