/**
 * Invoices Routes
 */

import { Router } from 'express';
import { Request, Response } from 'express';
import * as invoicesController from './invoices.controller';
import { getInvoiceBalance } from '../credit-notes/credit-notes.service';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Specific routes BEFORE parameterized routes
/**
 * GET /api/v1/invoices/customer/:customerId/invoices
 * Get customer invoices
 */
router.get(
  '/customer/:customerId/invoices',
  asyncHandler(invoicesController.getCustomerInvoices)
);

/**
 * POST /api/v1/invoices
 * Create invoice with automatic calculations
 */
router.post(
  '/',
  asyncHandler(invoicesController.createInvoice)
);

/**
 * GET /api/v1/invoices
 * List invoices with filters
 */
router.get(
  '/',
  asyncHandler(invoicesController.listInvoices)
);

/**
 * GET /api/v1/invoices/dashboard/summary
 * IMPORTANTE: definido ANTES de /:id/summary para que "dashboard" no entre
 * como :id (que es uuid y truena con "input syntax for type uuid").
 */
router.get(
  '/dashboard/summary',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.companyId) throw new ValidationError('Company ID is required');
    const { query } = await import('../../config/database');
    const r = await query<any>(
      `WITH inv AS (
         SELECT i.id, i.total, i.status, i.date_issued, i.cfdi_type,
           COALESCE((SELECT SUM(payment_amount) FROM payments
                      WHERE invoice_id = i.id AND deleted_at IS NULL
                        AND document_status != 'CANCELLED'), 0) AS paid,
           COALESCE((SELECT SUM(total) FROM credit_notes
                      WHERE invoice_id = i.id AND deleted_at IS NULL AND status != 'CANCELLED'), 0) AS credited
         FROM invoices i
         WHERE i.company_id = $1 AND i.deleted_at IS NULL
           AND i.status NOT IN ('DRAFT', 'CANCELLED')
           AND i.cfdi_type = 'I'
       )
       SELECT
         COUNT(*)::int                                          AS facturas,
         COALESCE(SUM(total), 0)::numeric                       AS total_facturado,
         COALESCE(SUM(paid), 0)::numeric                        AS total_cobrado,
         COALESCE(SUM(credited), 0)::numeric                    AS total_acreditado,
         COALESCE(SUM(GREATEST(0, total - paid - credited)), 0)::numeric AS saldo_por_cobrar,
         COUNT(*) FILTER (WHERE GREATEST(0, total - paid - credited) > 0.01)::int AS facturas_con_saldo
       FROM inv`,
      [req.user.companyId]
    );
    res.status(200).json({ success: true, data: r.rows[0] });
  })
);

/**
 * GET /api/v1/invoices/:id/summary
 * Get invoice summary (BEFORE /:id)
 */
router.get(
  '/:id/summary',
  asyncHandler(invoicesController.getSummary)
);

/**
 * GET /api/v1/invoices/:id/balance
 * Saldo agregado de una factura: pagos + NC + saldo remanente
 */
router.get(
  '/:id/balance',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.companyId) throw new ValidationError('Company ID is required');
    const data = await getInvoiceBalance(req.user.companyId, req.params.id);
    res.status(200).json({ success: true, data });
  })
);

/**
 * PUT /api/v1/invoices/:id/status
 * Change invoice status (BEFORE /:id)
 */
router.put(
  '/:id/status',
  asyncHandler(invoicesController.changeStatus)
);

/**
 * GET /api/v1/invoices/:id
 * Get invoice with details
 */
router.get(
  '/:id',
  asyncHandler(invoicesController.getInvoice)
);

/**
 * PUT /api/v1/invoices/:id
 * Update invoice (only DRAFT)
 */
router.put(
  '/:id',
  asyncHandler(invoicesController.updateInvoice)
);

/**
 * DELETE /api/v1/invoices/:id
 * Delete invoice (soft delete, only DRAFT)
 */
router.delete(
  '/:id',
  asyncHandler(invoicesController.deleteInvoice)
);

export default router;
