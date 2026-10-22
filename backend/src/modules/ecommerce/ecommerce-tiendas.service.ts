/**
 * ecommerce-tiendas.service — alta/edición/baja de TIENDAS (rebanada 2).
 *
 * Multi-empresa: cada tienda pertenece a su `company_id`. El `slug` es el
 * subdominio (tienda.hcgm.com.mx/<slug>) y es ÚNICO global entre tiendas vivas.
 */
import { query } from '../../config/database';
import { ValidationError, NotFoundError, ConflictError } from '../../middleware/errorHandler';

/** Subdominio válido: minúsculas/dígitos/guiones, sin guion al inicio/fin, 2–40 chars. */
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Normaliza un texto a slug (minúsculas, espacios→guion, sólo [a-z0-9-]). */
export function normalizarSlug(s: string): string {
  return String(s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // quita acentos
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

const hexOrNull = (v: any, def: string): string => (HEX_RE.test(String(v || '')) ? String(v) : def);

export async function listarTiendas(companyId: string) {
  const r = await query<any>(
    `SELECT id, nombre, slug, moneda, zona_horaria, logo_url, color_primario, color_secundario,
            politica_envio, politica_devolucion, politica_privacidad, terminos, activa,
            TO_CHAR(created_at,'YYYY-MM-DD') AS creada
       FROM ec_store
      WHERE company_id = $1 AND deleted_at IS NULL
      ORDER BY activa DESC, nombre`, [companyId]);
  return r.rows;
}

export async function contarTiendas(companyId: string): Promise<number> {
  const r = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM ec_store WHERE company_id = $1 AND deleted_at IS NULL`, [companyId]);
  return Number(r.rows[0]?.n) || 0;
}

/** Valida el slug y que no choque con otra tienda viva (de cualquier empresa). */
async function validarSlug(slug: string, exceptoId?: string): Promise<string> {
  const s = normalizarSlug(slug);
  if (!SLUG_RE.test(s)) throw new ValidationError('El subdominio sólo admite minúsculas, números y guiones (2–40).');
  const dup = await query<any>(
    `SELECT 1 FROM ec_store WHERE lower(slug) = $1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR id <> $2)`,
    [s, exceptoId || null]);
  if (dup.rows[0]) throw new ConflictError(`El subdominio «${s}» ya está en uso. Elige otro.`);
  return s;
}

export async function crearTienda(companyId: string, d: any) {
  const nombre = String(d?.nombre || '').trim();
  if (nombre.length < 2) throw new ValidationError('Captura el nombre de la tienda.');
  const slug = await validarSlug(d?.slug || nombre);
  const r = await query<any>(
    `INSERT INTO ec_store
       (company_id, nombre, slug, moneda, zona_horaria, logo_url, color_primario, color_secundario,
        politica_envio, politica_devolucion, politica_privacidad, terminos)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, nombre, slug`,
    [companyId, nombre, slug, String(d?.moneda || 'MXN').toUpperCase().slice(0, 3),
     String(d?.zonaHoraria || 'America/Mexico_City'),
     String(d?.logoUrl || '').trim() || null,
     hexOrNull(d?.colorPrimario, '#059669'), hexOrNull(d?.colorSecundario, '#0d9488'),
     String(d?.politicaEnvio || '').trim() || null, String(d?.politicaDevolucion || '').trim() || null,
     String(d?.politicaPrivacidad || '').trim() || null, String(d?.terminos || '').trim() || null]);
  return r.rows[0];
}

export async function actualizarTienda(companyId: string, id: string, d: any) {
  const fields: string[] = [];
  const params: any[] = [];
  const push = (f: string, v: any) => { params.push(v); fields.push(`${f} = $${params.length}`); };

  if (d?.nombre !== undefined) {
    const n = String(d.nombre).trim();
    if (n.length < 2) throw new ValidationError('Nombre inválido.');
    push('nombre', n);
  }
  if (d?.slug !== undefined) push('slug', await validarSlug(d.slug, id));
  if (d?.moneda !== undefined) push('moneda', String(d.moneda).toUpperCase().slice(0, 3));
  if (d?.zonaHoraria !== undefined) push('zona_horaria', String(d.zonaHoraria));
  if (d?.logoUrl !== undefined) push('logo_url', String(d.logoUrl || '').trim() || null);
  if (d?.colorPrimario !== undefined) push('color_primario', hexOrNull(d.colorPrimario, '#059669'));
  if (d?.colorSecundario !== undefined) push('color_secundario', hexOrNull(d.colorSecundario, '#0d9488'));
  if (d?.politicaEnvio !== undefined) push('politica_envio', String(d.politicaEnvio || '').trim() || null);
  if (d?.politicaDevolucion !== undefined) push('politica_devolucion', String(d.politicaDevolucion || '').trim() || null);
  if (d?.politicaPrivacidad !== undefined) push('politica_privacidad', String(d.politicaPrivacidad || '').trim() || null);
  if (d?.terminos !== undefined) push('terminos', String(d.terminos || '').trim() || null);
  if (d?.activa !== undefined) push('activa', Boolean(d.activa));

  if (!fields.length) throw new ValidationError('Nada que actualizar.');
  params.push(id); params.push(companyId);
  const r = await query<any>(
    `UPDATE ec_store SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length - 1} AND company_id = $${params.length} AND deleted_at IS NULL
      RETURNING id, nombre, slug`, params);
  if (!r.rows[0]) throw new NotFoundError('Tienda no encontrada.');
  return r.rows[0];
}

export async function eliminarTienda(companyId: string, id: string) {
  const r = await query<any>(
    `UPDATE ec_store SET deleted_at = NOW(), activa = FALSE, updated_at = NOW()
      WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL RETURNING id, nombre`, [id, companyId]);
  if (!r.rows[0]) throw new NotFoundError('Tienda no encontrada.');
  return r.rows[0];
}
