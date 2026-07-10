/**
 * Companies Controller
 * HTTP request handlers for companies
 */

import { Request, Response } from 'express';
import * as companiesService from './companies.service';
import { ValidationError, ForbiddenError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

/**
 * POST /api/v1/companies
 * Create company (admin only)
 */
export async function createCompany(req: Request, res: Response) {
  const { rfc, businessName, fiscalRegime, postalCode, state, email, phone } = req.body;

  // Validate input
  if (!rfc || !businessName || !fiscalRegime) {
    throw new ValidationError('RFC, business name, and fiscal regime are required');
  }

  // Create company
  const company = await companiesService.createCompany({
    rfc,
    businessName,
    fiscalRegime,
    postalCode,
    state,
    email,
    phone,
  });

  res.status(201).json({
    success: true,
    message: 'Company created successfully',
    data: company,
  });
}

/**
 * GET /api/v1/companies/:id
 * Get company by ID
 */
export async function getCompany(req: Request, res: Response) {
  const { id } = req.params;

  // Check authorization (user can only access their own company)
  if (req.user?.companyId !== id && req.user?.role !== 'ADMIN') {
    throw new ForbiddenError('You do not have access to this company');
  }

  const company = await companiesService.getCompanyById(id);

  res.status(200).json({
    success: true,
    data: company,
  });
}

/**
 * GET /api/v1/companies
 * List all companies (admin only)
 */
export async function listCompanies(req: Request, res: Response) {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;

  if (page < 1 || limit < 1) {
    throw new ValidationError('Page and limit must be positive numbers');
  }

  const offset = (page - 1) * limit;

  const { companies, total } = await companiesService.listCompanies(limit, offset);

  res.status(200).json({
    success: true,
    data: {
      companies,
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
 * PUT /api/v1/companies/:id
 * Update company
 */
export async function updateCompany(req: Request, res: Response) {
  const { id } = req.params;
  const updateData = req.body;

  // Check authorization
  if (req.user?.companyId !== id && req.user?.role !== 'ADMIN') {
    throw new ForbiddenError('You do not have access to this company');
  }

  const company = await companiesService.updateCompany(id, updateData);

  res.status(200).json({
    success: true,
    message: 'Company updated successfully',
    data: company,
  });
}

/**
 * DELETE /api/v1/companies/:id
 * Delete company (soft delete)
 */
export async function deleteCompany(req: Request, res: Response) {
  const { id } = req.params;

  // Check authorization (admin only)
  if (req.user?.role !== 'ADMIN') {
    throw new ForbiddenError('Only admins can delete companies');
  }

  await companiesService.deleteCompany(id);

  res.status(200).json({
    success: true,
    message: 'Company deleted successfully',
  });
}

export default {
  createCompany,
  getCompany,
  listCompanies,
  updateCompany,
  deleteCompany,
};
