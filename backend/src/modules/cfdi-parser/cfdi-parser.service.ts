/**
 * CFDI Parser Service
 * Parses, validates, and imports CFDI XMLs
 */

import * as xml2js from 'xml2js';
import * as crypto from 'crypto';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import * as xmlStructure from './validators/xml-structure';
import * as satCompliance from './validators/sat-compliance';
import * as businessLogic from './validators/business-logic';
import * as invoicesService from '../invoices/invoices.service';
import * as customersService from '../customers/customers.service';

interface ParsedCFDI {
  version: string;
  emisor: {
    rfc: string;
    nombre: string;
    regimen_fiscal?: string;
  };
  receptor: {
    rfc: string;
    nombre?: string;
    uso_cfdi?: string;
  };
  conceptos: Array<{
    clave_sat: string;
    cantidad: number;
    clave_unidad: string;
    descripcion: string;
    valor_unitario: number;
    importe: number;
    impuesto?: number;
  }>;
  totales: {
    subtotal: number;
    impuesto_trasladado: number;
    total: number;
  };
  fecha_emision: string;
  folio?: string;
  serie?: string;
  forma_pago?: string;
  metodo_pago?: string;
}

interface ValidationSummary {
  structure: { valid: boolean; errors: string[]; warnings: string[] };
  sat: { valid: boolean; errors: string[]; warnings: string[] };
  business: { valid: boolean; errors: string[]; warnings: string[] };
  overall: boolean;
}

/**
 * Parse CFDI XML string to object
 */
export async function parseCFDIXML(xmlContent: string): Promise<ParsedCFDI> {
  try {
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlContent);

    if (!result.Comprobante) {
      throw new Error('Invalid CFDI structure - missing Comprobante root element');
    }

    const comprobante = result['cfdi:Comprobante'] || result.Comprobante;
    const emisor = comprobante['cfdi:Emisor']?.[0] || comprobante.Emisor?.[0] || {};
    const receptor = comprobante['cfdi:Receptor']?.[0] || comprobante.Receptor?.[0] || {};
    const conceptos = comprobante['cfdi:Conceptos']?.[0]?.['cfdi:Concepto'] || [];
    const impuestos = comprobante['cfdi:Impuestos']?.[0] || {};

    // Map to our format
    const parsedData: ParsedCFDI = {
      version: comprobante.$.Version || '4.0',
      emisor: {
        rfc: emisor.$.Rfc || '',
        nombre: emisor.$.Nombre || '',
        regimen_fiscal: emisor.$.RegimenFiscal,
      },
      receptor: {
        rfc: receptor.$.Rfc || '',
        nombre: receptor.$.Nombre || '',
        uso_cfdi: receptor.$.UsoCFDI,
      },
      conceptos: Array.isArray(conceptos)
        ? conceptos.map((concepto: any) => ({
            clave_sat: concepto.$.Clave || concepto.$.Clave,
            cantidad: parseFloat(concepto.$.Cantidad),
            clave_unidad: concepto.$.ClaveUnidad,
            descripcion: concepto.$.Descripcion,
            valor_unitario: parseFloat(concepto.$.ValorUnitario),
            importe: parseFloat(concepto.$.Importe),
          }))
        : [],
      totales: {
        subtotal: parseFloat(comprobante.$.SubTotal || '0'),
        impuesto_trasladado: parseFloat(impuestos.$.TotalImpuestosTrasladados || '0'),
        total: parseFloat(comprobante.$.Total || '0'),
      },
      fecha_emision: comprobante.$.Fecha || new Date().toISOString(),
      folio: comprobante.$.Folio,
      serie: comprobante.$.Serie,
      forma_pago: comprobante.$.FormaPago,
      metodo_pago: comprobante.$.MetodoPago,
    };

    return parsedData;
  } catch (error) {
    throw new ValidationError(
      `Failed to parse CFDI XML: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Validate CFDI XML (structure + SAT + business)
 */
export async function validateCFDI(
  companyId: string,
  xmlContent: string
): Promise<ValidationSummary> {
  // 1. Validate structure
  const structureValidation = xmlStructure.validateCFDIXMLComplete(xmlContent);

  // 2. Parse XML
  let parsedData: ParsedCFDI | null = null;
  try {
    parsedData = await parseCFDIXML(xmlContent);
  } catch (error) {
    return {
      structure: structureValidation,
      sat: { valid: false, errors: ['XML parse error'], warnings: [] },
      business: { valid: false, errors: ['Could not parse XML'], warnings: [] },
      overall: false,
    };
  }

  // 3. Validate SAT compliance
  const satValidation = await satCompliance.validateSATCompliance(parsedData);

  // 4. Validate business logic
  const businessValidation = await businessLogic.validateBusinessLogic(companyId, parsedData);

  const overall =
    structureValidation.valid && satValidation.valid && businessValidation.valid;

  return {
    structure: structureValidation,
    sat: satValidation,
    business: businessValidation,
    overall,
  };
}

/**
 * Import CFDI XML as invoice
 */
export async function importCFDIAsInvoice(
  companyId: string,
  xmlContent: string
): Promise<any> {
  // 1. Validate
  const validation = await validateCFDI(companyId, xmlContent);

  if (!validation.overall) {
    throw new ValidationError(
      `Cannot import invalid CFDI: ${validation.structure.errors
        .concat(validation.sat.errors)
        .concat(validation.business.errors)
        .join('; ')}`
    );
  }

  // 2. Parse
  const parsedData = await parseCFDIXML(xmlContent);

  // 3. Get customer
  const customer = await customersService.getCustomerByRFC(companyId, parsedData.receptor.rfc);

  // 4. Create invoice in transaction
  return transaction(async (client) => {
    const invoiceResult = await transactionQuery(
      client,
      `INSERT INTO invoices
       (company_id, customer_id, folio, serie, cfdi_type, date_issued,
        subtotal, tax_transferred, total, payment_form, payment_method,
        cfdi_use, status, is_active, is_stamped, xml_content, cfdi_uuid, notes)
       VALUES ($1, $2, $3, $4, 'I', $5,
               $6, $7, $8, $9, $10,
               $11, 'RECEIVED', true, true, $12, $13, 'Imported from external XML')
       RETURNING *`,
      [
        companyId,
        customer.id,
        parsedData.folio,
        parsedData.serie,
        parsedData.fecha_emision,
        parsedData.totales.subtotal,
        parsedData.totales.impuesto_trasladado,
        parsedData.totales.total,
        parsedData.forma_pago || '01',
        parsedData.metodo_pago || 'PUE',
        parsedData.receptor.uso_cfdi || 'G01',
        xmlContent,
        parsedData.folio || '', // Use folio as UUID placeholder
      ]
    );

    if (invoiceResult.rows.length === 0) {
      throw new Error('Failed to create invoice');
    }

    const invoice = invoiceResult.rows[0];

    // Insert line items
    for (let idx = 0; idx < parsedData.conceptos.length; idx++) {
      const concepto = parsedData.conceptos[idx];

      await transactionQuery(
        client,
        `INSERT INTO invoice_items
         (invoice_id, line_number, quantity, unit_price,
          subtotal, tax_amount, total, description,
          clave_sat, unit_code, tax_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          invoice.id,
          idx + 1,
          concepto.cantidad,
          concepto.valor_unitario,
          concepto.importe,
          concepto.impuesto || 0,
          concepto.importe + (concepto.impuesto || 0),
          concepto.descripcion,
          concepto.clave_sat,
          concepto.clave_unidad,
          concepto.impuesto ? (concepto.impuesto / concepto.importe).toFixed(6) : '0',
        ]
      );
    }

    // Update customer balance
    await customersService.updateCustomerBalance(customer.id);

    logger.info(`CFDI imported: ${invoice.serie}-${invoice.folio} for customer ${customer.rfc}`);

    return invoice;
  });
}

/**
 * Get import history
 */
export async function getImportHistory(companyId: string): Promise<any[]> {
  const result = await query(
    `SELECT i.id, i.folio, i.serie, i.total, i.date_issued, i.status,
            c.rfc as customer_rfc, c.business_name as customer_name
     FROM invoices i
     JOIN customers c ON i.customer_id = c.id
     WHERE i.company_id = $1 AND i.status = 'RECEIVED'
     AND i.deleted_at IS NULL
     ORDER BY i.date_issued DESC`,
    [companyId]
  );

  return result.rows;
}

/**
 * Get XML hash (for duplicate detection)
 */
export function getXMLHash(xmlContent: string): string {
  return crypto.createHash('sha256').update(xmlContent).digest('hex');
}

export default {
  parseCFDIXML,
  validateCFDI,
  importCFDIAsInvoice,
  getImportHistory,
  getXMLHash,
};
