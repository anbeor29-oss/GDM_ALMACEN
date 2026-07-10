/**
 * SAT Validator Routes
 */

import { Router } from 'express';
import * as satValidatorController from './sat-validator.controller';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler } from '../../middleware/errorHandler';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * POST /api/v1/sat-validator/validate/:invoiceId
 * Validate invoice against SAT
 */
router.post(
  '/validate/:invoiceId',
  asyncHandler(satValidatorController.validateInvoice)
);

/**
 * GET /api/v1/sat-validator/status/:invoiceId
 * Get validation status (BEFORE other :invoiceId routes)
 */
router.get(
  '/status/:invoiceId',
  asyncHandler(satValidatorController.getValidationStatus)
);

/**
 * GET /api/v1/sat-validator/stamp-status/:uuid
 * Get stamp status
 */
router.get(
  '/stamp-status/:uuid',
  asyncHandler(satValidatorController.getStampStatus)
);

/**
 * POST /api/v1/sat-validator/download/:invoiceId
 * Download timbred XML
 */
router.post(
  '/download/:invoiceId',
  asyncHandler(satValidatorController.downloadTimbredXML)
);

/**
 * POST /api/v1/sat-validator/check-cancellation/:invoiceId
 * Check cancellation status
 */
router.post(
  '/check-cancellation/:invoiceId',
  asyncHandler(satValidatorController.checkCancellation)
);

/**
 * POST /api/v1/sat-validator/validate-batch
 * Validate multiple invoices
 */
router.post(
  '/validate-batch',
  asyncHandler(satValidatorController.validateBatch)
);

/**
 * GET /api/v1/sat-validator/stats
 * Get validation statistics
 */
router.get(
  '/stats',
  asyncHandler(satValidatorController.getStats)
);

export default router;
