/**
 * Customers Routes
 */

import { Router, Request, Response } from 'express';
import * as customersController from './customers.controller';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import { query } from '../../config/database';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * POST /api/v1/customers
 * Create customer
 */
router.post(
  '/',
  asyncHandler(customersController.createCustomer)
);

/**
 * GET /api/v1/customers
 * List customers with filters
 */
router.get(
  '/',
  asyncHandler(customersController.listCustomers)
);

/**
 * GET /api/v1/customers/:id
 * Get customer by ID
 */
router.get(
  '/:id',
  asyncHandler(customersController.getCustomer)
);

/**
 * GET /api/v1/customers/:id/balance
 * Get customer balance and statistics
 */
router.get(
  '/:id/balance',
  asyncHandler(customersController.getCustomerBalance)
);

/**
 * GET /api/v1/customers/:id/invoices
 * Get customer's pending invoices
 */
router.get(
  '/:id/invoices',
  asyncHandler(customersController.getCustomerInvoices)
);

/**
 * GET /api/v1/customers/:id/products
 * Productos que este cliente nos compra (memoria desde CFDIs).
 */
router.get(
  '/:id/products',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.companyId) throw new ValidationError('Company ID is required');
    const { id } = req.params;
    const r = await query(
      `SELECT cp.product_id, p.sku, p.name, p.clave_sat, p.unit_code, p.unit_name,
              cp.first_purchase_date, cp.last_purchase_date,
              cp.times_purchased, cp.total_quantity, cp.total_amount,
              cp.last_unit_price, cp.last_invoice_folio
         FROM customer_products cp
         JOIN products p ON p.id = cp.product_id
        WHERE cp.company_id = $1 AND cp.customer_id = $2
        ORDER BY cp.last_purchase_date DESC NULLS LAST`,
      [req.user.companyId, id]
    );
    res.status(200).json({
      success: true,
      data: { count: r.rows.length, products: r.rows },
    });
  })
);

/**
 * PUT /api/v1/customers/:id
 * Update customer
 */
router.put(
  '/:id',
  asyncHandler(customersController.updateCustomer)
);

/**
 * DELETE /api/v1/customers/:id
 * Delete customer (soft delete)
 */
router.delete(
  '/:id',
  asyncHandler(customersController.deleteCustomer)
);

export default router;
