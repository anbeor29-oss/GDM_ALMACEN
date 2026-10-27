/**
 * ecommerce-compradores.service — CUENTAS DE COMPRADOR (rebanada 10).
 *
 * Cuentas de los clientes de una TIENDA (email + contraseña) para ver su historial
 * y no recapturar datos. Son SEPARADAS de los usuarios de NEXO: su token se firma con
 * un secreto DERIVADO (`jwt.secret + ':ec_buyer'`) y lleva `tipo:'ec_buyer'`, así NUNCA
 * valida como token de NEXO ni al revés. Email único por tienda. bcrypt para el hash.
 */
import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';
import { query } from '../../config/database';
import { config } from '../../config/environment';
import { ValidationError, UnauthorizedError, NotFoundError } from '../../middleware/errorHandler';
import type { TiendaPublica } from './ecommerce-storefront.service';

/** Secreto propio del comprador: derivado del de NEXO pero distinto → no hay cruce. */
const SECRET_COMPRADOR = `${config.jwt.secret}:ec_buyer`;
const EXPIRA = '30d';

export interface TokenComprador { tipo: 'ec_buyer'; buyerId: string; storeId: string; companyId: string }

function firmarToken(buyer: { id: string; store_id: string; company_id: string }): string {
  const payload: TokenComprador = { tipo: 'ec_buyer', buyerId: buyer.id, storeId: buyer.store_id, companyId: buyer.company_id };
  return jwt.sign(payload, SECRET_COMPRADOR, { expiresIn: EXPIRA });
}

/** Verifica un token de comprador. Lanza si es inválido o no es de este tipo. */
export function verificarTokenComprador(token: string): TokenComprador {
  try {
    const d = jwt.verify(token, SECRET_COMPRADOR) as any;
    if (!d || d.tipo !== 'ec_buyer' || !d.buyerId) throw new Error('tipo');
    return { tipo: 'ec_buyer', buyerId: d.buyerId, storeId: d.storeId, companyId: d.companyId };
  } catch {
    throw new UnauthorizedError('Sesión de comprador inválida o expirada.');
  }
}

const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const limpio = (s: any, max = 250) => String(s || '').trim().slice(0, max) || null;

/** Datos públicos del comprador (sin el hash). */
function publico(b: any) {
  return {
    id: b.id, email: b.email, nombre: b.nombre,
    telefono: b.telefono || '', direccion: b.direccion || '', cp: b.cp || '',
  };
}

/* ── Registro / login ─────────────────────────────────────────────────────── */

export async function registrar(store: TiendaPublica, d: any) {
  const email = String(d?.email || '').trim().toLowerCase();
  const password = String(d?.password || '');
  const nombre = limpio(d?.nombre);
  if (!email || !emailValido(email)) throw new ValidationError('Captura un correo válido.');
  if (password.length < 6) throw new ValidationError('La contraseña debe tener al menos 6 caracteres.');
  if (!nombre) throw new ValidationError('Captura tu nombre.');

  const dup = await query<any>(`SELECT 1 FROM ec_buyer WHERE store_id=$1 AND lower(email)=lower($2)`, [store.id, email]);
  if (dup.rows[0]) throw new ValidationError('Ya existe una cuenta con ese correo en esta tienda. Inicia sesión.');

  const hash = await bcryptjs.hash(password, await bcryptjs.genSalt(10));
  const r = await query<any>(
    `INSERT INTO ec_buyer (company_id, store_id, email, password_hash, nombre, telefono, direccion, cp, last_login_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     RETURNING id, store_id, company_id, email, nombre, telefono, direccion, cp`,
    [store.company_id, store.id, email, hash, nombre, limpio(d?.telefono, 30), limpio(d?.direccion, 500), limpio(d?.cp, 10)]);
  const b = r.rows[0];
  return { token: firmarToken(b), comprador: publico(b) };
}

export async function login(store: TiendaPublica, d: any) {
  const email = String(d?.email || '').trim().toLowerCase();
  const password = String(d?.password || '');
  if (!email || !password) throw new ValidationError('Captura tu correo y contraseña.');
  const r = await query<any>(
    `SELECT id, store_id, company_id, email, password_hash, nombre, telefono, direccion, cp, activo
       FROM ec_buyer WHERE store_id=$1 AND lower(email)=lower($2)`, [store.id, email]);
  const b = r.rows[0];
  if (!b || !b.activo || !(await bcryptjs.compare(password, b.password_hash))) {
    throw new UnauthorizedError('Correo o contraseña incorrectos.');
  }
  await query(`UPDATE ec_buyer SET last_login_at=NOW(), updated_at=NOW() WHERE id=$1`, [b.id]);
  return { token: firmarToken(b), comprador: publico(b) };
}

/* ── Perfil e historial (con sesión) ──────────────────────────────────────── */

export async function perfil(buyerId: string) {
  const r = await query<any>(
    `SELECT id, email, nombre, telefono, direccion, cp FROM ec_buyer WHERE id=$1 AND activo=TRUE`, [buyerId]);
  if (!r.rows[0]) throw new NotFoundError('Cuenta no encontrada.');
  return publico(r.rows[0]);
}

export async function actualizarPerfil(buyerId: string, d: any) {
  const sets: string[] = []; const vals: any[] = [buyerId]; let i = 2;
  if (d?.nombre !== undefined) { const n = limpio(d.nombre); if (!n) throw new ValidationError('El nombre no puede quedar vacío.'); sets.push(`nombre=$${i++}`); vals.push(n); }
  if (d?.telefono !== undefined) { sets.push(`telefono=$${i++}`); vals.push(limpio(d.telefono, 30)); }
  if (d?.direccion !== undefined) { sets.push(`direccion=$${i++}`); vals.push(limpio(d.direccion, 500)); }
  if (d?.cp !== undefined) { sets.push(`cp=$${i++}`); vals.push(limpio(d.cp, 10)); }
  if (!sets.length) return await perfil(buyerId);
  await query(`UPDATE ec_buyer SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$1`, vals);
  return await perfil(buyerId);
}

/** Pedidos del comprador (su historial en la tienda). */
export async function misPedidos(buyerId: string) {
  const r = await query<any>(
    `SELECT o.id, o.numero, o.estado, o.total::float AS total, o.moneda, o.created_at,
            o.facturado_at, i.cfdi_uuid, i.serie, i.folio
       FROM ec_order o
       LEFT JOIN invoices i ON i.id = o.invoice_id
      WHERE o.buyer_id = $1
      ORDER BY o.created_at DESC
      LIMIT 100`, [buyerId]);
  return r.rows;
}

/* ── Cockpit: compradores de la empresa ───────────────────────────────────── */

export async function listarCompradores(companyId: string) {
  const r = await query<any>(
    `SELECT b.id, b.email, b.nombre, b.telefono, b.created_at, b.last_login_at, b.activo,
            s.nombre AS tienda,
            COUNT(o.id)::int AS pedidos,
            COALESCE(SUM(o.total) FILTER (WHERE o.estado NOT IN ('CANCELADO')),0)::float AS comprado
       FROM ec_buyer b
       JOIN ec_store s ON s.id = b.store_id
       LEFT JOIN ec_order o ON o.buyer_id = b.id
      WHERE b.company_id = $1
      GROUP BY b.id, s.nombre
      ORDER BY b.created_at DESC
      LIMIT 500`, [companyId]);
  return r.rows;
}
