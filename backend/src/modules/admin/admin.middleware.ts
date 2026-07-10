/**
 * admin.middleware.ts — guards y helpers compartidos del módulo admin.
 *
 *  · requireSuperAdmin: bloquea si el JWT no es role=SUPER_ADMIN
 *  · audit:             persiste en audit_log de forma fire-and-forget
 *
 *  Principio: el guard valida AUTORIZACIÓN; la autenticación ya la hizo
 *  authenticateToken en el router.
 */
import { Request, Response, NextFunction } from 'express';
import { query } from '../../config/database';
import logger from '../../middleware/logger';

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ success: false, message: 'No autenticado' });
  if (req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Esta acción solo está permitida para SUPER_ADMIN',
    });
  }
  return next();
}

export interface AuditOptions {
  action: string;        // 'USER_CREATED', 'USER_DISABLED', 'CSD_UPLOADED', ...
  targetKind: string;    // 'user' | 'company' | 'csd'
  targetId?: string;
  payload?: any;
}

/**
 * Persiste una entrada de auditoría. Nunca lanza — un error de audit no
 * debe bloquear la operación de negocio, pero sí queda en el log.
 */
export async function audit(req: Request, opts: AuditOptions): Promise<void> {
  try {
    // Si el request viene en modo impersonación, incluimos al super-admin
    // que lo originó dentro del payload para no perder la trazabilidad.
    const payload = { ...(opts.payload || {}) };
    if (req.user?.impersonatedBy) {
      payload.__impersonated_by = req.user.impersonatedBy;
    }
    await query(
      `INSERT INTO audit_log (user_id, user_email, role, action, target_kind, target_id, ip, user_agent, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        req.user?.userId || null,
        req.user?.email  || null,
        req.user?.role   || null,
        opts.action,
        opts.targetKind,
        opts.targetId || null,
        (req.ip || req.socket?.remoteAddress || '').slice(0, 64),
        String(req.headers['user-agent'] || '').slice(0, 255),
        JSON.stringify(sanitize(payload)),
      ]
    );
  } catch (e) {
    logger.warn(`audit log skipped: ${(e as Error).message}`);
  }
}

/** Quita claves sensibles del payload antes de persistir. */
function sanitize(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  const REDACT = ['password', 'passwordHash', 'password_hash', 'token', 'secret', 'csdKey', 'csd_key', 'csdKeyPassword'];
  const clone: any = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) {
    if (REDACT.some((r) => k.toLowerCase().includes(r))) clone[k] = '***REDACTED***';
    else if (typeof obj[k] === 'object') clone[k] = sanitize(obj[k]);
    else clone[k] = obj[k];
  }
  return clone;
}
