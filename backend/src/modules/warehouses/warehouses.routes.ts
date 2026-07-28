/**
 * /warehouses — catálogo de almacenes por empresa (§7 ALMACEN.MD).
 *
 *  Lectura: cualquier usuario autenticado de la empresa.
 *  Escritura: ADMIN/MANAGER. Baja = soft-delete; bloqueada si el almacén
 *  tiene existencias o es el default.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, authorize } from '../../middleware/authentication';
import { asyncHandler, ValidationError, NotFoundError, ConflictError } from '../../middleware/errorHandler';
import { query, transaction, transactionQuery } from '../../config/database';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

/** GET /warehouses — lista con métricas de existencias */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const includeInactive = req.query.includeInactive === 'true';
    const params: any[] = [companyId(req)];
    const filters = ['w.company_id = $1', 'w.deleted_at IS NULL'];
    if (!includeInactive) filters.push('w.is_active = true');

    const r = await query<any>(
      `SELECT w.id, w.code, w.name, w.address, w.is_default, w.is_active, w.created_at,
              COUNT(ws.id) FILTER (WHERE ws.quantity > 0)          AS products_with_stock,
              COALESCE(SUM(ws.quantity), 0)                        AS total_units,
              COALESCE(SUM(ws.quantity * ws.avg_cost), 0)          AS total_value
         FROM warehouses w
         LEFT JOIN warehouse_stock ws ON ws.warehouse_id = w.id
        WHERE ${filters.join(' AND ')}
        GROUP BY w.id
        ORDER BY w.is_default DESC, w.code ASC`,
      params
    );

    res.json({ success: true, data: { warehouses: r.rows } });
  })
);

/** POST /warehouses — alta */
router.post(
  '/',
  authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const code = String(req.body?.code || '').trim().toUpperCase();
    const name = String(req.body?.name || '').trim();
    const address = req.body?.address ? String(req.body.address).trim() : null;
    if (!code || !name) throw new ValidationError('code y name son obligatorios');
    if (!/^[A-Z0-9_-]{1,20}$/.test(code)) {
      throw new ValidationError('code: máx 20 caracteres, solo letras/números/guiones');
    }

    const result = await transaction(async (client) => {
      // Primer almacén de la empresa → default automático
      const countR = await transactionQuery<{ n: string }>(
        client,
        `SELECT COUNT(*)::text AS n FROM warehouses WHERE company_id = $1 AND deleted_at IS NULL`,
        [companyId(req)]
      );
      const isFirst = Number(countR.rows[0].n) === 0;

      const ins = await transactionQuery<any>(
        client,
        `INSERT INTO warehouses (company_id, code, name, address, is_default)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, code, name, address, is_default, is_active, created_at`,
        [companyId(req), code, name, address, isFirst]
      );
      return ins.rows[0];
    }).catch((e: any) => {
      if (e?.code === '23505') throw new ConflictError(`Ya existe un almacén con código ${code}`);
      throw e;
    });

    res.status(201).json({ success: true, data: result });
  })
);

/** PUT /warehouses/:id — edición (nombre, dirección, activo, default) */
router.put(
  '/:id',
  authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, address, isActive, isDefault } = req.body || {};

    const result = await transaction(async (client) => {
      const curR = await transactionQuery<any>(
        client,
        `SELECT id, is_default FROM warehouses
          WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [req.params.id, companyId(req)]
      );
      if (curR.rows.length === 0) throw new NotFoundError('Almacén no encontrado');
      const current = curR.rows[0];

      if (current.is_default && isActive === false) {
        throw new ConflictError('El almacén default no puede desactivarse — asigna otro default primero');
      }

      // Cambiar default: quitar el actual y poner este (índice único parcial lo garantiza)
      if (isDefault === true && !current.is_default) {
        await transactionQuery(
          client,
          `UPDATE warehouses SET is_default = false
            WHERE company_id = $1 AND is_default = true AND deleted_at IS NULL`,
          [companyId(req)]
        );
      }

      const upd = await transactionQuery<any>(
        client,
        `UPDATE warehouses SET
            name       = COALESCE($1, name),
            address    = COALESCE($2, address),
            is_active  = COALESCE($3, is_active),
            is_default = COALESCE($4, is_default)
          WHERE id = $5
          RETURNING id, code, name, address, is_default, is_active`,
        [name != null ? String(name).trim() : null,
         address != null ? String(address).trim() : null,
         typeof isActive === 'boolean' ? isActive : null,
         isDefault === true ? true : null,
         req.params.id]
      );
      return upd.rows[0];
    });

    res.json({ success: true, data: result });
  })
);

/** DELETE /warehouses/:id — soft-delete, bloqueado con stock o siendo default */
router.delete(
  '/:id',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    await transaction(async (client) => {
      const curR = await transactionQuery<any>(
        client,
        `SELECT id, is_default FROM warehouses
          WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [req.params.id, companyId(req)]
      );
      if (curR.rows.length === 0) throw new NotFoundError('Almacén no encontrado');
      if (curR.rows[0].is_default) {
        throw new ConflictError('El almacén default no puede eliminarse — asigna otro default primero');
      }

      const stockR = await transactionQuery<{ n: string }>(
        client,
        `SELECT COUNT(*)::text AS n FROM warehouse_stock
          WHERE warehouse_id = $1 AND quantity > 0`,
        [req.params.id]
      );
      if (Number(stockR.rows[0].n) > 0) {
        throw new ConflictError(
          'El almacén tiene existencias — traspásalas a otro almacén antes de eliminarlo'
        );
      }

      await transactionQuery(
        client,
        `UPDATE warehouses SET deleted_at = NOW(), is_active = false WHERE id = $1`,
        [req.params.id]
      );
    });

    res.json({ success: true, message: 'Almacén eliminado' });
  })
);

export default router;
