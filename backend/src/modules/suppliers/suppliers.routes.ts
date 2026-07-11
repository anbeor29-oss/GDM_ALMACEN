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
import { authenticateToken, authorize } from '../../middleware/authentication';
import { asyncHandler, ValidationError, NotFoundError } from '../../middleware/errorHandler';
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
              -- Condiciones de crédito (§4)
              credit_days, credit_line, credit_used, payment_conditions,
              delivery_days_avg, supplier_rating,
              -- Métricas útiles
              (SELECT COUNT(*)::int FROM xml_imports xi
                 WHERE xi.company_id = customers.company_id
                   AND xi.created_customer_id = customers.id) AS imports_count,
              (SELECT COALESCE(SUM(amount), 0) FROM supplier_payments_schedule sp
                 WHERE sp.supplier_id = customers.id AND sp.status = 'PENDING') AS pending_payments
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

/**
 * PUT /suppliers/:id/credit — condiciones de crédito del proveedor (§4).
 *  Solo ADMIN/MANAGER. Los days_credito controlan la fecha de vencimiento de
 *  los pagos que se programan al importar cada compra XML.
 */
router.put(
  '/:id/credit',
  authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const b = req.body || {};
    const creditDays = b.creditDays != null ? parseInt(String(b.creditDays), 10) : null;
    const creditLine = b.creditLine != null ? Number(b.creditLine) : null;
    if (creditDays != null && (isNaN(creditDays) || creditDays < 0 || creditDays > 365)) {
      throw new ValidationError('Los días de crédito deben estar entre 0 y 365');
    }
    if (creditLine != null && (isNaN(creditLine) || creditLine < 0)) {
      throw new ValidationError('La línea de crédito no puede ser negativa');
    }
    const rating = b.supplierRating != null ? parseInt(String(b.supplierRating), 10) : null;
    if (rating != null && (rating < 1 || rating > 5)) {
      throw new ValidationError('La evaluación debe estar entre 1 y 5');
    }
    const deliveryDays = b.deliveryDaysAvg != null ? parseInt(String(b.deliveryDaysAvg), 10) : null;

    const r = await query<any>(
      `UPDATE customers SET
          credit_days        = COALESCE($1, credit_days),
          credit_line        = COALESCE($2, credit_line),
          payment_conditions = COALESCE($3, payment_conditions),
          supplier_rating    = COALESCE($4, supplier_rating),
          delivery_days_avg  = COALESCE($5, delivery_days_avg),
          updated_at = NOW()
        WHERE id = $6 AND company_id = $7 AND party_type = 'SUPPLIER' AND deleted_at IS NULL
        RETURNING id, business_name, credit_days, credit_line, credit_used,
                  payment_conditions, supplier_rating, delivery_days_avg`,
      [creditDays, creditLine,
       b.paymentConditions != null ? String(b.paymentConditions).trim() : null,
       rating, deliveryDays, req.params.id, companyId(req)]
    );
    if (r.rows.length === 0) throw new NotFoundError('Proveedor no encontrado');
    res.json({ success: true, data: r.rows[0] });
  })
);

export default router;
