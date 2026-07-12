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
import { authenticateToken, authorize } from '../../middleware/authentication';
import { asyncHandler, ValidationError, NotFoundError } from '../../middleware/errorHandler';
import { query, transaction, transactionQuery } from '../../config/database';
import {
  CAPABILITIES, CAPABILITY_TEMPLATES, isValidCapability, getEffectiveCapabilities,
} from '../auth/capabilities';

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
      `SELECT id, email, first_name, last_name, role, is_active, last_login
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

export default router;
