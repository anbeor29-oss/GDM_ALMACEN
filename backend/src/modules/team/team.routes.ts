/**
 * /team — el ADMIN de una empresa gestiona a los USER de SU empresa.
 *
 *  GET    /team                   listado de usuarios de mi empresa
 *  POST   /team                   alta de un USER + contraseña temporal
 *  POST   /team/:id/disable       baja (soft — preserva la auditoría)
 *  POST   /team/:id/enable        re-activa
 *  POST   /team/:id/reset-password nueva contraseña temporal
 *
 * Diferencia con /admin/users (que es SOLO del SUPER_ADMIN de la plataforma):
 * aquí el alcance es UNA empresa y un solo rol. Un ADMIN nunca puede crear
 * otro ADMIN ni tocar usuarios de otra empresa.
 *
 * Seguridad — las tres reglas que sostienen el aislamiento:
 *   1. `company_id` SIEMPRE sale del JWT, nunca del body (si viniera del body,
 *      un ADMIN podría crear usuarios en la empresa de otro).
 *   2. Todo UPDATE/SELECT lleva `AND company_id = $mi_empresa`, así un id de
 *      otra empresa responde 404 en vez de operar.
 *   3. Solo se crean/tocan usuarios con rol USER: los ADMIN y SUPER_ADMIN los
 *      sigue administrando la plataforma.
 */
import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError, NotFoundError, ConflictError } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import { audit } from '../admin/admin.middleware';

const router = Router();
router.use(authenticateToken);

/** Solo el ADMIN de una empresa. El SUPER_ADMIN usa /admin/users. */
function requireCompanyAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ success: false, message: 'No autenticado' });
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Solo el administrador de la empresa puede gestionar usuarios',
    });
  }
  if (!req.user.companyId) {
    return res.status(403).json({ success: false, message: 'Tu usuario no tiene empresa asignada' });
  }
  return next();
}
router.use(requireCompanyAdmin);

/** Contraseña temporal legible: "Lima-9248" — fácil de dictar por teléfono. */
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
  const r = await query<any>(
    `SELECT id, email, first_name, last_name, role, is_active,
            password_change_required, last_login, created_at,
            monitoring_enabled, monitoring_email, monitoring_set_at
       FROM users
      WHERE company_id = $1
        AND role IN ('ADMIN', 'USER')
      ORDER BY role, created_at DESC`,
    [req.user!.companyId]
  );
  res.status(200).json({ success: true, data: r.rows });
}));

/* ────────────────────────  CREATE  ──────────────────────── */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { email, firstName, lastName } = req.body as any;
  if (!email || !validEmail(email)) throw new ValidationError('Email inválido');
  if (!firstName || !lastName) throw new ValidationError('Nombre y apellido son requeridos');

  const dup = await query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
  if (dup.rowCount! > 0) throw new ConflictError('Ya existe un usuario con ese email');

  const tempPass = generateTemporaryPassword();
  const hash = await bcrypt.hash(tempPass, 10);

  // El rol va fijo a USER y la empresa sale del JWT: ninguno de los dos se
  // acepta del body, para que un ADMIN no pueda escalar privilegios ni
  // sembrar usuarios en otra empresa.
  const r = await query<any>(
    `INSERT INTO users (email, first_name, last_name, password_hash, role, work_group,
                        company_id, is_active, password_change_required, created_by_user_id)
     VALUES ($1, $2, $3, $4, 'USER', 'VENTAS', $5, true, true, $6)
     RETURNING id, email, first_name, last_name, role, is_active, created_at`,
    [email.toLowerCase(), firstName, lastName, hash, req.user!.companyId, req.user!.userId]
  );
  const user = r.rows[0];
  await audit(req, {
    action: 'TEAM_USER_CREATED', targetKind: 'user', targetId: user.id,
    payload: { email: user.email, companyId: req.user!.companyId },
  });

  // La contraseña temporal se devuelve UNA sola vez: no se persiste en claro
  // ni se puede volver a consultar. Si se pierde, se usa reset-password.
  res.status(201).json({
    success: true,
    message: 'Usuario creado. Comparte la contraseña temporal; se le pedirá cambiarla al entrar.',
    data: { ...user, temporary_password: tempPass },
  });
}));

/** Carga un USER de MI empresa o 404. Centraliza la regla de aislamiento. */
async function findOwnUser(req: Request, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ValidationError('id inválido');
  const r = await query<any>(
    `SELECT id, email, role, is_active FROM users
      WHERE id = $1 AND company_id = $2 AND role = 'USER' LIMIT 1`,
    [id, req.user!.companyId]
  );
  if (r.rowCount === 0) throw new NotFoundError('Usuario no encontrado en tu empresa');
  return r.rows[0];
}

/* ────────────────────────  DISABLE / ENABLE  ──────────────────────── */
router.post('/:id/disable', asyncHandler(async (req: Request, res: Response) => {
  const u = await findOwnUser(req, req.params.id);
  await query('UPDATE users SET is_active = false WHERE id = $1', [u.id]);
  await audit(req, { action: 'TEAM_USER_DISABLED', targetKind: 'user', targetId: u.id,
    payload: { email: u.email } });
  res.status(200).json({ success: true, message: 'Usuario dado de baja' });
}));

router.post('/:id/enable', asyncHandler(async (req: Request, res: Response) => {
  const u = await findOwnUser(req, req.params.id);
  await query('UPDATE users SET is_active = true WHERE id = $1', [u.id]);
  await audit(req, { action: 'TEAM_USER_ENABLED', targetKind: 'user', targetId: u.id,
    payload: { email: u.email } });
  res.status(200).json({ success: true, message: 'Usuario reactivado' });
}));

/* ────────────────────────  MONITOREO  ──────────────────────── */
/**
 * Activa/desactiva el reporte mensual de la bitácora de un USER.
 *
 * OJO con la semántica (cláusula SEXTA del contrato): la actividad de TODOS
 * los usuarios se registra siempre — eso es auditoría, no es opcional. Este
 * interruptor solo decide si se ENVÍA el resumen mensual y a qué correo.
 */
router.put('/:id/monitoring', asyncHandler(async (req: Request, res: Response) => {
  const u = await findOwnUser(req, req.params.id);
  const enabled = req.body?.enabled === true;
  const email = String(req.body?.email || '').trim();

  // La BD tiene un CHECK equivalente; validamos aquí para dar un mensaje útil
  // en vez de un error de constraint.
  if (enabled && !validEmail(email)) {
    throw new ValidationError('Para activar el monitoreo indica un correo válido de destino');
  }

  await query(
    `UPDATE users
        SET monitoring_enabled = $1,
            monitoring_email   = $2,
            monitoring_set_by  = $3,
            monitoring_set_at  = NOW()
      WHERE id = $4`,
    [enabled, enabled ? email.toLowerCase() : null, req.user!.userId, u.id]
  );

  await audit(req, {
    action: enabled ? 'TEAM_MONITORING_ENABLED' : 'TEAM_MONITORING_DISABLED',
    targetKind: 'user', targetId: u.id,
    payload: { email: u.email, reportTo: enabled ? email : null },
  });

  res.status(200).json({
    success: true,
    message: enabled
      ? `Reporte mensual activado. Se enviará a ${email}.`
      : 'Reporte mensual desactivado. La actividad se sigue registrando en la bitácora.',
  });
}));

/**
 * Bitácora de un USER de mi empresa. Confidencial: solo el ADMIN de la propia
 * empresa (findOwnUser garantiza el aislamiento).
 */
router.get('/:id/activity', asyncHandler(async (req: Request, res: Response) => {
  const u = await findOwnUser(req, req.params.id);
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '100'), 10)));
  const r = await query<any>(
    `SELECT ts, action, entity, entity_id, method, path, status_code, ip
       FROM user_activity_log
      WHERE user_id = $1 AND company_id = $2
      ORDER BY ts DESC
      LIMIT $3`,
    [u.id, req.user!.companyId, limit]
  );
  res.status(200).json({ success: true, data: { user: u.email, rows: r.rows } });
}));

/* ────────────────────────  RESET PASSWORD  ──────────────────────── */
router.post('/:id/reset-password', asyncHandler(async (req: Request, res: Response) => {
  const u = await findOwnUser(req, req.params.id);
  const tempPass = generateTemporaryPassword();
  const hash = await bcrypt.hash(tempPass, 10);
  await query(
    'UPDATE users SET password_hash = $1, password_change_required = true WHERE id = $2',
    [hash, u.id]
  );
  await audit(req, { action: 'TEAM_USER_PASSWORD_RESET', targetKind: 'user', targetId: u.id,
    payload: { email: u.email } });
  res.status(200).json({
    success: true,
    message: 'Contraseña temporal generada. Se le pedirá cambiarla al entrar.',
    data: { temporary_password: tempPass },
  });
}));

/* ══════════════════════════════════════════════════════════════════════════
 * /team/users — pantalla "Equipo y permisos"
 *
 * La fusión de los dos productos dejó viva la versión de ALMACÉN de este
 * router (solo /team, /team/:id/...) mientras el frontend ya hablaba con
 * /team/users*. Resultado: la pantalla de Equipo cargaba vacía y el alta
 * respondía 404. Se restauran aquí, sobre las mismas tres reglas de
 * aislamiento del encabezado.
 *
 * Qué se puede tocar y qué no:
 *   · role  → USER o MANAGER. Un ADMIN NO puede crear ni ascender a otro
 *     ADMIN: eso es alta de plataforma y la hace el SUPER_ADMIN.
 *   · work_group → cualquiera del vocabulario; decide qué pantallas ve.
 *   · capabilities → solo para USER (ADMIN/MANAGER ya tienen todas).
 * ══════════════════════════════════════════════════════════════════════════ */

/** Vocabulario único de grupos — espejo del CHECK de users.work_group
 *  (migración 2026-07-28c) y de middleware/permissions.ts. */
const WORK_GROUPS = ['ADMIN_ALL', 'VENTAS', 'ALMACEN', 'COMPRAS', 'TESORERIA'];

/** Roles que un ADMIN de empresa puede asignar dentro de su propia empresa. */
const ASSIGNABLE_ROLES = ['USER', 'MANAGER'];

function normalizeWorkGroup(raw: unknown): string {
  const wg = String(raw || 'ADMIN_ALL').toUpperCase().trim();
  if (!WORK_GROUPS.includes(wg)) {
    throw new ValidationError(
      `Grupo de trabajo inválido: "${wg}". Válidos: ${WORK_GROUPS.join(', ')}`
    );
  }
  return wg;
}

/** GET /team/capabilities — catálogo + plantillas para el modal. */
router.get('/capabilities', asyncHandler(async (_req: Request, res: Response) => {
  const { CAPABILITIES, CAPABILITY_TEMPLATES } = await import('../auth/capabilities');
  res.status(200).json({
    success: true,
    data: {
      capabilities: Object.entries(CAPABILITIES).map(([key, label]) => ({ key, label })),
      templates: Object.entries(CAPABILITY_TEMPLATES).map(([key, t]) => ({
        key, label: t.label, caps: t.caps,
      })),
    },
  });
}));

/** GET /team/users — personal de mi empresa con su grupo y capacidades. */
router.get('/users', asyncHandler(async (req: Request, res: Response) => {
  const r = await query<any>(
    `SELECT id, email, first_name, last_name, role, work_group, is_active,
            password_change_required, last_login, created_at
       FROM users
      WHERE company_id = $1
        AND role IN ('ADMIN', 'MANAGER', 'USER')
      ORDER BY role, first_name`,
    [req.user!.companyId]
  );

  const { getEffectiveCapabilities } = await import('../auth/capabilities');
  const users = await Promise.all(
    r.rows.map(async (u) => ({
      ...u,
      // 'editable' = tiene sentido darle capacidades finas. ADMIN y MANAGER
      // las tienen todas por rol, así que el modal no aplica.
      editable: u.role === 'USER',
      capabilities: u.role === 'USER'
        ? await getEffectiveCapabilities(u.id, u.role)
        : [],
    }))
  );

  res.status(200).json({ success: true, data: { users } });
}));

/** POST /team/users — alta con rol, grupo y contraseña elegida por el ADMIN. */
router.post('/users', asyncHandler(async (req: Request, res: Response) => {
  const { email, password, firstName, lastName, role } = req.body as any;
  if (!email || !validEmail(email)) throw new ValidationError('Email inválido');
  if (!firstName) throw new ValidationError('El nombre es requerido');

  const workGroup = normalizeWorkGroup(req.body?.workGroup);
  const finalRole = String(role || 'USER').toUpperCase();
  if (!ASSIGNABLE_ROLES.includes(finalRole)) {
    throw new ValidationError(
      'Solo puedes dar de alta usuarios Operativos o Gerentes. ' +
      'Los administradores los crea la plataforma.'
    );
  }

  const dup = await query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
  if (dup.rowCount! > 0) throw new ConflictError('Ya existe un usuario con ese email');

  // El ADMIN puede dictar la contraseña temporal; si la deja en blanco se
  // genera una legible. En ambos casos se exige cambiarla al primer login.
  const tempPass = password && String(password).length >= 8
    ? String(password)
    : generateTemporaryPassword();
  const hash = await bcrypt.hash(tempPass, 10);

  const r = await query<any>(
    `INSERT INTO users (email, first_name, last_name, password_hash, role, work_group,
                        company_id, is_active, password_change_required, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, true, $8)
     RETURNING id, email, first_name, last_name, role, work_group, is_active, created_at`,
    [email.toLowerCase(), firstName, lastName || '', hash, finalRole, workGroup,
     req.user!.companyId, req.user!.userId]
  );
  const user = r.rows[0];
  await audit(req, {
    action: 'TEAM_USER_CREATED', targetKind: 'user', targetId: user.id,
    payload: { email: user.email, role: finalRole, workGroup },
  });

  res.status(201).json({
    success: true,
    message: 'Usuario creado. Comparte la contraseña temporal; se le pedirá cambiarla al entrar.',
    data: { ...user, temporary_password: tempPass },
  });
}));

/** Carga un usuario editable de MI empresa (USER o MANAGER) o 404. */
async function findEditableUser(req: Request, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ValidationError('id inválido');
  const r = await query<any>(
    `SELECT id, email, role, is_active FROM users
      WHERE id = $1 AND company_id = $2 AND role IN ('USER', 'MANAGER') LIMIT 1`,
    [id, req.user!.companyId]
  );
  if (r.rowCount === 0) {
    throw new NotFoundError(
      'Usuario no encontrado en tu empresa (o es un administrador, que solo edita la plataforma)'
    );
  }
  return r.rows[0];
}

/** PATCH /team/users/:id — nombre, rol, grupo de trabajo y estado. */
router.patch('/users/:id', asyncHandler(async (req: Request, res: Response) => {
  const u = await findEditableUser(req, req.params.id);
  const { firstName, lastName, role, workGroup, isActive } = req.body as any;

  const sets: string[] = [];
  const vals: any[] = [];
  const push = (col: string, val: any) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

  if (firstName !== undefined) push('first_name', firstName);
  if (lastName  !== undefined) push('last_name', lastName);
  if (isActive  !== undefined) push('is_active', !!isActive);
  if (workGroup !== undefined) push('work_group', normalizeWorkGroup(workGroup));
  if (role !== undefined) {
    const nr = String(role).toUpperCase();
    if (!ASSIGNABLE_ROLES.includes(nr)) {
      throw new ValidationError('Solo puedes asignar rol Operativo o Gerente');
    }
    push('role', nr);
  }
  if (sets.length === 0) throw new ValidationError('Nada que actualizar');

  vals.push(u.id);
  const r = await query<any>(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length}
     RETURNING id, email, first_name, last_name, role, work_group, is_active`,
    vals
  );
  await audit(req, {
    action: 'TEAM_USER_UPDATED', targetKind: 'user', targetId: u.id,
    payload: { email: u.email, changes: Object.keys(req.body || {}) },
  });
  res.status(200).json({ success: true, data: r.rows[0] });
}));

/**
 * DELETE /team/users/:id — baja SUAVE.
 *
 * No se borra la fila: el usuario firma facturas, movimientos de inventario y
 * bitácora, y un DELETE dejaría esos registros sin autor. Se desactiva, que es
 * lo que el negocio realmente quiere decir con "eliminar a alguien del equipo".
 */
router.delete('/users/:id', asyncHandler(async (req: Request, res: Response) => {
  const u = await findEditableUser(req, req.params.id);
  await query('UPDATE users SET is_active = false WHERE id = $1', [u.id]);
  await audit(req, { action: 'TEAM_USER_DISABLED', targetKind: 'user', targetId: u.id,
    payload: { email: u.email } });
  res.status(200).json({ success: true, message: 'Usuario desactivado' });
}));

/** PUT /team/users/:id/capabilities — reemplaza el set otorgado (solo USER). */
router.put('/users/:id/capabilities', asyncHandler(async (req: Request, res: Response) => {
  const u = await findEditableUser(req, req.params.id);
  if (u.role !== 'USER') {
    throw new ValidationError('Los gerentes ya tienen todas las capacidades operativas');
  }
  const { isValidCapability } = await import('../auth/capabilities');
  const caps: string[] = Array.isArray(req.body?.capabilities) ? req.body.capabilities : [];
  const invalid = caps.filter((c) => !isValidCapability(c));
  if (invalid.length) throw new ValidationError(`Capacidades desconocidas: ${invalid.join(', ')}`);

  // Reemplazo completo: el modal manda el set final, no un delta.
  await query('DELETE FROM user_capabilities WHERE user_id = $1', [u.id]);
  for (const c of caps) {
    await query(
      `INSERT INTO user_capabilities (user_id, capability, granted_by)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [u.id, c, req.user!.userId]
    );
  }
  await audit(req, {
    action: 'TEAM_CAPABILITIES_SET', targetKind: 'user', targetId: u.id,
    payload: { email: u.email, capabilities: caps },
  });
  res.status(200).json({ success: true, data: { capabilities: caps } });
}));

export default router;
