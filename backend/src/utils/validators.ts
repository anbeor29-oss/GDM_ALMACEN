/**
 * Validation Utilities
 * RFC, Email, and other validators
 */

/**
 * Validate Mexican RFC (Registro Federal de Contribuyentes)
 * Format: XXXXXX######XXX or XXXXXX######XXXXX (with homoclave)
 */
export function isValidRFC(rfc: string): boolean {
  // Remove whitespace
  const cleanRFC = rfc.trim().toUpperCase();

  // Regular expression for RFC format
  // 3-4 letters + 6 digits (YYMMDD) + 3 alphanumeric + optional 3 digits
  const rfcRegex = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}(\d{3})?$/;

  return rfcRegex.test(cleanRFC);
}

/**
 * Validate email address
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate Mexican postal code
 */
export function isValidPostalCode(code: string): boolean {
  // Mexican postal codes are 5 digits
  const postalRegex = /^\d{5}$/;
  return postalRegex.test(code);
}

/**
 * Validate UUID v4
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validate CFDI UUID (40 characters hex)
 */
export function isValidCFDIUUID(uuid: string): boolean {
  // CFDI UUID format: 8-4-4-4-12 hex digits with dashes
  const cfdiUuidRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  return cfdiUuidRegex.test(uuid);
}

/**
 * Validate Mexican phone number
 */
export function isValidPhoneNumber(phone: string): boolean {
  // Mexican phone: +52 or 52 followed by 10 digits, or just 10 digits
  const phoneRegex = /^(\+?52)?[\s]?\d{10}$/;
  return phoneRegex.test(phone.replace(/[\s-]/g, ''));
}

/**
 * Validate password strength
 * Requires: 8+ chars, 1 uppercase, 1 lowercase, 1 digit, 1 special char
 */
export function isStrongPassword(password: string): boolean {
  const strongRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return strongRegex.test(password);
}

/**
 * Validate Mexican state code
 */
export function isValidStateCode(code: string): boolean {
  // Mexican state codes (CVE_ENT from INEGI)
  const validStates = [
    '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
    '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
    '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
    '31', '32',
  ];
  return validStates.includes(code);
}

/**
 * Validate positive number
 */
export function isPositiveNumber(value: number | string): boolean {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return !isNaN(num) && num > 0;
}

/**
 * Validate non-negative number
 */
export function isNonNegativeNumber(value: number | string): boolean {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return !isNaN(num) && num >= 0;
}

/**
 * Validate percentage (0-100)
 */
export function isValidPercentage(value: number | string): boolean {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return !isNaN(num) && num >= 0 && num <= 100;
}

/**
 * Validate date format (YYYY-MM-DD)
 */
export function isValidDateFormat(date: string): boolean {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  return dateRegex.test(date);
}

/**
 * Validate ISO 8601 datetime
 */
export function isValidISO8601(datetime: string): boolean {
  try {
    const date = new Date(datetime);
    return date instanceof Date && !isNaN(date.getTime());
  } catch {
    return false;
  }
}

/**
 * Sanitize string input (remove special chars)
 */
export function sanitizeString(input: string): string {
  return input.trim().replace(/[<>]/g, '');
}

/**
 * Validate credit card (Luhn algorithm)
 */
export function isValidCreditCard(cardNumber: string): boolean {
  const cleaned = cardNumber.replace(/[\s-]/g, '');

  if (!/^\d{13,19}$/.test(cleaned)) {
    return false;
  }

  let sum = 0;
  let isEven = false;

  for (let i = cleaned.length - 1; i >= 0; i--) {
    let digit = parseInt(cleaned.charAt(i), 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

/**
 * Check if string is valid JSON
 */
export function isValidJSON(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate all RFC characters
 */
export function validateRFCChecksum(rfc: string): boolean {
  // Simple check - more complex SAT validation happens in API
  return isValidRFC(rfc);
}

export default {
  isValidRFC,
  isValidEmail,
  isValidPostalCode,
  isValidUUID,
  isValidCFDIUUID,
  isValidPhoneNumber,
  isStrongPassword,
  isValidStateCode,
  isPositiveNumber,
  isNonNegativeNumber,
  isValidPercentage,
  isValidDateFormat,
  isValidISO8601,
  sanitizeString,
  isValidCreditCard,
  isValidJSON,
  validateRFCChecksum,
};
