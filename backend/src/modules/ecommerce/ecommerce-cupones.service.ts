/**
 * ecommerce-cupones.service — CUPONES / PROMOCIONES (rebanada 9).
 *
 * Códigos de descuento por empresa. El comprador captura el código en el checkout;
 * el descuento se aplica a los PRODUCTOS bajando su precio neto (el CFDI sale correcto:
 * IVA sobre el neto, sin campo Descuento global, que `createInvoice` resta mal). El
 * envío no se descuenta. Todo acotado por `company_id`.
 */
import { query } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';

const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const TIPOS = ['PORCENTAJE', 'MONTO'];

export interface Cupon {
  id: string; codigo: string; tipo: string; valor: number;
  min_compra: number | null; vence: string | null; usos_max: number | null; usos: number; activo: boolean;
}

/** Normaliza el código: sin espacios, MAYÚSCULAS. */
const normCodigo = (s: any) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');

/* ── Cockpit: CRUD ────────────────────────────────────────────────────────── */

export async function listarCupones(companyId: string) {
  const r = await query<any>(
    `SELECT id, codigo, tipo, valor::float AS valor, min_compra::float AS min_compra,
            TO_CHAR(vence,'YYYY-MM-DD') AS vence, usos_max, usos, activo
       FROM ec_coupon WHERE company_id=$1 ORDER BY activo DESC, codigo`, [companyId]);
  return r.rows;
}

function limpiarDatos(d: any) {
  const tipo = TIPOS.includes(String(d?.tipo || '').toUpperCase()) ? String(d.tipo).toUpperCase() : 'PORCENTAJE';
  let valor = Number(d?.valor);
  if (!Number.isFinite(valor) || valor < 0) throw new ValidationError('El valor del cupón no puede ser negativo.');
  if (tipo === 'PORCENTAJE' && valor > 100) throw new ValidationError('El porcentaje no puede pasar de 100.');
  valor = r2(valor);
  const num = (v: any) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) && Number(v) >= 0 ? r2(v) : (() => { throw new ValidationError('Valor numérico inválido en el cupón.'); })()));
  const entero = (v: any) => (v === null || v === undefined || v === '' ? null : Math.max(0, Math.trunc(Number(v) || 0)));
  const vence = d?.vence ? String(d.vence).slice(0, 10) : null;
  return { tipo, valor, minCompra: num(d?.minCompra), usosMax: entero(d?.usosMax), vence };
}

export async function crearCupon(companyId: string, d: any) {
  const codigo = normCodigo(d?.codigo);
  if (!codigo) throw new ValidationError('Captura el código del cupón.');
  const dup = await query<any>(`SELECT 1 FROM ec_coupon WHERE company_id=$1 AND upper(codigo)=upper($2)`, [companyId, codigo]);
  if (dup.rows[0]) throw new ValidationError('Ya existe un cupón con ese código.');
  const { tipo, valor, minCompra, usosMax, vence } = limpiarDatos(d);
  const r = await query<any>(
    `INSERT INTO ec_coupon (company_id, codigo, tipo, valor, min_compra, vence, usos_max, activo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, codigo, tipo, valor::float AS valor, min_compra::float AS min_compra,
               TO_CHAR(vence,'YYYY-MM-DD') AS vence, usos_max, usos, activo`,
    [companyId, codigo, tipo, valor, minCompra, vence, usosMax, d?.activo === false ? false : true]);
  return r.rows[0];
}

export async function actualizarCupon(companyId: string, id: string, d: any) {
  const ya = await query<any>(`SELECT id FROM ec_coupon WHERE id=$1 AND company_id=$2`, [id, companyId]);
  if (!ya.rows[0]) throw new NotFoundError('Cupón no encontrado.');
  const sets: string[] = []; const vals: any[] = [id, companyId]; let i = 3;
  if (d?.codigo !== undefined) {
    const codigo = normCodigo(d.codigo);
    if (!codigo) throw new ValidationError('El código no puede quedar vacío.');
    const dup = await query<any>(`SELECT 1 FROM ec_coupon WHERE company_id=$1 AND upper(codigo)=upper($2) AND id<>$3`, [companyId, codigo, id]);
    if (dup.rows[0]) throw new ValidationError('Ya existe otro cupón con ese código.');
    sets.push(`codigo=$${i++}`); vals.push(codigo);
  }
  if (d?.tipo !== undefined || d?.valor !== undefined || d?.minCompra !== undefined || d?.usosMax !== undefined || d?.vence !== undefined) {
    const { tipo, valor, minCompra, usosMax, vence } = limpiarDatos({ ...ya.rows[0], ...d });
    if (d?.tipo !== undefined) { sets.push(`tipo=$${i++}`); vals.push(tipo); }
    if (d?.valor !== undefined) { sets.push(`valor=$${i++}`); vals.push(valor); }
    if (d?.minCompra !== undefined) { sets.push(`min_compra=$${i++}`); vals.push(minCompra); }
    if (d?.usosMax !== undefined) { sets.push(`usos_max=$${i++}`); vals.push(usosMax); }
    if (d?.vence !== undefined) { sets.push(`vence=$${i++}`); vals.push(vence); }
  }
  if (d?.activo !== undefined) { sets.push(`activo=$${i++}`); vals.push(!!d.activo); }
  if (!sets.length) return { actualizado: false };
  const r = await query<any>(
    `UPDATE ec_coupon SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$1 AND company_id=$2
     RETURNING id, codigo, tipo, valor::float AS valor, min_compra::float AS min_compra,
               TO_CHAR(vence,'YYYY-MM-DD') AS vence, usos_max, usos, activo`, vals);
  return r.rows[0];
}

export async function borrarCupon(companyId: string, id: string) {
  const r = await query<any>(`DELETE FROM ec_coupon WHERE id=$1 AND company_id=$2 RETURNING codigo`, [id, companyId]);
  if (!r.rows[0]) throw new NotFoundError('Cupón no encontrado.');
  return { codigo: r.rows[0].codigo };
}

/* ── Evaluación (storefront + pedido) ─────────────────────────────────────── */

/**
 * ¿Aplica el cupón al total (CON IVA) de los productos? Devuelve el descuento (con
 * IVA) y la fracción a bajar de cada precio. Puro: no toca la BD (el llamador trae
 * el cupón). `hoy` para probar vencimientos.
 */
export function validarCupon(
  c: Cupon, productTotalConIva: number, hoy: Date = new Date(),
): { ok: true; descuento: number; frac: number } | { ok: false; motivo: string } {
  if (!c.activo) return { ok: false, motivo: 'El cupón no está activo.' };
  if (c.vence && new Date(`${c.vence}T23:59:59`) < hoy) return { ok: false, motivo: 'El cupón ya venció.' };
  if (c.usos_max != null && Number(c.usos) >= Number(c.usos_max)) return { ok: false, motivo: 'El cupón alcanzó su límite de usos.' };
  const total = r2(productTotalConIva);
  if (total <= 0) return { ok: false, motivo: 'Agrega productos para usar el cupón.' };
  if (c.min_compra != null && total < Number(c.min_compra)) {
    return { ok: false, motivo: `Este cupón aplica desde $${Number(c.min_compra).toLocaleString('es-MX', { minimumFractionDigits: 2 })} de compra.` };
  }
  let desc = c.tipo === 'MONTO' ? Number(c.valor) : total * (Number(c.valor) / 100);
  desc = Math.min(r2(desc), total);
  if (desc <= 0) return { ok: false, motivo: 'El cupón no genera descuento.' };
  return { ok: true, descuento: r2(desc), frac: desc / total };
}

/** Busca un cupón de la empresa por código (sin bloquear). Para la validación pública. */
export async function buscarCupon(companyId: string, codigo: string): Promise<Cupon | null> {
  const r = await query<any>(
    `SELECT id, codigo, tipo, valor::float AS valor, min_compra::float AS min_compra,
            TO_CHAR(vence,'YYYY-MM-DD') AS vence, usos_max, usos, activo
       FROM ec_coupon WHERE company_id=$1 AND upper(codigo)=upper($2) LIMIT 1`, [companyId, normCodigo(codigo)]);
  return r.rows[0] || null;
}
