/**
 * CFDI Controller
 * HTTP handlers for CFDI generation and management
 */

import { Request, Response } from 'express';
import * as cfdiService from './cfdi.service';
import * as pdfService from './pdf.service';
import { query } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

/**
 * POST /api/v1/cfdi/:invoiceId/generate
 * Generate CFDI XML for invoice
 */
export async function generateCFDI(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { invoiceId } = req.params;

  const xml = await cfdiService.generateCFDIXML({
    companyId: req.user.companyId,
    invoiceId,
  });

  // Validate XML structure
  const validation = cfdiService.validateCFDIXML(xml);
  if (!validation.valid) {
    throw new ValidationError(`Invalid CFDI XML: ${validation.errors.join(', ')}`);
  }

  // Mark as generated
  await cfdiService.markCFDIGenerated(req.user.companyId, invoiceId);

  res.status(200).json({
    success: true,
    message: 'CFDI XML generated successfully',
    data: {
      invoiceId,
      cfdiUUID: await cfdiService.getCFDIUUID(req.user.companyId, invoiceId),
      validationStatus: 'PENDING_STAMP',
      xmlLength: xml.length,
    },
  });
}

/**
 * GET /api/v1/cfdi/:invoiceId/xml
 * Get CFDI XML content
 */
export async function getCFDIXML(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { invoiceId } = req.params;

  // Si la factura todavía no tiene xml_content (DRAFT sin timbrar) intentamos
  // generarlo al vuelo para que el botón XML siempre entregue algo descargable.
  let xml: string;
  try {
    xml = await cfdiService.getCFDIXMLContent(req.user.companyId, invoiceId);
  } catch (e) {
    xml = await cfdiService.generateCFDIXML({
      companyId: req.user.companyId,
      invoiceId,
    });
  }

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceId}.xml"`);
  res.send(xml);
}

/**
 * GET /api/v1/cfdi/:invoiceId/uuid
 * Get CFDI UUID
 */
export async function getCFDIUUID(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { invoiceId } = req.params;

  const uuid = await cfdiService.getCFDIUUID(req.user.companyId, invoiceId);

  res.status(200).json({
    success: true,
    data: {
      invoiceId,
      cfdiUUID: uuid,
    },
  });
}

/**
 * POST /api/v1/cfdi/:invoiceId/pdf
 * Generate PDF invoice
 */
export async function generatePDF(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { invoiceId } = req.params;

  const pdfBuffer = await pdfService.generateInvoicePDF({
    companyId: req.user.companyId,
    invoiceId,
  });

  // Return as PDF file
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceId}.pdf"`);
  res.setHeader('Content-Length', pdfBuffer.length);
  res.send(pdfBuffer);
}

/**
 * GET /api/v1/cfdi/:invoiceId/pdf/preview
 * Get PDF as inline (preview in browser)
 */
export async function previewPDF(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { invoiceId } = req.params;

  const pdfBuffer = await pdfService.generateInvoicePDF({
    companyId: req.user.companyId,
    invoiceId,
  });

  // Return as PDF inline
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="invoice-${invoiceId}.pdf"`);
  res.setHeader('Content-Length', pdfBuffer.length);
  res.send(pdfBuffer);
}

/**
 * POST /api/v1/cfdi/:invoiceId/validate
 * Validate CFDI XML structure
 */
export async function validateCFDI(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { invoiceId } = req.params;

  const xml = await cfdiService.getCFDIXMLContent(req.user.companyId, invoiceId);
  const validation = cfdiService.validateCFDIXML(xml);

  res.status(200).json({
    success: validation.valid,
    data: {
      invoiceId,
      valid: validation.valid,
      errors: validation.errors,
    },
  });
}

/**
 * GET /api/v1/cfdi/:invoiceId/status
 * Get CFDI generation status
 */
export async function getCFDIStatus(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { invoiceId } = req.params;

  // Get invoice details
  const result = await query(
    `SELECT xml_content, cfdi_uuid, is_stamped, status
     FROM invoices WHERE id = $1 AND company_id = $2`,
    [invoiceId, req.user.companyId]
  );

  if (result.rows.length === 0) {
    throw new Error('Invoice not found');
  }

  const invoice = result.rows[0];

  res.status(200).json({
    success: true,
    data: {
      invoiceId,
      status: invoice.status,
      cfdiGenerated: !!invoice.xml_content,
      cfdiUUID: invoice.cfdi_uuid,
      isStamped: invoice.is_stamped,
      canStamp: !!invoice.xml_content && !invoice.is_stamped,
    },
  });
}

export default {
  generateCFDI,
  getCFDIXML,
  getCFDIUUID,
  generatePDF,
  previewPDF,
  validateCFDI,
  getCFDIStatus,
};
