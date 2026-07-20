/**
 * Bitácora de actividad de usuarios de empresa.
 *
 * Se implementa como UN middleware global en vez de sembrar llamadas en cada
 * módulo: si dependiera de que alguien recuerde llamar a log() en cada ruta
 * nueva, la bitácora tendría huecos justo donde importa. Aquí, cualquier
 * endpoint que se agregue mañana queda registrado sin tocar nada.
 *
 * Qué se registra: solo MUTACIONES exitosas (POST/PUT/PATCH/DELETE con status
 * < 400) de usuarios de empresa. Las lecturas no: serían ruido y volumen sin
 * valor de auditoría.
 *
 * Ancla contractual: cláusula SEXTA del contrato (contract-text.ts).
 */
import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import logger from './logger';

/** Rutas que NO se registran: ruido o secretos. */
const SKIP = [
  '/auth/login',          // el login se registra aparte (last_login) y trae password
  '/auth/refresh',
  '/auth/change-password',
  '/contract/sign',       // lleva la e.firma; ya queda en audit_log sin secretos
];

/**
 * Deriva una acción legible del método + ruta. Se prefiere esto a un catálogo
 * hardcodeado: si mañana hay un módulo nuevo, la acción sale sola y sigue
 * siendo entendible en el reporte.
 */
function deriveAction(method: string, path: string): { action: string; entity: string | null; entityId: string | null } {
  // /api/v1/invoices/:id/stamp → ['invoices', ':id', 'stamp']
  const parts = path.replace(/^\/api\/v\d+\//, '').split('/').filter(Boolean);
  const entity = parts[0] ? parts[0].replace(/-/g, '_') : null;
  const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s) || /^\d+$/.test(s);
  const entityId = parts.find(isId) || null;
  const verb = parts.slice(1).find((p) => !isId(p)); // 'stamp', 'cancel', 'disable'…

  const base = (entity || 'unknown').toUpperCase().replace(/S$/, '');
  if (verb) return { action: `${base}_${verb.toUpperCase().replace(/-/g, '_')}`, entity, entityId };
  const byMethod: Record<string, string> = { POST: 'CREATED', PUT: 'UPDATED', PATCH: 'UPDATED', DELETE: 'DELETED' };
  return { action: `${base}_${byMethod[method] || method}`, entity, entityId };
}

/** Quita claves sensibles antes de persistir (espejo de admin.middleware). */
function sanitize(obj: any, depth = 0): any {
  if (!obj || typeof obj !== 'object' || depth > 4) return undefined;
  const REDACT = ['password', 'passwordhash', 'password_hash', 'token', 'secret',
    'csdkey', 'csd_key', 'csdkeypassword', 'keyb64', 'cerb64', 'privatekey'];
  const clone: any = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) {
    const lower = k.toLowerCase();
    if (REDACT.some((r) => lower.includes(r))) { clone[k] = '***REDACTED***'; continue; }
    const v = obj[k];
    if (v && typeof v === 'object') {
      const c = sanitize(v, depth + 1);
      if (c !== undefined) clone[k] = c;
    } else if (typeof v === 'string' && v.length > 200) {
      clone[k] = v.slice(0, 200) + '…';   // XML/base64 no inflan la bitácora
    } else {
      clone[k] = v;
    }
  }
  return clone;
}

export function activityLog(req: Request, res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (SKIP.some((s) => req.path.includes(s))) return next();

  // El body se captura ANTES de que el handler lo mute.
  const body = sanitize(req.body);

  res.on('finish', () => {
    // Solo lo que salió bien: un 4xx/5xx no es actividad, es un intento fallido.
    if (res.statusCode >= 400) return;
    const u = req.user;
    if (!u?.companyId) return;          // SUPER_ADMIN de plataforma → audit_log
    if (u.role === 'SUPER_ADMIN') return;

    const { action, entity, entityId } = deriveAction(req.method, req.originalUrl.split('?')[0]);

    // Fire-and-forget: la bitácora NUNCA debe tumbar la operación de negocio.
    query(
      `INSERT INTO user_activity_log
         (company_id, user_id, user_email, user_role, action, entity, entity_id,
          method, path, status_code, ip, user_agent, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [
        u.companyId, u.userId, u.email || null, u.role || null,
        action, entity, entityId,
        req.method, req.originalUrl.split('?')[0].slice(0, 255), res.statusCode,
        (req.ip || req.socket?.remoteAddress || '').slice(0, 64),
        String(req.headers['user-agent'] || '').slice(0, 255),
        JSON.stringify(body ?? {}),
      ]
    ).catch((e) => logger.warn(`activity log skipped: ${(e as Error).message}`));
  });

  return next();
}

export default activityLog;
