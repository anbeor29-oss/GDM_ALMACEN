/**
 * Business Logic Validator
 * Validates against internal business rules and database constraints
 */

import { query } from '../../../config/database';
import * as customersService from '../../customers/customers.service';
import { ValidationResult } from './xml-structure';

/**
 * Validate customer exists in system
 */
export async function validateCustomerExists(
  companyId: string,
  customerRFC: string
): Promise<{ valid: boolean; customerId?: string; errors: string[] }> {
  const errors: string[] = [];

  try {
    const customer = await customersService.getCustomerByRFC(companyId, customerRFC);
    return {
      valid: true,
      customerId: customer.id,
      errors: [],
    };
  } catch (error) {
    errors.push(
      `Customer with RFC ${customerRFC} not found in system. Please create customer first.`
    );
    return {
      valid: false,
      errors,
    };
  }
}

/**
 * Validate customer is active
 */
export async function validateCustomerActive(
  companyId: string,
  customerId: string
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const result = await query(
    'SELECT is_active FROM customers WHERE id = $1 AND company_id = $2',
    [customerId, companyId]
  );

  if (result.rows.length === 0) {
    errors.push('Customer not found');
  } else if (!result.rows[0].is_active) {
    errors.push('Customer is inactive');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate no duplicate invoices
 */
export async function validateNoDuplicateInvoice(
  companyId: string,
  customerRFC: string,
  folio: string,
  serie: string
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if same folio+serie already exists for this company
  const result = await query(
    `SELECT id FROM invoices
     WHERE company_id = $1 AND folio = $2 AND serie = $3 AND deleted_at IS NULL`,
    [companyId, parseInt(folio), serie]
  );

  if (result.rows.length > 0) {
    errors.push(
      `Invoice with folio ${serie}-${folio} already exists. This may be a duplicate import.`
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate invoice date is valid
 */
export function validateInvoiceDate(dateString: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const date = new Date(dateString);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      errors.push(`Invalid date format: ${dateString}`);
      return { valid: false, errors, warnings };
    }

    // Check if date is not in future
    if (date > new Date()) {
      warnings.push('Invoice date is in the future');
    }

    // Check if date is not too old (more than 5 years)
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    if (date < fiveYearsAgo) {
      warnings.push('Invoice date is more than 5 years old');
    }
  } catch (error) {
    errors.push(`Date validation error: ${error instanceof Error ? error.message : 'Unknown'}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate item prices are reasonable
 */
export function validateItemPrices(items: any[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  items.forEach((item, index) => {
    const price = parseFloat(item.valor_unitario);
    const quantity = parseFloat(item.cantidad);

    // Check for zero or negative prices
    if (price < 0) {
      errors.push(`Item ${index + 1}: Negative price not allowed (${price})`);
    }

    if (price === 0) {
      warnings.push(`Item ${index + 1}: Zero price (may be promotional)`);
    }

    // Check for extremely high prices (> 1 million)
    if (price > 1000000) {
      warnings.push(
        `Item ${index + 1}: Very high price (${price}). Please verify if this is correct.`
      );
    }

    // Check for extremely high quantities
    if (quantity > 100000) {
      warnings.push(
        `Item ${index + 1}: Very high quantity (${quantity}). Please verify if this is correct.`
      );
    }

    // Check that importe = cantidad × precio
    const expectedImporte = quantity * price;
    const actualImporte = parseFloat(item.importe);
    if (Math.abs(expectedImporte - actualImporte) > 0.01) {
      warnings.push(
        `Item ${index + 1}: Importe calculation mismatch. Expected ${expectedImporte.toFixed(2)}, got ${actualImporte.toFixed(2)}`
      );
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate invoice totals
 */
export function validateInvoiceTotals(invoiceData: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const subtotal = parseFloat(invoiceData.subtotal);
  const impuesto = parseFloat(invoiceData.impuesto_trasladado || 0);
  const descuento = parseFloat(invoiceData.descuento || 0);
  const total = parseFloat(invoiceData.total);

  // Expected total = subtotal + impuesto - descuento
  const expectedTotal = subtotal + impuesto - descuento;

  if (Math.abs(expectedTotal - total) > 0.01) {
    errors.push(
      `Total calculation mismatch. Expected ${expectedTotal.toFixed(2)}, got ${total.toFixed(2)}`
    );
  }

  // Check for negative totals
  if (total < 0) {
    errors.push('Negative total not allowed');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate no missing required fields
 */
export function validateRequiredFields(invoiceData: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const requiredFields = [
    { name: 'emisor.rfc', path: ['emisor', 'rfc'] },
    { name: 'receptor.rfc', path: ['receptor', 'rfc'] },
    { name: 'subtotal', path: ['subtotal'] },
    { name: 'total', path: ['total'] },
    { name: 'conceptos', path: ['conceptos'] },
  ];

  requiredFields.forEach((field) => {
    let value = invoiceData;
    for (const key of field.path) {
      value = value?.[key];
    }

    if (value === null || value === undefined || value === '') {
      errors.push(`Missing required field: ${field.name}`);
    }
  });

  // Check that conceptos has items
  if (Array.isArray(invoiceData.conceptos) && invoiceData.conceptos.length === 0) {
    errors.push('Invoice must have at least one item (concepto)');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Comprehensive business logic validation
 */
export async function validateBusinessLogic(
  companyId: string,
  xmlData: any
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Validate required fields
    const requiredValidation = validateRequiredFields(xmlData);
    errors.push(...requiredValidation.errors);
    warnings.push(...requiredValidation.warnings);

    // Validate customer exists
    const customerValidation = await validateCustomerExists(companyId, xmlData.receptor?.rfc);
    if (!customerValidation.valid) {
      errors.push(...customerValidation.errors);
    } else {
      // Validate customer is active
      const activeValidation = await validateCustomerActive(companyId, customerValidation.customerId!);
      errors.push(...activeValidation.errors);
      warnings.push(...activeValidation.warnings);
    }

    // Validate no duplicate invoices
    if (xmlData.folio && xmlData.serie) {
      const duplicateValidation = await validateNoDuplicateInvoice(
        companyId,
        xmlData.receptor?.rfc,
        xmlData.folio,
        xmlData.serie
      );
      errors.push(...duplicateValidation.errors);
      warnings.push(...duplicateValidation.warnings);
    }

    // Validate invoice date
    if (xmlData.fecha_emision) {
      const dateValidation = validateInvoiceDate(xmlData.fecha_emision);
      errors.push(...dateValidation.errors);
      warnings.push(...dateValidation.warnings);
    }

    // Validate item prices
    if (Array.isArray(xmlData.conceptos)) {
      const priceValidation = validateItemPrices(xmlData.conceptos);
      errors.push(...priceValidation.errors);
      warnings.push(...priceValidation.warnings);
    }

    // Validate totals
    const totalsValidation = validateInvoiceTotals(xmlData);
    errors.push(...totalsValidation.errors);
    warnings.push(...totalsValidation.warnings);
  } catch (error) {
    errors.push(`Business logic validation error: ${error instanceof Error ? error.message : 'Unknown'}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export default {
  validateCustomerExists,
  validateCustomerActive,
  validateNoDuplicateInvoice,
  validateInvoiceDate,
  validateItemPrices,
  validateInvoiceTotals,
  validateRequiredFields,
  validateBusinessLogic,
};
