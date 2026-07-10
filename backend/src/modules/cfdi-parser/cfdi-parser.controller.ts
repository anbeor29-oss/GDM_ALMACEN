/**
 * CFDI Parser Controller
 * HTTP handlers for parsing and importing CFDI XMLs
 */

import { Request, Response } from 'express';
import * as cfdiParserService from './cfdi-parser.service';
import { ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

/**
 * POST /api/v1/cfdi-parser/parse
 * Parse CFDI XML without importing
 */
export async function parseCFDI(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { xmlContent } = req.body;

  if (!xmlContent) {
    throw new ValidationError('xmlContent is required');
  }

  const parsedData = await cfdiParserService.parseCFDIXML(xmlContent);

  res.status(200).json({
    success: true,
    message: 'CFDI XML parsed successfully',
    data: parsedData,
  });
}

/**
 * POST /api/v1/cfdi-parser/validate
 * Validate CFDI XML structure and compliance
 */
export async function validateCFDI(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { xmlContent } = req.body;

  if (!xmlContent) {
    throw new ValidationError('xmlContent is required');
  }

  const validation = await cfdiParserService.validateCFDI(req.user.companyId, xmlContent);

  res.status(200).json({
    success: validation.overall,
    message: validation.overall
      ? 'CFDI XML is valid'
      : 'CFDI XML has validation errors',
    data: validation,
  });
}

/**
 * POST /api/v1/cfdi-parser/import
 * Import CFDI XML as invoice
 */
export async function importCFDI(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { xmlContent } = req.body;

  if (!xmlContent) {
    throw new ValidationError('xmlContent is required');
  }

  const invoice = await cfdiParserService.importCFDIAsInvoice(req.user.companyId, xmlContent);

  logger.info(`CFDI imported by user ${req.user.userId}`, {
    invoiceId: invoice.id,
    folio: invoice.folio,
  });

  res.status(201).json({
    success: true,
    message: 'CFDI imported successfully as invoice',
    data: {
      invoiceId: invoice.id,
      folio: `${invoice.serie}-${invoice.folio}`,
      status: invoice.status,
      total: invoice.total,
    },
  });
}

/**
 * GET /api/v1/cfdi-parser/imports
 * Get import history
 */
export async function getImportHistory(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const imports = await cfdiParserService.getImportHistory(req.user.companyId);

  res.status(200).json({
    success: true,
    data: {
      imports,
      count: imports.length,
    },
  });
}

/**
 * POST /api/v1/cfdi-parser/validate-batch
 * Validate multiple CFDI XMLs
 */
export async function validateBatch(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }
  const companyId = req.user.companyId;

  const { xmlContents } = req.body;

  if (!Array.isArray(xmlContents)) {
    throw new ValidationError('xmlContents must be an array');
  }

  if (xmlContents.length > 100) {
    throw new ValidationError('Maximum 100 files per batch');
  }

  const validations = await Promise.all(
    xmlContents.map((xml: string) => cfdiParserService.validateCFDI(companyId, xml))
  );

  const validCount = validations.filter((v) => v.overall).length;
  const invalidCount = validations.length - validCount;

  res.status(200).json({
    success: validCount === validations.length,
    message: `Validated ${validCount} valid, ${invalidCount} invalid files`,
    data: {
      total: validations.length,
      valid: validCount,
      invalid: invalidCount,
      results: validations.map((v, idx) => ({
        index: idx,
        valid: v.overall,
        errors: v.structure.errors.concat(v.sat.errors).concat(v.business.errors),
      })),
    },
  });
}

/**
 * POST /api/v1/cfdi-parser/import-batch
 * Import multiple CFDI XMLs
 */
export async function importBatch(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { xmlContents } = req.body;

  if (!Array.isArray(xmlContents)) {
    throw new ValidationError('xmlContents must be an array');
  }

  if (xmlContents.length > 50) {
    throw new ValidationError('Maximum 50 files per batch import');
  }

  const results = [];
  let successCount = 0;
  let failureCount = 0;

  for (let idx = 0; idx < xmlContents.length; idx++) {
    try {
      const invoice = await cfdiParserService.importCFDIAsInvoice(
        req.user.companyId,
        xmlContents[idx]
      );
      results.push({
        index: idx,
        success: true,
        invoiceId: invoice.id,
        folio: `${invoice.serie}-${invoice.folio}`,
      });
      successCount++;
    } catch (error) {
      results.push({
        index: idx,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      failureCount++;
    }
  }

  logger.info(`Batch import completed: ${successCount} success, ${failureCount} failures`);

  res.status(200).json({
    success: failureCount === 0,
    message: `Imported ${successCount}/${xmlContents.length} CFDIs successfully`,
    data: {
      total: xmlContents.length,
      success: successCount,
      failure: failureCount,
      results,
    },
  });
}

export default {
  parseCFDI,
  validateCFDI,
  importCFDI,
  getImportHistory,
  validateBatch,
  importBatch,
};
