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
const VALID_WORK_GROUPS: string[] = ['ADMIN_ALL', 'VENTAS', 'ALMACEN', 'COMPRAS', 'TESORERIA'];

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
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.work_group, u.is_active,
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
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.work_group, u.is_active,
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
  const workGroup = String(req.body?.workGroup || 'ADMIN_ALL').toUpperCase();
  if (!email || !validEmail(email)) throw new ValidationError('Email inválido');
  if (!firstName || !lastName)      throw new ValidationError('firstName y lastName son requeridos');
  if (!VALID_ROLES.includes(role))  throw new ValidationError(`role inválido. Válidos: ${VALID_ROLES.join(', ')}`);
  if (!VALID_WORK_GROUPS.includes(workGroup)) {
    throw new ValidationError(`workGroup inválido. Válidos: ${VALID_WORK_GROUPS.join(', ')}`);
  }
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
    `INSERT INTO users (email, first_name, last_name, password_hash, role, work_group,
                        company_id, is_active, password_change_required, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, true, $8)
     RETURNING id, email, role, work_group, company_id, password_change_required, created_at`,
    [email.toLowerCase(), firstName, lastName, hash, role, workGroup,
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
  const { firstName, lastName, role, companyId, workGroup } = req.body as any;
  const fields: string[] = [];
  const params: any[] = [];
  const push = (f: string, v: any) => { params.push(v); fields.push(`${f} = $${params.length}`); };

  if (firstName) push('first_name', firstName);
  if (lastName)  push('last_name',  lastName);
  if (role) {
    if (!VALID_ROLES.includes(role)) throw new ValidationError('role inválido');
    push('role', role);
  }
  if (workGroup) {
    const wg = String(workGroup).toUpperCase();
    if (!VALID_WORK_GROUPS.includes(wg)) throw new ValidationError('workGroup inválido');
    push('work_group', wg);
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

/* ────────────────────────  BORRADO DEFINITIVO  ────────────────────────
 * DELETE /admin/users/:id?confirmEmail=...
 *
 * Solo borra usuarios SIN historial. No es una limitación técnica que haya que
 * sortear: es la regla correcta.
 *
 * Ocho tablas referencian users(id) con ON DELETE NO ACTION —
 * companies.csd_uploaded_by_user_id, service_contracts.signed_by_user,
 * sw_manifests.signed_by_user, pos_sales.sold_by, monthly_invoicing.generated_by,
 * prepaid_stamp_purchases.granted_by, users.created_by_user_id y
 * users.monitoring_set_by. Borrar a quien firmó un contrato o subió un CSD
 * destruiría la evidencia de QUIÉN lo hizo, en un sistema que debe conservar
 * rastro fiscal 5 años.
 *
 * Por eso: si el usuario tiene historial, se rechaza con el detalle de qué lo
 * ata y se sugiere darlo de baja (soft), que preserva la auditoría. El borrado
 * real queda para el caso legítimo: el usuario capturado por error que nunca
 * operó.
 *
 * audit_log, user_activity_log y xml_imports son ON DELETE SET NULL: conservan
 * `user_email`, así que el rastro sobrevive al borrado aunque se pierda el id.
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ValidationError('id inválido');

  const uR = await query<any>('SELECT id, email, role FROM users WHERE id = $1', [id]);
  if (uR.rows.length === 0) throw new NotFoundError('Usuario no encontrado');
  const user = uR.rows[0];

  // Confirmación server-side: hay que escribir el email exacto. Mismo patrón
  // que el borrado de empresa — la fricción es deliberada.
  const confirmEmail = String(req.query.confirmEmail || req.body?.confirmEmail || '').toLowerCase().trim();
  if (confirmEmail !== String(user.email).toLowerCase()) {
    throw new ValidationError(
      `Para borrar definitivamente escribe el correo exacto del usuario: ${user.email}`
    );
  }

  // Nadie se borra a sí mismo: quedarías fuera de tu propia plataforma.
  if (id === req.user!.userId) {
    throw new ValidationError('No puedes borrar tu propio usuario');
  }

  // ¿Qué lo ata? Se consulta ANTES para dar un error útil en vez de un
  // "violación de llave foránea" que no le dice nada al operador.
  const blockers: Array<{ que: string; n: number }> = [];
  const count = async (label: string, sql: string) => {
    const r = await query<{ n: string }>(sql, [id]);
    const n = parseInt(r.rows[0]?.n || '0', 10);
    if (n > 0) blockers.push({ que: label, n });
  };
  await count('subió el CSD de una empresa', 'SELECT COUNT(*) n FROM companies WHERE csd_uploaded_by_user_id = $1');
  await count('firmó el contrato de servicios', 'SELECT COUNT(*) n FROM service_contracts WHERE signed_by_user = $1');
  await count('firmó un manifiesto del PAC', 'SELECT COUNT(*) n FROM sw_manifests WHERE signed_by_user = $1');
  // La columna es user_id, no sold_by: al fusionar los dos productos el
  // esquema de pos_sales convergió en el de ALMACÉN (ver la migración
  // 2026-07-28_fusion_pos_unificado.sql). Con el nombre viejo, intentar
  // borrar un usuario reventaba con "column sold_by does not exist".
  await count('registró ventas en el punto de venta', 'SELECT COUNT(*) n FROM pos_sales WHERE user_id = $1');
  await count('generó una facturación mensual', 'SELECT COUNT(*) n FROM monthly_invoicing WHERE generated_by = $1');
  await count('otorgó timbres prepago', 'SELECT COUNT(*) n FROM prepaid_stamp_purchases WHERE granted_by = $1');
  await count('creó otros usuarios', 'SELECT COUNT(*) n FROM users WHERE created_by_user_id = $1');
  await count('configuró el monitoreo de otros usuarios', 'SELECT COUNT(*) n FROM users WHERE monitoring_set_by = $1');

  if (blockers.length > 0) {
    throw new ConflictError(
      `No se puede borrar a ${user.email}: tiene historial que es evidencia y debe conservarse (` +
      blockers.map((b) => `${b.que}: ${b.n}`).join('; ') +
      `). Dalo de baja en vez de borrarlo: deja de poder entrar y se preserva la auditoría.`
    );
  }

  await query('DELETE FROM users WHERE id = $1', [id]);
  await audit(req, {
    action: 'USER_DELETED', targetKind: 'user', targetId: id,
    payload: { email: user.email, role: user.role },
  });
  logger.warn(`Usuario BORRADO definitivamente: ${user.email} (por ${req.user?.email})`);

  res.json({ success: true, message: `Usuario ${user.email} borrado definitivamente.` });
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

/* ══════════════════════════════════════════════════════════════════════════
 * PERMISOS DEL USUARIO — grupo de trabajo + capacidades finas
 *
 * Los mismos datos que gestiona el ADMIN de una empresa en /team, pero desde
 * el panel de plataforma. Existe por separado porque /team los bloquea a
 * propósito para el SUPER_ADMIN: aquel router exige rol ADMIN y filtra por la
 * empresa del JWT, y el SUPER_ADMIN no tiene empresa.
 *
 * Las dos capas son distintas y conviene no confundirlas:
 *   · work_group  → QUÉ PANTALLAS ve (lo decide GROUP_MODULES)
 *   · capacidades → QUÉ PUEDE HACER dentro de ellas (requireCapability)
 * ADMIN, MANAGER y SUPER_ADMIN tienen todas las capacidades por su rol, así
 * que las finas solo tienen sentido para un USER.
 * ══════════════════════════════════════════════════════════════════════════ */

/** GET /admin/users/:id/permissions — estado actual + catálogos para la UI. */
router.get('/:id/permissions', asyncHandler(async (req: Request, res: Response) => {
  const r = await query<any>(
    `SELECT id, email, first_name, last_name, role, work_group, company_id
       FROM users WHERE id = $1`,
    [req.params.id]
  );
  if (r.rows.length === 0) throw new NotFoundError('Usuario no encontrado');
  const u = r.rows[0];

  const { CAPABILITIES, CAPABILITY_TEMPLATES, getEffectiveCapabilities } =
    await import('../auth/capabilities');
  const { GROUP_MODULES } = await import('../../middleware/permissions');

  // Otorgamientos explícitos (lo que el operador puede marcar y desmarcar),
  // separados de las efectivas (que incluyen la base que da el rol).
  const granted = await query<{ capability: string }>(
    `SELECT capability FROM user_capabilities WHERE user_id = $1`, [u.id]
  );

  res.json({
    success: true,
    data: {
      user: u,
      work_group: u.work_group,
      /** Módulos que ve hoy con ese grupo — para enseñarlos sin adivinar. */
      modules: (GROUP_MODULES as any)[u.work_group] || [],
      granted_capabilities: granted.rows.map((x) => x.capability),
      effective_capabilities: await getEffectiveCapabilities(u.id, u.role),
      /** El rol ya se las da todas: la UI desactiva el bloque. */
      capabilities_apply: u.role === 'USER',
      catalog: Object.entries(CAPABILITIES).map(([key, label]) => ({ key, label })),
      templates: Object.entries(CAPABILITY_TEMPLATES).map(([key, t]) => ({
        key, label: t.label, caps: t.caps,
      })),
    },
  });
}));

/** PUT /admin/users/:id/permissions — { workGroup?, capabilities? } */
router.put('/:id/permissions', asyncHandler(async (req: Request, res: Response) => {
  const { workGroup, capabilities } = req.body as any;

  const r = await query<any>('SELECT id, email, role FROM users WHERE id = $1', [req.params.id]);
  if (r.rows.length === 0) throw new NotFoundError('Usuario no encontrado');
  const u = r.rows[0];

  if (workGroup !== undefined) {
    const wg = String(workGroup).toUpperCase();
    if (!VALID_WORK_GROUPS.includes(wg)) {
      throw new ValidationError(`workGroup inválido. Válidos: ${VALID_WORK_GROUPS.join(', ')}`);
    }
    await query('UPDATE users SET work_group = $1, updated_at = NOW() WHERE id = $2', [wg, u.id]);
  }

  if (capabilities !== undefined) {
    if (u.role !== 'USER') {
      throw new ValidationError(
        `${u.email} tiene rol ${u.role}, que ya incluye todas las capacidades operativas. ` +
        'Las capacidades finas solo aplican a usuarios operativos (USER).'
      );
    }
    const { isValidCapability } = await import('../auth/capabilities');
    const caps: string[] = Array.isArray(capabilities) ? capabilities : [];
    const invalid = caps.filter((c) => !isValidCapability(c));
    if (invalid.length) throw new ValidationError(`Capacidades desconocidas: ${invalid.join(', ')}`);

    // Reemplazo completo: la pantalla manda el set final, no un delta.
    await query('DELETE FROM user_capabilities WHERE user_id = $1', [u.id]);
    for (const c of caps) {
      await query(
        `INSERT INTO user_capabilities (user_id, capability, granted_by)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [u.id, c, req.user!.userId]
      );
    }
  }

  await audit(req, {
    action: 'USER_PERMISSIONS_UPDATED', targetKind: 'user', targetId: u.id,
    payload: { email: u.email, workGroup, capabilities },
  });
  res.json({ success: true, message: 'Permisos actualizados' });
}));

logger.info('admin-users routes loaded');
export default router;
