/**
 * /suppliers — vista filtrada de la tabla `customers` con party_type='SUPPLIER'.
 *
 *  Es read-only por contrato (no exponemos POST/PUT/DELETE aquí). Si en el
 *  futuro queremos editar proveedores, se usa el endpoint genérico /customers
 *  — aquí mantenemos la disciplina UI/UX que pidió el negocio.
 *
 *  Seguridad: authenticateToken obligatorio, filtro estricto por company_id
 *  del JWT (OWASP A01).
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import { query } from '../../config/database';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const search = String(req.query.search || '').trim();
    const limit  = Math.min(500, Math.max(1, parseInt(String(req.query.limit  || '100'), 10)));
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10));

    const params: any[] = [companyId(req)];
    const filters = ['company_id = $1', 'party_type = \'SUPPLIER\'', 'deleted_at IS NULL'];
    if (search) {
      params.push(`%${search}%`);
      filters.push(`(business_name ILIKE $${params.length} OR rfc ILIKE $${params.length})`);
    }
    params.push(limit, offset);

    const r = await query<any>(
      `SELECT id, rfc, business_name, fiscal_regime, postal_code,
              state, municipality, city, neighborhood, street, ext_number,
              email, phone, contact_person, created_at,
              -- Métricas útiles aunque no se pueda editar
              (SELECT COUNT(*)::int FROM xml_imports xi
                 WHERE xi.company_id = customers.company_id
                   AND xi.created_customer_id = customers.id) AS imports_count
         FROM customers
        WHERE ${filters.join(' AND ')}
        ORDER BY business_name ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const totalR = await query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM customers
        WHERE ${filters.join(' AND ')}`,
      params.slice(0, -2)
    );

    res.json({
      success: true,
      data: {
        suppliers: r.rows,
        total: Number(totalR.rows[0].total),
        readonly: true,
      },
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const r = await query<any>(
      `SELECT * FROM customers
        WHERE id = $1 AND company_id = $2 AND party_type = 'SUPPLIER' AND deleted_at IS NULL`,
      [req.params.id, companyId(req)]
    );
    if (r.rows.length === 0) throw new ValidationError('Proveedor no encontrado');
    res.json({ success: true, data: r.rows[0] });
  })
);

export default router;
