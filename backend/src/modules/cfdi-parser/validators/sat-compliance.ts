/**
 * SAT Compliance Validator
 * Validates against SAT catalogs and rules
 */

import { query } from '../../../config/database';
import { ValidationResult } from './xml-structure';

/**
 * Validate RFC format
 */
export function validateRFC(rfc: string): boolean {
  if (!rfc) return false;
  // RFC format: 6 letters + 6 numbers (YYMMDD) + 3 verification codes = 12-13 characters
  const rfcPattern = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
  return rfcPattern.test(rfc.toUpperCase());
}

/**
 * Validate RFC against SAT database (simplified)
 */
export async function validateRFCAgainstSAT(rfc: string): Promise<boolean> {
  // In production, this would call SAT API
  // For now, we just validate format
  return validateRFC(rfc);
}

/**
 * Validate SAT product code (clave_prod_serv)
 */
export async function validateSATProductCode(clavesat: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!clavesat) {
    errors.push('Product code (clave SAT) is required');
    return { valid: false, errors, warnings };
  }

  // Check in SAT catalogs
  const result = await query(
    `SELECT id FROM sat_catalogs
     WHERE catalog_name = 'c_ClaveProdServ'
     AND catalog_key = $1`,
    [clavesat]
  );

  if (result.rows.length === 0) {
    errors.push(`Product code ${clavesat} not found in SAT catalog`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate SAT unit code (clave_unidad)
 */
export async function validateSATUnitCode(unitCode: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!unitCode) {
    errors.push('Unit code (clave unidad) is required');
    return { valid: false, errors, warnings };
  }

  const result = await query(
    `SELECT id FROM sat_catalogs
     WHERE catalog_name = 'c_ClaveUnidad'
     AND catalog_key = $1`,
    [unitCode]
  );

  if (result.rows.length === 0) {
    errors.push(`Unit code ${unitCode} not found in SAT catalog`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate SAT tax type (impuesto)
 */
export async function validateSATTaxType(taxType: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!taxType) {
    errors.push('Tax type (impuesto) is required');
    return { valid: false, errors, warnings };
  }

  // Valid SAT tax types: 001=ISR, 002=IVA, 003=IEPS
  const validTaxTypes = ['001', '002', '003'];
  if (!validTaxTypes.includes(taxType)) {
    errors.push(`Tax type ${taxType} not valid. Valid types: 001 (ISR), 002 (IVA), 003 (IEPS)`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate SAT tax rate (tasa o cuota)
 */
export async function validateSATTaxRate(taxRate: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!taxRate) {
    errors.push('Tax rate (tasa o cuota) is required');
    return { valid: false, errors, warnings };
  }

  // Common tax rates in Mexico
  const validRates = ['0.000000', '0.030000', '0.040000', '0.080000', '0.160000', '0.106667'];
  const rate = parseFloat(taxRate).toFixed(6);

  if (!validRates.includes(rate)) {
    warnings.push(
      `Tax rate ${taxRate} is not a standard rate. Standard rates: 0%, 3%, 4%, 8%, 16%, 10.67%`
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate payment method
 */
export function validatePaymentMethod(method: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const validMethods = [
    'PUE', // Pago en una exhibición
    'PPD', // Pago en parcialidades o diferido
  ];

  if (!method || !validMethods.includes(method)) {
    errors.push(`Invalid payment method: ${method}. Valid: ${validMethods.join(', ')}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate payment form (forma de pago)
 */
export function validatePaymentForm(form: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // SAT payment forms
  const validForms = [
    '01', // Efectivo
    '02', // Cheque nominativo del deudor
    '03', // Transferencia electrónica de fondos
    '04', // Tarjeta de crédito
    '05', // Moneda electrónica
    '06', // Dinero electrónico
    '07', // Vales de despensa
    '08', // Bienes o servicios pre-pagados
    '09', // Transferencia electrónica de fondos (servicios financieros)
    '10', // Efectivo y cheque
    '11', // Cheque y transferencia
    '12', // Transferencia y tarjeta de crédito
    '13', // Dinero electrónico y efectivo
    '14', // Dinero electrónico y cheque
    '15', // Dinero electrónico y transferencia
    '16', // Dinero electrónico y tarjeta de crédito
    '17', // Condonación de deuda
    '23', // Novación
    '24', // Compensación
    '25', // Novación y compensación
    '26', // Cheque postdatado
    '27', // Tarjeta de débito
    '28', // Tarjeta de servicios
    '29', // Moneda virtual
    '30', // Otros
  ];

  if (!form || !validForms.includes(form)) {
    warnings.push(`Payment form ${form} may not be standard. Standard forms: ${validForms.join(', ')}`);
  }

  return { valid: true, errors, warnings };
}

/**
 * Validate CFDI use (uso CFDI)
 */
export function validateCFDIUse(use: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Common CFDI uses
  const validUses = [
    'G01', // Adquisición de mercancias
    'G02', // Devoluciones, descuentos o bonificaciones
    'G03', // Gastos en general
    'I01', // Construcciones
    'I02', // Mobiliario y equipo de oficina
    'I03', // Equipo de transporte
    'I04', // Equipo de cómputo y accesorios
    'I05', // Dados, troqueles, moldes, matrices
    'I06', // Teléfonos celulares
    'I07', // Juguetes y videojuegos
    'I08', // Envases
    'D01', // Honorarios
    'D02', // Hospedaje
    'D03', // Transporte
    'D04', // Gasolina y combustibles
    'D05', // Reparación y mantenimiento
    'D06', // Viáticos
    'D07', // Emisión de comprobantes fiscales
    'D08', // Impuestos y cuotas
    'D09', // Contribuciones de seguridad social
    'D10', // Otras aportaciones
    'P01', // Por definir
    'S01', // Sin efecto fiscal
  ];

  if (!use || !validUses.includes(use)) {
    warnings.push(`CFDI use ${use} may not be standard. Common uses: ${validUses.slice(0, 5).join(', ')}...`);
  }

  return { valid: true, errors, warnings };
}

/**
 * Comprehensive SAT compliance validation
 */
export async function validateSATCompliance(xmlData: any): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Validate RFCs
    if (!validateRFC(xmlData.emisor?.rfc)) {
      errors.push(`Invalid Emisor RFC: ${xmlData.emisor?.rfc}`);
    }

    if (!validateRFC(xmlData.receptor?.rfc)) {
      errors.push(`Invalid Receptor RFC: ${xmlData.receptor?.rfc}`);
    }

    // Validate product codes
    for (const concepto of xmlData.conceptos || []) {
      const productValidation = await validateSATProductCode(concepto.clave_sat);
      if (!productValidation.valid) {
        errors.push(...productValidation.errors);
      }

      const unitValidation = await validateSATUnitCode(concepto.clave_unidad);
      if (!unitValidation.valid) {
        errors.push(...unitValidation.errors);
      }
    }

    // Validate payment method and form
    const paymentValidation = validatePaymentMethod(xmlData.metodo_pago);
    if (!paymentValidation.valid) {
      warnings.push(...paymentValidation.errors);
    }

    const formValidation = validatePaymentForm(xmlData.forma_pago);
    if (!formValidation.valid) {
      warnings.push(...formValidation.warnings);
    }

    // Validate CFDI use
    const useValidation = validateCFDIUse(xmlData.receptor?.uso_cfdi);
    if (!useValidation.valid) {
      warnings.push(...useValidation.warnings);
    }
  } catch (error) {
    errors.push(`SAT compliance validation error: ${error instanceof Error ? error.message : 'Unknown'}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export default {
  validateRFC,
  validateRFCAgainstSAT,
  validateSATProductCode,
  validateSATUnitCode,
  validateSATTaxType,
  validateSATTaxRate,
  validatePaymentMethod,
  validatePaymentForm,
  validateCFDIUse,
  validateSATCompliance,
};
