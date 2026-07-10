/**
 * XML Structure Validator
 * Validates CFDI XML structure and format
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate XML structure
 */
export function validateXMLStructure(xmlContent: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Check XML declaration
  if (!xmlContent.trim().startsWith('<?xml')) {
    errors.push('Missing or invalid XML declaration');
  }

  // 2. Check for valid XML syntax (basic checks)
  try {
    // Check that all tags are closed
    const openTagCount = (xmlContent.match(/<[^/][^>]*>/g) || []).length;
    const closeTagCount = (xmlContent.match(/<\/[^>]*>/g) || []).length;
    if (openTagCount !== closeTagCount) {
      errors.push('XML tags are not properly closed');
    }
  } catch (e) {
    errors.push(`Invalid XML syntax: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }

  // 3. Check required namespaces
  if (!xmlContent.includes('xmlns:cfdi="http://www.sat.gob.mx/cfd/4')) {
    errors.push('Missing or incorrect cfdi namespace (http://www.sat.gob.mx/cfd/4)');
  }

  if (!xmlContent.includes('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"')) {
    warnings.push('xsi namespace not found (optional but recommended)');
  }

  // 4. Check root element
  if (!xmlContent.includes('<cfdi:Comprobante')) {
    errors.push('Root element must be cfdi:Comprobante');
  }

  if (!xmlContent.includes('Version="4.0"')) {
    errors.push('CFDI version must be 4.0');
  }

  // 5. Check required elements
  const requiredElements = [
    '<cfdi:Emisor',
    '<cfdi:Receptor',
    '<cfdi:Conceptos',
    '<cfdi:Impuestos',
  ];

  requiredElements.forEach((element) => {
    if (!xmlContent.includes(element)) {
      errors.push(`Missing required element: ${element}`);
    }
  });

  // 6. Check encoding
  if (!xmlContent.includes('encoding="UTF-8"') && !xmlContent.includes("encoding='UTF-8'")) {
    warnings.push('Encoding should be UTF-8');
  }

  // (Tag checking done in step 2)

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate XML attributes
 */
export function validateXMLAttributes(xmlContent: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check Comprobante attributes
  if (!xmlContent.match(/Fecha="[^"]+"/)) {
    errors.push('Comprobante: Missing or invalid Fecha attribute');
  }

  if (!xmlContent.match(/FormaPago="[^"]+"/)) {
    errors.push('Comprobante: Missing or invalid FormaPago attribute');
  }

  if (!xmlContent.match(/SubTotal="[^"]+"/)) {
    errors.push('Comprobante: Missing or invalid SubTotal attribute');
  }

  if (!xmlContent.match(/Total="[^"]+"/)) {
    errors.push('Comprobante: Missing or invalid Total attribute');
  }

  // Check Emisor attributes
  if (!xmlContent.match(/<cfdi:Emisor[^>]*Rfc="[^"]+"/)) {
    errors.push('Emisor: Missing or invalid Rfc attribute');
  }

  if (!xmlContent.match(/<cfdi:Emisor[^>]*Nombre="[^"]+"/)) {
    warnings.push('Emisor: Nombre attribute recommended');
  }

  // Check Receptor attributes
  if (!xmlContent.match(/<cfdi:Receptor[^>]*Rfc="[^"]+"/)) {
    errors.push('Receptor: Missing or invalid Rfc attribute');
  }

  // Check Concepto attributes
  if (!xmlContent.match(/<cfdi:Concepto[^>]*Cantidad="[^"]+"/)) {
    errors.push('Concepto: Missing or invalid Cantidad attribute');
  }

  if (!xmlContent.match(/<cfdi:Concepto[^>]*ValorUnitario="[^"]+"/)) {
    errors.push('Concepto: Missing or invalid ValorUnitario attribute');
  }

  if (!xmlContent.match(/<cfdi:Concepto[^>]*Importe="[^"]+"/)) {
    errors.push('Concepto: Missing or invalid Importe attribute');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate numeric values
 */
export function validateNumericValues(xmlContent: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Extract numbers from attributes and validate
  const numberPattern = /(?:SubTotal|Total|ValorUnitario|Importe|Cantidad|TasaOCuota)="([^"]+)"/g;
  let match;

  while ((match = numberPattern.exec(xmlContent)) !== null) {
    const value = match[1];
    if (isNaN(parseFloat(value))) {
      errors.push(`Invalid numeric value: ${value}`);
    }

    // Check for negative values (except for discounts)
    if (parseFloat(value) < 0 && !xmlContent.includes('Descuento')) {
      errors.push(`Negative value found: ${value} (only allowed for discounts)`);
    }
  }

  // Validate that calculations are correct
  const subtotalMatch = xmlContent.match(/SubTotal="([^"]+)"/);
  const totalMatch = xmlContent.match(/Total="([^"]+)"/);
  const impuestoMatch = xmlContent.match(/TotalImpuestosTrasladados="([^"]+)"/);

  if (subtotalMatch && totalMatch) {
    const subtotal = parseFloat(subtotalMatch[1]);
    const total = parseFloat(totalMatch[1]);
    const impuesto = impuestoMatch ? parseFloat(impuestoMatch[1]) : 0;

    // Total should equal subtotal + impuesto
    const calculatedTotal = subtotal + impuesto;
    if (Math.abs(calculatedTotal - total) > 0.01) {
      // Allow 1 cent rounding difference
      warnings.push(
        `Total calculation mismatch: expected ${calculatedTotal.toFixed(2)}, got ${total.toFixed(2)}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Comprehensive XML validation
 */
export function validateCFDIXMLComplete(xmlContent: string): ValidationResult {
  const structureValidation = validateXMLStructure(xmlContent);
  const attributesValidation = validateXMLAttributes(xmlContent);
  const numericValidation = validateNumericValues(xmlContent);

  const allErrors = [
    ...structureValidation.errors,
    ...attributesValidation.errors,
    ...numericValidation.errors,
  ];

  const allWarnings = [
    ...structureValidation.warnings,
    ...attributesValidation.warnings,
    ...numericValidation.warnings,
  ];

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

export default {
  validateXMLStructure,
  validateXMLAttributes,
  validateNumericValues,
  validateCFDIXMLComplete,
};
