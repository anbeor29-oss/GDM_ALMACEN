/**
 * Customers Controller
 * HTTP request handlers for customers
 */

import { Request, Response } from 'express';
import * as customersService from './customers.service';
import { ValidationError, ForbiddenError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

/**
 * POST /api/v1/customers
 * Create customer
 */
export async function createCustomer(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const {
    rfc,
    businessName,
    fiscalRegime,
    defaultCfdiUse,
    postalCode,
    state,
    municipality,
    city,
    neighborhood,
    street,
    extNumber,
    address,
    email,
    phone,
    contactPerson,
    creditLimit,
    creditDays,
  } = req.body;

  // Validate required fields
  if (!rfc || !businessName) {
    throw new ValidationError('RFC and business name are required');
  }

  // Create customer
  const customer = await customersService.createCustomer(req.user.companyId, {
    rfc,
    businessName,
    fiscalRegime,
    defaultCfdiUse,
    postalCode,
    state,
    municipality,
    city,
    neighborhood,
    street,
    extNumber,
    address,
    email,
    phone,
    contactPerson,
    creditLimit,
    creditDays,
  });

  res.status(201).json({
    success: true,
    message: 'Customer created successfully',
    data: customer,
  });
}

/**
 * GET /api/v1/customers/:id
 * Get customer by ID
 */
export async function getCustomer(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { id } = req.params;

  const customer = await customersService.getCustomerById(req.user.companyId, id);

  res.status(200).json({
    success: true,
    data: customer,
  });
}

/**
 * GET /api/v1/customers
 * List customers with filters
 */
export async function listCustomers(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const search = req.query.search as string | undefined;
  const sortBy = (req.query.sortBy as string) || 'created_at';
  const sortOrder = (req.query.sortOrder as 'ASC' | 'DESC') || 'DESC';

  if (page < 1 || limit < 1) {
    throw new ValidationError('Page and limit must be positive numbers');
  }

  const offset = (page - 1) * limit;

  const { customers, total } = await customersService.listCustomers(req.user.companyId, {
    search,
    limit,
    offset,
    sortBy: sortBy as any,
    sortOrder,
  });

  res.status(200).json({
    success: true,
    data: {
      customers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    },
  });
}

/**
 * PUT /api/v1/customers/:id
 * Update customer
 */
export async function updateCustomer(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { id } = req.params;

  // Mapeo camelCase → snake_case (la columna en BD es snake_case)
  const b = req.body || {};
  const updateData: any = {};
  const map: Record<string, string> = {
    rfc: 'rfc',
    businessName: 'business_name',
    fiscalRegime: 'fiscal_regime',
    defaultCfdiUse: 'default_cfdi_use',
    postalCode: 'postal_code',
    state: 'state',
    municipality: 'municipality',
    city: 'city',
    neighborhood: 'neighborhood',
    street: 'street',
    extNumber: 'ext_number',
    address: 'address',
    email: 'email',
    phone: 'phone',
    contactPerson: 'contact_person',
    creditLimit: 'credit_limit',
    creditDays: 'credit_days',
    isActive: 'is_active',
  };
  for (const [cam, sn] of Object.entries(map)) {
    if (b[cam] !== undefined) updateData[sn] = b[cam];
    if (b[sn] !== undefined) updateData[sn] = b[sn];  // si ya viene en snake_case
  }

  const customer = await customersService.updateCustomer(req.user.companyId, id, updateData);

  res.status(200).json({
    success: true,
    message: 'Customer updated successfully',
    data: customer,
  });
}

/**
 * DELETE /api/v1/customers/:id
 * Delete customer (soft delete)
 */
export async function deleteCustomer(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { id } = req.params;

  await customersService.deleteCustomer(req.user.companyId, id);

  res.status(200).json({
    success: true,
    message: 'Customer deleted successfully',
  });
}

/**
 * GET /api/v1/customers/:id/balance
 * Get customer balance and statistics
 */
export async function getCustomerBalance(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { id } = req.params;

  const result = await customersService.getCustomerStats(req.user.companyId, id);

  res.status(200).json({
    success: true,
    data: result,
  });
}

/**
 * GET /api/v1/customers/:id/invoices
 * Get customer's pending invoices
 */
export async function getCustomerInvoices(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { id } = req.params;

  // Verify customer exists in user's company
  await customersService.getCustomerById(req.user.companyId, id);

  const result = await customersService.getCustomerPendingInvoices(id, 50);

  res.status(200).json({
    success: true,
    data: result.rows,
  });
}

export default {
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
  deleteCustomer,
  getCustomerBalance,
  getCustomerInvoices,
};
