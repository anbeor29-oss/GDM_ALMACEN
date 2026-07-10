/**
 * Invoices Controller
 * HTTP request handlers for invoices with automatic calculations
 */

import { Request, Response } from 'express';
import * as invoicesService from './invoices.service';
import * as customersService from '../customers/customers.service';
import { ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

/**
 * POST /api/v1/invoices
 * Create invoice with automatic calculations
 */
export async function createInvoice(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const {
    customerId,
    cfdiType,
    paymentForm,
    paymentMethod,
    cfdiUse,
    items,
    currency,
    exchangeRate,
    discount,
    paymentTerms,
    notes,
  } = req.body;

  // Validate required fields
  if (!customerId || !cfdiType || !paymentForm || !paymentMethod || !cfdiUse || !items?.length) {
    throw new ValidationError(
      'customerId, cfdiType, paymentForm, paymentMethod, cfdiUse, and items are required'
    );
  }

  if (!['I', 'E', 'T'].includes(cfdiType)) {
    throw new ValidationError('cfdiType must be I (Ingreso), E (Egreso), or T (Traslado)');
  }

  // Create invoice
  const invoice = await invoicesService.createInvoice(req.user.companyId, {
    customerId,
    cfdiType,
    paymentForm,
    paymentMethod,
    cfdiUse,
    items,
    currency,
    exchangeRate,
    discount,
    paymentTerms,
    notes,
  });

  res.status(201).json({
    success: true,
    message: 'Invoice created successfully with automatic calculations',
    data: invoice,
  });
}

/**
 * GET /api/v1/invoices/:id
 * Get invoice with details
 */
export async function getInvoice(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { id } = req.params;
  const invoice = await invoicesService.getInvoiceById(req.user.companyId, id);

  res.status(200).json({
    success: true,
    data: invoice,
  });
}

/**
 * GET /api/v1/invoices
 * List invoices with filters
 */
export async function listInvoices(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const customerId = req.query.customerId as string | undefined;
  const status = req.query.status as string | undefined;
  const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined;
  const dateTo = req.query.dateTo ? new Date(req.query.dateTo as string) : undefined;

  if (page < 1 || limit < 1) {
    throw new ValidationError('Page and limit must be positive numbers');
  }

  const offset = (page - 1) * limit;

  const { invoices, total } = await invoicesService.listInvoices(req.user.companyId, {
    customerId,
    status,
    dateFrom,
    dateTo,
    limit,
    offset,
  });

  res.status(200).json({
    success: true,
    data: {
      invoices,
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
 * PUT /api/v1/invoices/:id
 * Update invoice (only DRAFT)
 */
export async function updateInvoice(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { id } = req.params;
  const invoice = await invoicesService.updateInvoice(req.user.companyId, id, req.body);

  res.status(200).json({
    success: true,
    message: 'Invoice updated successfully',
    data: invoice,
  });
}

/**
 * DELETE /api/v1/invoices/:id
 * Delete invoice (soft delete, only DRAFT)
 */
export async function deleteInvoice(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { id } = req.params;

  await invoicesService.deleteInvoice(req.user.companyId, id);

  res.status(200).json({
    success: true,
    message: 'Invoice deleted successfully',
  });
}

/**
 * PUT /api/v1/invoices/:id/status
 * Change invoice status
 */
export async function changeStatus(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    throw new ValidationError('Status is required');
  }

  const invoice = await invoicesService.changeInvoiceStatus(req.user.companyId, id, status);

  res.status(200).json({
    success: true,
    message: `Invoice status changed to ${status}`,
    data: invoice,
  });
}

/**
 * GET /api/v1/invoices/:id/summary
 * Get invoice summary
 */
export async function getSummary(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { id } = req.params;
  const summary = await invoicesService.getInvoiceSummary(req.user.companyId, id);

  res.status(200).json({
    success: true,
    data: summary,
  });
}

/**
 * GET /api/v1/invoices/customer/:customerId/invoices
 * Get customer invoices
 */
export async function getCustomerInvoices(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { customerId } = req.params;

  // Validate customer belongs to company
  await customersService.getCustomerById(req.user.companyId, customerId);

  const invoices = await invoicesService.getCustomerInvoices(customerId);

  res.status(200).json({
    success: true,
    data: invoices,
  });
}

export default {
  createInvoice,
  getInvoice,
  listInvoices,
  updateInvoice,
  deleteInvoice,
  changeStatus,
  getSummary,
  getCustomerInvoices,
};
