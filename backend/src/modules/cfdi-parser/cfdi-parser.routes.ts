/**
 * CFDI Parser Routes
 */

import { Router } from 'express';
import * as cfdiParserController from './cfdi-parser.controller';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler } from '../../middleware/errorHandler';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * POST /api/v1/cfdi-parser/parse
 * Parse CFDI XML without importing
 */
router.post(
  '/parse',
  asyncHandler(cfdiParserController.parseCFDI)
);

/**
 * POST /api/v1/cfdi-parser/validate
 * Validate CFDI XML
 */
router.post(
  '/validate',
  asyncHandler(cfdiParserController.validateCFDI)
);

/**
 * POST /api/v1/cfdi-parser/import
 * Import CFDI XML as invoice
 */
router.post(
  '/import',
  asyncHandler(cfdiParserController.importCFDI)
);

/**
 * GET /api/v1/cfdi-parser/imports
 * Get import history
 */
router.get(
  '/imports',
  asyncHandler(cfdiParserController.getImportHistory)
);

/**
 * POST /api/v1/cfdi-parser/validate-batch
 * Validate multiple CFDIs
 */
router.post(
  '/validate-batch',
  asyncHandler(cfdiParserController.validateBatch)
);

/**
 * POST /api/v1/cfdi-parser/import-batch
 * Import multiple CFDIs
 */
router.post(
  '/import-batch',
  asyncHandler(cfdiParserController.importBatch)
);

export default router;
