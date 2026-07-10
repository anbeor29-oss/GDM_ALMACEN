/**
 * SAT Validator Controller
 * HTTP handlers for SAT validation
 */

import { Request, Response } from 'express';
import * as satValidatorService from './sat-validator.service';
import * as invoicesService from '../invoices/invoices.service';
import { ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

// Initialize SAT Validator client (production mode = false for demo)
const satClient = new satValidatorService.SATValidatorClient(false);

/**
 * POST /api/v1/sat-validator/validate/:invoiceId
 * Validate invoice against SAT
 */
export async function validateInvoice(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { invoiceId } = req.params;

  // Get invoice
  const invoice = await invoicesService.getInvoiceById(req.user.companyId, invoiceId);

  if (!invoice.cfdi_uuid) {
    throw new ValidationError('Invoice does not have a CFDI UUID. Generate CFDI first.');
  }

  // Extract required data
  // In real scenario, we'd parse the XML to get RFC emisor
  // For now, we use placeholder values
  const rfcEmisor = 'ABC010101ABC'; // Should come from XML
  const rfcReceptor = 'XYZ020202XYZ'; // Should come from XML
  const total = invoice.total.toString();
  const uuid = invoice.cfdi_uuid;

  // Validate against SAT
  const validationResult = await satClient.validateComprobante(
    rfcEmisor,
    rfcReceptor,
    total,
    uuid
  );

  // Save validation result
  await satValidatorService.saveValidation(req.user.companyId, invoiceId, validationResult);

  res.status(200).json({
    success: validationResult.valid,
    message: validationResult.valid ? 'Invoice is valid in SAT' : 'Invoice validation failed',
    data: validationResult,
  });
}

/**
 * GET /api/v1/sat-validator/status/:invoiceId
 * Get validation status
 */
export async function getValidationStatus(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { invoiceId } = req.params;

  // Get last validation
  const validation = await satValidatorService.getLastValidation(invoiceId);

  res.status(200).json({
    success: true,
    data: validation,
  });
}

/**
 * POST /api/v1/sat-validator/stamp-status/:uuid
 * Get stamp status from SAT
 */
export async function getStampStatus(req: Request, res: Response) {
  const { uuid } = req.params;

  const stampStatus = await satClient.getStampStatus(uuid);

  res.status(200).json({
    success: true,
    data: stampStatus,
  });
}

/**
 * POST /api/v1/sat-validator/download/:invoiceId
 * Download timbred XML
 */
export async function downloadTimbredXML(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { invoiceId } = req.params;

  // Get invoice
  const invoice = await invoicesService.getInvoiceById(req.user.companyId, invoiceId);

  if (!invoice.cfdi_uuid) {
    throw new ValidationError('Invoice does not have CFDI UUID');
  }

  // Download from SAT
  const xmlContent = await satClient.downloadTimbredXML(invoice.cfdi_uuid);

  // Return as XML file
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceId}-timbred.xml"`);
  res.send(xmlContent);
}

/**
 * POST /api/v1/sat-validator/check-cancellation/:invoiceId
 * Check if invoice is cancelled
 */
export async function checkCancellation(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { invoiceId } = req.params;

  // Get invoice
  const invoice = await invoicesService.getInvoiceById(req.user.companyId, invoiceId);

  // Extract RFC emisor from XML
  const rfcEmisor = 'ABC010101ABC'; // Should parse from XML

  // Check cancellation status
  const isCancelled = await satClient.checkCancellation(rfcEmisor, invoice.cfdi_uuid || '');

  res.status(200).json({
    success: true,
    data: {
      invoiceId,
      uuid: invoice.cfdi_uuid,
      is_cancelled: isCancelled,
    },
  });
}

/**
 * POST /api/v1/sat-validator/validate-batch
 * Validate multiple invoices
 */
export async function validateBatch(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { invoiceIds } = req.body;

  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    throw new ValidationError('invoiceIds must be a non-empty array');
  }

  if (invoiceIds.length > 100) {
    throw new ValidationError('Maximum 100 invoices per batch');
  }

  const comprobantes = [];

  // Fetch all invoices and prepare for validation
  for (const invoiceId of invoiceIds) {
    try {
      const invoice = await invoicesService.getInvoiceById(req.user.companyId, invoiceId);

      if (!invoice.cfdi_uuid) {
        logger.warn(`Invoice ${invoiceId} has no CFDI UUID, skipping`);
        continue;
      }

      comprobantes.push({
        rfc_emisor: 'ABC010101ABC', // Parse from XML
        rfc_receptor: 'XYZ020202XYZ', // Parse from XML
        total: invoice.total.toString(),
        uuid: invoice.cfdi_uuid,
      });
    } catch (error) {
      logger.error(`Could not load invoice ${invoiceId}`, { error });
    }
  }

  // Validate batch
  const validationResults = await satValidatorService.validateBatch(satClient, comprobantes);

  // Save all validations
  for (let idx = 0; idx < invoiceIds.length; idx++) {
    if (validationResults[idx]) {
      await satValidatorService.saveValidation(
        req.user.companyId,
        invoiceIds[idx],
        validationResults[idx]
      );
    }
  }

  const validCount = validationResults.filter((v) => v.valid).length;

  res.status(200).json({
    success: validCount === validationResults.length,
    message: `Validated ${validCount}/${validationResults.length} invoices`,
    data: {
      total: validationResults.length,
      valid: validCount,
      invalid: validationResults.length - validCount,
      results: validationResults,
    },
  });
}

/**
 * GET /api/v1/sat-validator/stats
 * Get validation statistics
 */
export async function getStats(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const stats = await satValidatorService.getValidationStats(req.user.companyId);

  res.status(200).json({
    success: true,
    data: stats,
  });
}

export default {
  validateInvoice,
  getValidationStatus,
  getStampStatus,
  downloadTimbredXML,
  checkCancellation,
  validateBatch,
  getStats,
};
