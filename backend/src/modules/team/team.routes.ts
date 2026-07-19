/**
 * /team — el ADMIN de una empresa gestiona las capacidades de SU personal (§8).
 *
 *  Distinto de /admin/users (que es del SUPER_ADMIN de plataforma): aquí el
 *  ADMIN de la empresa ve solo a los usuarios de su propia empresa y les
 *  otorga/revoca capacidades finas o aplica una plantilla de rol operativo.
 *
 *  Multi-tenant estricto: solo usuarios con el mismo company_id del JWT.
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authenticateToken, authorize } from '../../middleware/authentication';
import { asyncHandler, ValidationError, NotFoundError } from '../../middleware/errorHandler';
import { query, transaction, transactionQuery } from '../../config/database';
import {
  CAPABILITIES, CAPABILITY_TEMPLATES, isValidCapability, getEffectiveCapabilities,
} from '../auth/capabilities';

const VALID_ROLES = ['USER', 'MANAGER', 'ADMIN'] as const;
const VALID_WORK_GROUPS = ['ADMIN_ALL', 'VENTAS', 'INVENTARIOS', 'COMPRAS', 'TESORERIA'] as const;

const router = Router();
router.use(authenticateToken);
router.use(authorize('ADMIN', 'SUPER_ADMIN'));  // el ADMIN de la empresa

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

/** GET /team/capabilities — catálogo de capacidades + plantillas */
router.get(
  '/capabilities',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        capabilities: Object.entries(CAPABILITIES).map(([key, label]) => ({ key, label })),
        templates: Object.entries(CAPABILITY_TEMPLATES).map(([key, t]) => ({ key, ...t })),
      },
    });
  })
);

/** GET /team/users — usuarios de la empresa con sus capacidades efectivas */
router.get(
  '/users',
  asyncHandler(async (req: Request, res: Response) => {
    const r = await query<any>(
      `SELECT id, email, first_name, last_name, role, work_group,
              is_active, last_login
         FROM users
        WHERE company_id = $1 AND deleted_at IS NULL AND role != 'SUPER_ADMIN'
        ORDER BY role, first_name`,
      [companyId(req)]
    );
    const users = await Promise.all(r.rows.map(async (u: any) => ({
      ...u,
      capabilities: await getEffectiveCapabilities(u.id, u.role),
      // Solo los USER tienen capacidades editables (ADMIN/MANAGER tienen todo)
      editable: u.role === 'USER',
    })));
    res.json({ success: true, data: { users } });
  })
);

/** PUT /team/users/:id/capabilities — fija el conjunto exacto de capacidades de un USER */
router.put(
  '/users/:id/capabilities',
  asyncHandler(async (req: Request, res: Response) => {
    const caps: string[] = Array.isArray(req.body?.capabilities) ? req.body.capabilities : [];
    for (const c of caps) {
      if (!isValidCapability(c)) throw new ValidationError(`Capacidad inválida: ${c}`);
    }

    await transaction(async (client) => {
      const u = await transactionQuery<any>(
        client,
        `SELECT id, role FROM users
          WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [req.params.id, companyId(req)]
      );
      if (u.rows.length === 0) throw new NotFoundError('Usuario no encontrado en tu empresa');
      if (u.rows[0].role !== 'USER') {
        throw new ValidationError('Solo los usuarios con rol USER tienen capacidades editables; ADMIN y MANAGER ya tienen acceso completo.');
      }

      // Reemplazo total del set: borra y reinserta lo enviado
      await transactionQuery(client, `DELETE FROM user_capabilities WHERE user_id = $1`, [req.params.id]);
      for (const c of caps) {
        await transactionQuery(
          client,
          `INSERT INTO user_capabilities (user_id, capability, granted_by)
           VALUES ($1, $2, $3) ON CONFLICT (user_id, capability) DO NOTHING`,
          [req.params.id, c, req.user?.userId]
        );
      }
    });

    const capabilities = await getEffectiveCapabilities(req.params.id, 'USER');
    res.json({ success: true, data: { capabilities } });
  })
);

/**
 * POST /team/users — dar de alta un usuario en la empresa del ADMIN.
 * Body: { email, password, firstName, lastName, role, workGroup }
 *   · role ∈ USER|MANAGER|ADMIN (no permite crear otro SUPER_ADMIN aquí)
 *   · workGroup ∈ ADMIN_ALL|VENTAS|INVENTARIOS|COMPRAS|TESORERIA
 * Idempotente por email (si ya existe activo → error). Password se hashea con bcrypt.
 */
router.post(
  '/users',
  asyncHandler(async (req: Request, res: Response) => {
    const cid = companyId(req);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const firstName = String(req.body?.firstName || '').trim();
    const lastName = String(req.body?.lastName || '').trim();
    const role = String(req.body?.role || 'USER').toUpperCase();
    const workGroup = String(req.body?.workGroup || 'ADMIN_ALL').toUpperCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('Email inválido');
    if (password.length < 8) throw new ValidationError('La contraseña debe tener al menos 8 caracteres');
    if (!firstName) throw new ValidationError('Nombre requerido');
    if (!(VALID_ROLES as readonly string[]).includes(role)) throw new ValidationError(`Rol inválido; usa uno de: ${VALID_ROLES.join(', ')}`);
    if (!(VALID_WORK_GROUPS as readonly string[]).includes(workGroup)) throw new ValidationError(`Grupo inválido; usa uno de: ${VALID_WORK_GROUPS.join(', ')}`);

    const existing = await query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`, [email],
    );
    if ((existing.rowCount ?? 0) > 0) throw new ValidationError('Ese email ya está en uso');

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const r = await query<any>(
      `INSERT INTO users
         (email, password_hash, first_name, last_name, role, work_group, company_id, is_active, failed_login_attempts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,0)
       RETURNING id, email, first_name, last_name, role, work_group, is_active`,
      [email, passwordHash, firstName, lastName || null, role, workGroup, cid],
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  }),
);

/**
 * PATCH /team/users/:id — edición de rol / work_group / estado activo.
 * Body admite: { role?, workGroup?, isActive?, firstName?, lastName? }
 * Solo usuarios de la misma empresa. NO puede tocar SUPER_ADMIN.
 * Un ADMIN NO puede quitarse a sí mismo el rol ADMIN (evita quedarse sin admin).
 */
router.patch(
  '/users/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const cid = companyId(req);
    const targetId = req.params.id;

    const current = await query<{ role: string; is_active: boolean }>(
      `SELECT role, is_active FROM users
        WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL AND role != 'SUPER_ADMIN'`,
      [targetId, cid],
    );
    if (!current.rowCount) throw new NotFoundError('Usuario no encontrado en tu empresa');

    const sets: string[] = [];
    const params: any[] = [];
    const b = req.body || {};

    if (b.role !== undefined) {
      const role = String(b.role).toUpperCase();
      if (!(VALID_ROLES as readonly string[]).includes(role)) throw new ValidationError('Rol inválido');
      if (targetId === req.user?.userId && role !== 'ADMIN') {
        throw new ValidationError('No puedes quitarte a ti mismo el rol ADMIN');
      }
      params.push(role); sets.push(`role = $${params.length}`);
    }
    if (b.workGroup !== undefined) {
      const wg = String(b.workGroup).toUpperCase();
      if (!(VALID_WORK_GROUPS as readonly string[]).includes(wg)) throw new ValidationError('Grupo inválido');
      params.push(wg); sets.push(`work_group = $${params.length}`);
    }
    if (b.isActive !== undefined) {
      if (targetId === req.user?.userId && !b.isActive) {
        throw new ValidationError('No puedes desactivarte a ti mismo');
      }
      params.push(!!b.isActive); sets.push(`is_active = $${params.length}`);
    }
    if (b.firstName !== undefined) {
      params.push(String(b.firstName).trim() || null); sets.push(`first_name = $${params.length}`);
    }
    if (b.lastName !== undefined) {
      params.push(String(b.lastName).trim() || null); sets.push(`last_name = $${params.length}`);
    }
    if (!sets.length) throw new ValidationError('Nada que actualizar');

    params.push(targetId, cid);
    const r = await query<any>(
      `UPDATE users SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length - 1} AND company_id = $${params.length}
        RETURNING id, email, first_name, last_name, role, work_group, is_active`,
      params,
    );
    res.json({ success: true, data: r.rows[0] });
  }),
);

/** DELETE /team/users/:id — soft delete. */
router.delete(
  '/users/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const cid = companyId(req);
    if (req.params.id === req.user?.userId) throw new ValidationError('No puedes eliminarte a ti mismo');
    const r = await query<any>(
      `UPDATE users SET deleted_at = NOW(), is_active = false, updated_at = NOW()
        WHERE id = $1 AND company_id = $2 AND role != 'SUPER_ADMIN' AND deleted_at IS NULL
        RETURNING id`,
      [req.params.id, cid],
    );
    if (!r.rowCount) throw new NotFoundError('Usuario no encontrado');
    res.json({ success: true, data: { removed: 1 } });
  }),
);

export default router;
