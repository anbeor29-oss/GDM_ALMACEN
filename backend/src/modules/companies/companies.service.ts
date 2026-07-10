/**
 * Companies Service
 * Business logic for company management
 */

import { query } from '../../config/database';
import { ConflictError, NotFoundError, ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import { Company } from '../../types';
import { isValidRFC } from '../../utils/validators';

/**
 * Create company
 */
export async function createCompany(data: {
  rfc: string;
  businessName: string;
  fiscalRegime: string;
  postalCode?: string;
  state?: string;
  email?: string;
  phone?: string;
}): Promise<Company> {
  // Validate RFC
  if (!isValidRFC(data.rfc)) {
    throw new ValidationError('Invalid RFC format');
  }

  // Check if RFC already exists
  const existing = await query<Company>(
    'SELECT id FROM companies WHERE rfc = $1',
    [data.rfc.toUpperCase()]
  );

  if (existing.rows.length > 0) {
    throw new ConflictError('Company with this RFC already exists');
  }

  // Insert company
  const result = await query<Company>(
    `INSERT INTO companies
     (rfc, business_name, fiscal_regime, postal_code, state, email, phone,
      is_active, verified_with_sat, next_invoice_folio, default_invoice_series, subscription_plan)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, false, 1, 'F', 'STARTER')
     RETURNING *`,
    [
      data.rfc.toUpperCase(),
      data.businessName,
      data.fiscalRegime,
      data.postalCode,
      data.state,
      data.email,
      data.phone,
    ]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create company');
  }

  logger.info(`Company created: ${data.rfc}`);

  return result.rows[0];
}

/**
 * Get company by ID
 */
export async function getCompanyById(id: string): Promise<Company> {
  const result = await query<Company>(
    'SELECT * FROM companies WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Company not found');
  }

  return result.rows[0];
}

/**
 * Get company by RFC
 */
export async function getCompanyByRFC(rfc: string): Promise<Company> {
  const result = await query<Company>(
    'SELECT * FROM companies WHERE rfc = $1 AND deleted_at IS NULL',
    [rfc.toUpperCase()]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Company not found');
  }

  return result.rows[0];
}

/**
 * List all companies (admin only)
 */
export async function listCompanies(limit: number = 10, offset: number = 0): Promise<{ companies: Company[]; total: number }> {
  const companiesResult = await query<Company>(
    'SELECT * FROM companies WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );

  const totalResult = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM companies WHERE deleted_at IS NULL'
  );

  const total = parseInt(totalResult.rows[0].count, 10);

  return {
    companies: companiesResult.rows,
    total,
  };
}

/**
 * Update company
 */
export async function updateCompany(id: string, data: Partial<Company>): Promise<Company> {
  // Get current company
  const company = await getCompanyById(id);

  // If RFC changed, validate it's not taken
  if (data.rfc && data.rfc !== company.rfc) {
    if (!isValidRFC(data.rfc)) {
      throw new ValidationError('Invalid RFC format');
    }

    const existing = await query<Company>(
      'SELECT id FROM companies WHERE rfc = $1 AND id != $2',
      [data.rfc.toUpperCase(), id]
    );

    if (existing.rows.length > 0) {
      throw new ConflictError('RFC already exists');
    }
  }

  // Build update query
  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (data.rfc) {
    fields.push(`rfc = $${paramCount++}`);
    values.push(data.rfc.toUpperCase());
  }
  if (data.business_name) {
    fields.push(`business_name = $${paramCount++}`);
    values.push(data.business_name);
  }
  if (data.fiscal_regime) {
    fields.push(`fiscal_regime = $${paramCount++}`);
    values.push(data.fiscal_regime);
  }
  if (data.email !== undefined) {
    fields.push(`email = $${paramCount++}`);
    values.push(data.email);
  }
  if (data.phone !== undefined) {
    fields.push(`phone = $${paramCount++}`);
    values.push(data.phone);
  }
  if (data.is_active !== undefined) {
    fields.push(`is_active = $${paramCount++}`);
    values.push(data.is_active);
  }
  // Domicilio fiscal del emisor (CFF Art. 29-A fracc. IV)
  for (const f of ['postal_code','state','municipality','city','neighborhood','street','ext_number','address']) {
    if ((data as any)[f] !== undefined) {
      fields.push(`${f} = $${paramCount++}`);
      values.push((data as any)[f]);
    }
  }
  // Configuración de folios/series por empresa (lo puede personalizar el admin)
  for (const f of ['default_invoice_series','next_invoice_folio']) {
    if ((data as any)[f] !== undefined) {
      fields.push(`${f} = $${paramCount++}`);
      values.push((data as any)[f]);
    }
  }

  if (fields.length === 0) {
    return company;
  }

  fields.push(`updated_at = NOW()`);
  values.push(id);

  const result = await query<Company>(
    `UPDATE companies SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to update company');
  }

  logger.info(`Company updated: ${id}`);

  return result.rows[0];
}

/**
 * Delete company (soft delete)
 */
export async function deleteCompany(id: string): Promise<void> {
  const company = await getCompanyById(id);

  await query(
    'UPDATE companies SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1',
    [id]
  );

  logger.info(`Company deleted: ${company.rfc}`);
}

/**
 * Get next invoice folio
 */
export async function getNextInvoiceFolio(companyId: string): Promise<number> {
  const company = await getCompanyById(companyId);
  return company.next_invoice_folio;
}

/**
 * Increment invoice folio
 */
export async function incrementInvoiceFolio(companyId: string): Promise<number> {
  const result = await query<{ next_invoice_folio: number }>(
    'UPDATE companies SET next_invoice_folio = next_invoice_folio + 1, updated_at = NOW() WHERE id = $1 RETURNING next_invoice_folio',
    [companyId]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to increment invoice folio');
  }

  return result.rows[0].next_invoice_folio;
}

/**
 * Get and increment invoice folio atomically (for use within transactions)
 * Returns the folio that was assigned BEFORE incrementing
 */
export async function getAndIncrementInvoiceFolio(companyId: string): Promise<number> {
  const result = await query<{ folio: number }>(
    `UPDATE companies
     SET next_invoice_folio = next_invoice_folio + 1, updated_at = NOW()
     WHERE id = $1
     RETURNING (next_invoice_folio - 1) as folio`,
    [companyId]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to get and increment invoice folio');
  }

  return result.rows[0].folio;
}

export default {
  createCompany,
  getCompanyById,
  getCompanyByRFC,
  listCompanies,
  updateCompany,
  deleteCompany,
  getNextInvoiceFolio,
  incrementInvoiceFolio,
  getAndIncrementInvoiceFolio,
};
