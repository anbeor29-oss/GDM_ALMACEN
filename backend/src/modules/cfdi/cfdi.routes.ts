/**
 * CFDI Routes
 */

import { Router } from 'express';
import * as cfdiController from './cfdi.controller';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler } from '../../middleware/errorHandler';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// SPECIFIC ROUTES FIRST
/**
 * GET /api/v1/cfdi/:invoiceId/status
 * Get CFDI generation status (SPECIFIC)
 */
router.get(
  '/:invoiceId/status',
  asyncHandler(cfdiController.getCFDIStatus)
);

/**
 * GET /api/v1/cfdi/:invoiceId/uuid
 * Get CFDI UUID (SPECIFIC)
 */
router.get(
  '/:invoiceId/uuid',
  asyncHandler(cfdiController.getCFDIUUID)
);

/**
 * GET /api/v1/cfdi/:invoiceId/pdf/preview
 * Get PDF preview (inline) - BEFORE other pdf routes
 */
router.get(
  '/:invoiceId/pdf/preview',
  asyncHandler(cfdiController.previewPDF)
);

/**
 * GET /api/v1/cfdi/:invoiceId/xml
 * Get CFDI XML content (SPECIFIC)
 */
router.get(
  '/:invoiceId/xml',
  asyncHandler(cfdiController.getCFDIXML)
);

/**
 * POST /api/v1/cfdi/:invoiceId/generate
 * Generate CFDI XML for invoice (SPECIFIC)
 */
router.post(
  '/:invoiceId/generate',
  asyncHandler(cfdiController.generateCFDI)
);

/**
 * POST /api/v1/cfdi/:invoiceId/pdf
 * Generate PDF invoice (SPECIFIC)
 */
router.post(
  '/:invoiceId/pdf',
  asyncHandler(cfdiController.generatePDF)
);

/**
 * POST /api/v1/cfdi/:invoiceId/validate
 * Validate CFDI XML structure (SPECIFIC)
 */
router.post(
  '/:invoiceId/validate',
  asyncHandler(cfdiController.validateCFDI)
);

/**
 * GET /api/v1/cfdi/:invoiceId/pdf
 * Get PDF invoice (download) - GENERIC LAST
 */
router.get(
  '/:invoiceId/pdf',
  asyncHandler(cfdiController.generatePDF)
);

export default router;
