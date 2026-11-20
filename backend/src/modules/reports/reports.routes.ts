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
router.get('/sales-detail', asyncHandler(reportsController.getSalesDetail));
router.get('/sales-summary', asyncHandler(reportsController.getSalesSummary));
router.get('/sales-summary/pdf', asyncHandler(reportsController.getSalesSummaryPDF));
router.get('/unpaid', asyncHandler(reportsController.getUnpaid));
router.get('/unpaid/pdf', asyncHandler(reportsController.getUnpaidPDF));
router.get('/tax', asyncHandler(reportsController.getTax));
router.get('/status', asyncHandler(reportsController.getStatus));
router.get('/dashboard', asyncHandler(reportsController.getDashboard));
router.get('/receivables', asyncHandler(reportsController.getReceivables));
router.get('/receivables/pdf', asyncHandler(reportsController.getReceivablesPDF));
router.get('/invoices-history', asyncHandler(reportsController.getInvoicesHistory));
router.get('/invoices-history.xlsx', asyncHandler(reportsController.getInvoicesHistoryExcel));

export default router;
