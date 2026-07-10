/**
 * /admin/users — gestión de usuarios por el SUPER_ADMIN.
 *
 *  GET    /admin/users              listado (con filtros)
 *  POST   /admin/users              crear usuario + assignar empresa + password temporal
 *  PUT    /admin/users/:id          editar (nombre, rol, company_id)
 *  POST   /admin/users/:id/reset-password   genera nueva password temporal
 *  POST   /admin/users/:id/disable  desactiva (soft — preserva auditoría)
 *  POST   /admin/users/:id/enable   re-activa
 *
 *  Seguridad:
 *   · Solo SUPER_ADMIN
 *   · Cada acción → audit_log
 *   · Password siempre vía bcrypt 10 rounds
 *   · password_change_required=true para forzar cambio en primer login
 *   · No se permite deshabilitar al PROPIO super-admin
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authenticateToken, generateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError, NotFoundError, ConflictError, UnauthorizedError } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import { requireSuperAdmin, audit } from './admin.middleware';
import logger from '../../middleware/logger';

const router = Router();
router.use(authenticateToken);
router.use(requireSuperAdmin);

const VALID_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'USER'] as const;
type Role = typeof VALID_ROLES[number];

/** Genera password temporal legible: ej. "Lima-9248" — fácil de transmitir al usuario. */
function generateTemporaryPassword(): string {
  const words = ['Lima', 'Roma', 'Toro', 'Sole', 'Cima', 'Vega', 'Bahia', 'Rio', 'Mar', 'Sol'];
  const w = words[Math.floor(Math.random() * words.length)];
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${w}-${n}`;
}

function validEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/* ────────────────────────  LIST  ──────────────────────── */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const limit  = Math.min(200, Math.max(1, parseInt(String(req.query.limit  || '50'), 10)));
  const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10));
  const search = String(req.query.search || '').trim();
  const companyId = String(req.query.companyId || '').trim();

  const filters = ['1=1'];
  const params: any[] = [];
  if (search) {
    params.push(`%${search}%`);
    filters.push(`(u.email ILIKE $${params.length} OR u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length})`);
  }
  if (/^[0-9a-f-]{36}$/i.test(companyId)) {
    params.push(companyId);
    filters.push(`u.company_id = $${params.length}`);
  }

  params.push(limit, offset);
  const r = await query<any>(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_active,
            u.password_change_required, u.last_login, u.disabled_at,
            u.company_id, c.business_name AS company_name, c.rfc AS company_rfc,
            u.created_at, u.created_by_user_id
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
      WHERE ${filters.join(' AND ')}
      ORDER BY u.created_at DESC NULLS LAST
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const totalR = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM users u WHERE ${filters.join(' AND ')}`,
    params.slice(0, -2)
  );
  res.json({ success: true, data: { users: r.rows, total: Number(totalR.rows[0].total) } });
}));

/* ────────────────────────  GET ONE  ──────────────────────── */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const r = await query<any>(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_active,
            u.password_change_required, u.last_login, u.disabled_at, u.created_at,
            u.company_id, c.business_name AS company_name, c.rfc AS company_rfc
       FROM users u LEFT JOIN companies c ON c.id = u.company_id
      WHERE u.id = $1`,
    [req.params.id]
  );
  if (r.rows.length === 0) throw new NotFoundError('Usuario no encontrado');
  res.json({ success: true, data: r.rows[0] });
}));

/* ────────────────────────  CREATE  ──────────────────────── */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { email, firstName, lastName, role, companyId } = req.body as any;
  if (!email || !validEmail(email)) throw new ValidationError('Email inválido');
  if (!firstName || !lastName)      throw new ValidationError('firstName y lastName son requeridos');
  if (!VALID_ROLES.includes(role))  throw new ValidationError(`role inválido. Válidos: ${VALID_ROLES.join(', ')}`);
  if (role !== 'SUPER_ADMIN' && !companyId) {
    throw new ValidationError('companyId es requerido para roles distintos a SUPER_ADMIN');
  }
  if (companyId && !/^[0-9a-f-]{36}$/i.test(companyId)) {
    throw new ValidationError('companyId UUID inválido');
  }

  const dup = await query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
  if (dup.rowCount! > 0) throw new ConflictError('Ya existe un usuario con ese email');

  const tempPass = generateTemporaryPassword();
  const hash     = await bcrypt.hash(tempPass, 10);

  const r = await query<any>(
    `INSERT INTO users (email, first_name, last_name, password_hash, role,
                        company_id, is_active, password_change_required, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, true, true, $7)
     RETURNING id, email, role, company_id, password_change_required, created_at`,
    [email.toLowerCase(), firstName, lastName, hash, role,
     role === 'SUPER_ADMIN' ? null : companyId,
     req.user!.userId]
  );
  const user = r.rows[0];
  await audit(req, { action: 'USER_CREATED', targetKind: 'user', targetId: user.id,
    payload: { email, role, companyId } });

  // Devolvemos la contraseña temporal UNA VEZ — el operador debe comunicársela al usuario
  res.status(201).json({
    success: true,
    message: 'Usuario creado. Comparte la contraseña temporal y se forzará cambio en el primer login.',
    data: { ...user, temporary_password: tempPass },
  });
}));

/* ────────────────────────  UPDATE  ──────────────────────── */
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { firstName, lastName, role, companyId } = req.body as any;
  const fields: string[] = [];
  const params: any[] = [];
  const push = (f: string, v: any) => { params.push(v); fields.push(`${f} = $${params.length}`); };

  if (firstName) push('first_name', firstName);
  if (lastName)  push('last_name',  lastName);
  if (role) {
    if (!VALID_ROLES.includes(role)) throw new ValidationError('role inválido');
    push('role', role);
  }
  if (companyId !== undefined) push('company_id', companyId || null);

  if (fields.length === 0) throw new ValidationError('Nada que actualizar');
  params.push(req.params.id);
  const r = await query<any>(
    `UPDATE users SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length} RETURNING id, email, role, company_id`,
    params
  );
  if (r.rows.length === 0) throw new NotFoundError('Usuario no encontrado');
  await audit(req, { action: 'USER_UPDATED', targetKind: 'user', targetId: req.params.id,
    payload: { firstName, lastName, role, companyId } });
  res.json({ success: true, data: r.rows[0] });
}));

/* ────────────────────────  RESET PASSWORD  ──────────────────────── */
router.post('/:id/reset-password', asyncHandler(async (req: Request, res: Response) => {
  const tempPass = generateTemporaryPassword();
  const hash = await bcrypt.hash(tempPass, 10);
  const r = await query<any>(
    `UPDATE users SET password_hash = $1, password_change_required = true,
                       failed_login_attempts = 0, locked_until = NULL, updated_at = NOW()
      WHERE id = $2 RETURNING id, email`,
    [hash, req.params.id]
  );
  if (r.rows.length === 0) throw new NotFoundError('Usuario no encontrado');
  await audit(req, { action: 'USER_PASSWORD_RESET', targetKind: 'user', targetId: req.params.id });
  res.json({ success: true, data: { ...r.rows[0], temporary_password: tempPass } });
}));

/* ────────────────────────  DISABLE / ENABLE  ──────────────────────── */
router.post('/:id/disable', asyncHandler(async (req: Request, res: Response) => {
  if (req.params.id === req.user!.userId) {
    throw new ValidationError('No puedes deshabilitar tu propia cuenta');
  }
  const r = await query<any>(
    `UPDATE users SET is_active = false, disabled_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING id, email, is_active`,
    [req.params.id]
  );
  if (r.rows.length === 0) throw new NotFoundError('Usuario no encontrado');
  await audit(req, { action: 'USER_DISABLED', targetKind: 'user', targetId: req.params.id });
  res.json({ success: true, data: r.rows[0] });
}));

router.post('/:id/enable', asyncHandler(async (req: Request, res: Response) => {
  const r = await query<any>(
    `UPDATE users SET is_active = true, disabled_at = NULL, updated_at = NOW()
      WHERE id = $1 RETURNING id, email, is_active`,
    [req.params.id]
  );
  if (r.rows.length === 0) throw new NotFoundError('Usuario no encontrado');
  await audit(req, { action: 'USER_ENABLED', targetKind: 'user', targetId: req.params.id });
  res.json({ success: true, data: r.rows[0] });
}));

/* ────────────────────────  IMPERSONATE  ────────────────────────
 *  POST /admin/users/:id/impersonate
 *
 *  El SUPER_ADMIN obtiene un JWT que actúa en nombre del usuario target,
 *  pero con un claim `impersonatedBy` que:
 *   · permite al frontend pintar el banner "Estás suplantando a X"
 *   · queda auditado en cada request a través del audit log de cualquier acción
 *
 *  Reglas:
 *   · No se puede impersonar al propio SUPER_ADMIN
 *   · No se puede impersonar a un usuario inactivo
 *   · Token de impersonación tiene ventana corta (config.jwt.expiration) — el
 *     SUPER_ADMIN debe re-impersonar si caduca, lo que vuelve a auditarse
 *   · Auditoría OBLIGATORIA (USER_IMPERSONATED) con IP + UA + ts
 */
router.post('/:id/impersonate', asyncHandler(async (req, res) => {
  if (req.params.id === req.user!.userId) {
    throw new ValidationError('No puedes impersonarte a ti mismo');
  }
  const r = await query<any>(
    `SELECT u.id, u.email, u.role, u.is_active, u.company_id,
            c.business_name, c.rfc
       FROM users u LEFT JOIN companies c ON c.id = u.company_id
      WHERE u.id = $1`,
    [req.params.id]
  );
  if (r.rows.length === 0) throw new NotFoundError('Usuario no encontrado');
  const target = r.rows[0];
  if (!target.is_active) throw new UnauthorizedError('El usuario objetivo está deshabilitado');
  if (target.role === 'SUPER_ADMIN') {
    throw new ValidationError('No se permite impersonar a otro SUPER_ADMIN');
  }

  const impersonationToken = generateToken({
    userId: target.id,
    email: target.email,
    role: target.role,
    companyId: target.company_id,
    impersonatedBy: { userId: req.user!.userId, email: req.user!.email },
  });

  await audit(req, {
    action: 'USER_IMPERSONATED',
    targetKind: 'user',
    targetId: target.id,
    payload: {
      target_email: target.email,
      target_role:  target.role,
      target_company: target.business_name,
    },
  });
  logger.info(`[IMPERSONATE] ${req.user!.email} → ${target.email}`);

  res.json({
    success: true,
    data: {
      token: impersonationToken,
      user: {
        id: target.id, email: target.email, role: target.role,
        companyId: target.company_id,
        impersonatedBy: { userId: req.user!.userId, email: req.user!.email },
      },
    },
  });
}));

logger.info('admin-users routes loaded');
export default router;
