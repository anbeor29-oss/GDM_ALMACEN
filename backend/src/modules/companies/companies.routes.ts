/**
 * Companies Routes
 */

import { Router } from 'express';
import * as companiesController from './companies.controller';
import { authenticateToken, authorize } from '../../middleware/authentication';
import { asyncHandler } from '../../middleware/errorHandler';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * POST /api/v1/companies
 * Create company (admin only)
 */
router.post(
  '/',
  authorize('ADMIN'),
  asyncHandler(companiesController.createCompany)
);

/**
 * GET /api/v1/companies
 * List companies (admin only)
 */
router.get(
  '/',
  authorize('ADMIN'),
  asyncHandler(companiesController.listCompanies)
);

/**
 * GET /api/v1/companies/:id
 * Get company by ID
 */
router.get(
  '/:id',
  asyncHandler(companiesController.getCompany)
);

/**
 * PUT /api/v1/companies/:id
 * Update company
 */
router.put(
  '/:id',
  asyncHandler(companiesController.updateCompany)
);

/**
 * DELETE /api/v1/companies/:id
 * Delete company (admin only)
 */
router.delete(
  '/:id',
  authorize('ADMIN'),
  asyncHandler(companiesController.deleteCompany)
);

export default router;
