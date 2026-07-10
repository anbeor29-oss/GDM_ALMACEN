/**
 * /admin/audit — consulta del audit_log (solo SUPER_ADMIN).
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import { requireSuperAdmin } from './admin.middleware';

const router = Router();
router.use(authenticateToken);
router.use(requireSuperAdmin);

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const limit  = Math.min(500, Math.max(1, parseInt(String(req.query.limit  || '100'), 10)));
  const filters: string[] = ['1=1'];
  const params: any[] = [];
  const userId    = String(req.query.userId    || '');
  const targetId  = String(req.query.targetId  || '');
  const action    = String(req.query.action    || '');
  if (/^[0-9a-f-]{36}$/i.test(userId))   { params.push(userId);   filters.push(`user_id   = $${params.length}`); }
  if (/^[0-9a-f-]{36}$/i.test(targetId)) { params.push(targetId); filters.push(`target_id = $${params.length}`); }
  if (action)                            { params.push(action);   filters.push(`action    = $${params.length}`); }
  params.push(limit);
  const r = await query<any>(
    `SELECT id, ts, user_email, role, action, target_kind, target_id, ip, payload
       FROM audit_log
      WHERE ${filters.join(' AND ')}
      ORDER BY ts DESC LIMIT $${params.length}`,
    params
  );
  res.json({ success: true, data: { entries: r.rows } });
}));

export default router;
