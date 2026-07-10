/**
 * Reports Routes
 */

import { Router } from 'express';
import * as reportsController from './reports.controller';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler } from '../../middleware/errorHandler';

const router = Router();

router.use(authenticateToken);

router.get('/collections', asyncHandler(reportsController.getCollections));
router.get('/sales', asyncHandler(reportsController.getSales));
router.get('/tax', asyncHandler(reportsController.getTax));
router.get('/status', asyncHandler(reportsController.getStatus));
router.get('/dashboard', asyncHandler(reportsController.getDashboard));
router.get('/receivables', asyncHandler(reportsController.getReceivables));
router.get('/receivables/pdf', asyncHandler(reportsController.getReceivablesPDF));

export default router;
