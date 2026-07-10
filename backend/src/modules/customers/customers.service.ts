/**
 * Customers Service
 * Business logic for customer management
 */

import { query } from '../../config/database';
import { ConflictError, NotFoundError, ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import { Customer } from '../../types';
import { isValidRFC, isValidEmail, isValidPostalCode, isValidStateCode } from '../../utils/validators';

/**
 * Create customer
 */
export async function createCustomer(companyId: string, data: {
  rfc: string;
  businessName: string;
  fiscalRegime?: string;
  defaultCfdiUse?: string;
  postalCode?: string;
  state?: string;
  municipality?: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  extNumber?: string;
  address?: string;
  email?: string;
  phone?: string;
  contactPerson?: string;
  creditLimit?: number;
  creditDays?: number;
  /** CUSTOMER (default) = al que YO facturo; SUPPLIER = el que ME factura. */
  partyType?: 'CUSTOMER' | 'SUPPLIER';
}): Promise<Customer> {
  // Validate RFC
  if (!isValidRFC(data.rfc)) {
    throw new ValidationError('Invalid RFC format');
  }

  // Check if customer with this RFC already exists in the company
  const existing = await query<Customer>(
    'SELECT id FROM customers WHERE company_id = $1 AND rfc = $2 AND deleted_at IS NULL',
    [companyId, data.rfc.toUpperCase()]
  );

  if (existing.rows.length > 0) {
    throw new ConflictError('Customer with this RFC already exists in this company');
  }

  // Validate email if provided
  if (data.email && !isValidEmail(data.email)) {
    throw new ValidationError('Invalid email format');
  }

  // Validate postal code if provided
  if (data.postalCode && !isValidPostalCode(data.postalCode)) {
    throw new ValidationError('Invalid postal code format');
  }

  // Validación de estado: aceptamos cualquier clave SAT del catálogo c_Estado
  // (la validación estricta se hace al timbrar; aquí solo bloqueamos basura evidente).
  if (data.state && data.state.length > 50) {
    throw new ValidationError('State code too long');
  }

  // Insert customer
  const result = await query<Customer>(
    `INSERT INTO customers
     (company_id, rfc, business_name, fiscal_regime, default_cfdi_use,
      postal_code, state, municipality, city, neighborhood, street, ext_number, address,
      email, phone, contact_person, credit_limit, credit_days, party_type, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, true)
     RETURNING *`,
    [
      companyId,
      data.rfc.toUpperCase(),
      data.businessName,
      data.fiscalRegime,
      data.defaultCfdiUse,
      data.postalCode,
      data.state,
      data.municipality,
      data.city,
      data.neighborhood,
      data.street,
      data.extNumber,
      data.address,
      data.email?.toLowerCase(),
      data.phone,
      data.contactPerson,
      data.creditLimit || 0,
      data.creditDays || 0,
      data.partyType === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER',
    ]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create customer');
  }

  logger.info(`Customer created: ${data.rfc} in company ${companyId}`);

  return result.rows[0];
}

/**
 * Get customer by ID
 */
export async function getCustomerById(companyId: string, customerId: string): Promise<Customer> {
  const result = await query<Customer>(
    'SELECT * FROM customers WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL',
    [customerId, companyId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Customer not found');
  }

  return result.rows[0];
}

/**
 * Get customer by RFC
 */
export async function getCustomerByRFC(companyId: string, rfc: string): Promise<Customer> {
  const result = await query<Customer>(
    'SELECT * FROM customers WHERE company_id = $1 AND rfc = $2 AND deleted_at IS NULL',
    [companyId, rfc.toUpperCase()]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Customer not found');
  }

  return result.rows[0];
}

/**
 * List customers with filters
 */
export async function listCustomers(
  companyId: string,
  options: {
    search?: string;
    active?: boolean;
    limit?: number;
    offset?: number;
    sortBy?: 'name' | 'rfc' | 'balance' | 'created_at';
    sortOrder?: 'ASC' | 'DESC';
  } = {}
): Promise<{ customers: Customer[]; total: number }> {
  const {
    search,
    active = true,
    limit = 10,
    offset = 0,
    sortBy = 'created_at',
    sortOrder = 'DESC',
  } = options;

  // Build query — solo CLIENTES: los proveedores (party_type=SUPPLIER) viven
  // en la misma tabla (STI) pero se listan en /suppliers, no aquí. Sin este
  // filtro, los proveedores creados por compras XML (Fase 2 ALMACEN)
  // contaminarían el dashboard y el selector de cliente al facturar.
  let whereClause = `WHERE company_id = $1 AND deleted_at IS NULL AND party_type = 'CUSTOMER'`;
  const params: any[] = [companyId];
  let paramCount = 2;

  if (active !== undefined) {
    whereClause += ` AND is_active = $${paramCount++}`;
    params.push(active);
  }

  if (search) {
    whereClause += ` AND (business_name ILIKE $${paramCount} OR rfc ILIKE $${paramCount})`;
    params.push(`%${search}%`);
    paramCount++;
  }

  // Validate sort parameters
  const validSortFields = ['name', 'rfc', 'balance', 'created_at'];
  const validSortOrders = ['ASC', 'DESC'];

  if (!validSortFields.includes(sortBy) || !validSortOrders.includes(sortOrder)) {
    throw new ValidationError('Invalid sort parameters');
  }

  const sortFieldMap = {
    name: 'business_name',
    rfc: 'rfc',
    balance: 'balance',
    created_at: 'created_at',
  };

  const sortField = sortFieldMap[sortBy as keyof typeof sortFieldMap];

  // Get customers
  const customersResult = await query<Customer>(
    `SELECT * FROM customers ${whereClause}
     ORDER BY ${sortField} ${sortOrder}
     LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
    [...params, limit, offset]
  );

  // Get total count
  const totalResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM customers ${whereClause}`,
    params
  );

  const total = parseInt(totalResult.rows[0].count, 10);

  return {
    customers: customersResult.rows,
    total,
  };
}

/**
 * Update customer
 */
export async function updateCustomer(
  companyId: string,
  customerId: string,
  data: Partial<Customer>
): Promise<Customer> {
  // Get current customer
  const customer = await getCustomerById(companyId, customerId);

  // If RFC changed, validate it
  if (data.rfc && data.rfc !== customer.rfc) {
    if (!isValidRFC(data.rfc)) {
      throw new ValidationError('Invalid RFC format');
    }

    const existing = await query<Customer>(
      'SELECT id FROM customers WHERE company_id = $1 AND rfc = $2 AND id != $3 AND deleted_at IS NULL',
      [companyId, data.rfc.toUpperCase(), customerId]
    );

    if (existing.rows.length > 0) {
      throw new ConflictError('RFC already exists in this company');
    }
  }

  // Validate email if provided
  if (data.email && !isValidEmail(data.email)) {
    throw new ValidationError('Invalid email format');
  }

  // Validate postal code if provided
  if (data.postal_code && !isValidPostalCode(data.postal_code)) {
    throw new ValidationError('Invalid postal code format');
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
    values.push(data.email?.toLowerCase());
  }
  if (data.phone !== undefined) {
    fields.push(`phone = $${paramCount++}`);
    values.push(data.phone);
  }
  if (data.contact_person !== undefined) {
    fields.push(`contact_person = $${paramCount++}`);
    values.push(data.contact_person);
  }
  if (data.credit_limit !== undefined) {
    fields.push(`credit_limit = $${paramCount++}`);
    values.push(data.credit_limit);
  }
  if (data.credit_days !== undefined) {
    fields.push(`credit_days = $${paramCount++}`);
    values.push(data.credit_days);
  }
  if (data.is_active !== undefined) {
    fields.push(`is_active = $${paramCount++}`);
    values.push(data.is_active);
  }
  // Campos del domicilio fiscal del receptor (CFDI 4.0)
  for (const f of [
    'default_cfdi_use','postal_code','state','municipality','city',
    'neighborhood','street','ext_number','address',
  ]) {
    if ((data as any)[f] !== undefined) {
      fields.push(`${f} = $${paramCount++}`);
      values.push((data as any)[f]);
    }
  }

  if (fields.length === 0) {
    return customer;
  }

  fields.push(`updated_at = NOW()`);
  values.push(customerId);

  const result = await query<Customer>(
    `UPDATE customers SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to update customer');
  }

  logger.info(`Customer updated: ${customerId}`);

  return result.rows[0];
}

/**
 * Delete customer (soft delete)
 */
export async function deleteCustomer(companyId: string, customerId: string): Promise<void> {
  const customer = await getCustomerById(companyId, customerId);

  // Guard: no borrar si el cliente tiene facturas (SAT: retención 5 años).
  const usageR = await query<{ n: string; sample: string | null }>(
    `SELECT COUNT(*)::text AS n,
            (SELECT CONCAT(serie, '-', folio) FROM invoices
              WHERE customer_id = $1 AND deleted_at IS NULL LIMIT 1) AS sample
       FROM invoices
      WHERE customer_id = $1 AND deleted_at IS NULL`,
    [customerId]
  );
  const uses = parseInt(usageR.rows[0]?.n || '0', 10);
  if (uses > 0) {
    const sample = usageR.rows[0]?.sample || '';
    throw new ValidationError(
      `No se puede eliminar el cliente "${customer.business_name || customer.rfc}" — tiene ${uses} factura(s)` +
      (sample ? ` (ej. ${sample})` : '') +
      '. Márcalo como inactivo desde el catálogo si ya no se usará.'
    );
  }

  await query(
    'UPDATE customers SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1',
    [customerId]
  );

  logger.info(`Customer deleted: ${customer.rfc}`);
}

/**
 * Calculate customer balance (from invoices and payments)
 */
export async function calculateBalance(customerId: string): Promise<number> {
  const result = await query<{ balance: string }>(
    `SELECT COALESCE(
       SUM(i.total) - COALESCE(SUM(p.payment_amount), 0), 0
     ) as balance
     FROM invoices i
     LEFT JOIN payments p ON i.id = p.invoice_id AND p.document_status = 'STAMPED'
     WHERE i.customer_id = $1
       AND i.status IN ('SENT', 'PARTIAL_PAYMENT')
       AND i.deleted_at IS NULL`,
    [customerId]
  );

  return parseFloat(result.rows[0].balance);
}

/**
 * Get customer's pending invoices
 */
export async function getCustomerPendingInvoices(customerId: string, limit: number = 50) {
  return query(
    `SELECT id, folio, serie, total, date_issued, status
     FROM invoices
     WHERE customer_id = $1 AND status IN ('SENT', 'PARTIAL_PAYMENT') AND deleted_at IS NULL
     ORDER BY date_issued DESC
     LIMIT $2`,
    [customerId, limit]
  );
}

/**
 * Update customer balance (called when invoice/payment changes)
 */
export async function updateCustomerBalance(customerId: string): Promise<void> {
  const balance = await calculateBalance(customerId);

  await query(
    'UPDATE customers SET balance = $1, updated_at = NOW() WHERE id = $2',
    [balance, customerId]
  );

  logger.debug(`Customer balance updated: ${customerId} = ${balance}`);
}

/**
 * Get customer statistics
 */
export async function getCustomerStats(companyId: string, customerId: string) {
  const customer = await getCustomerById(companyId, customerId);

  const invoicesResult = await query<{ count: string; total: string }>(
    `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
     FROM invoices
     WHERE customer_id = $1 AND status IN ('STAMPED', 'SENT', 'PAID', 'PARTIAL_PAYMENT')
       AND deleted_at IS NULL`,
    [customerId]
  );

  const paymentsResult = await query<{ total: string }>(
    `SELECT COALESCE(SUM(payment_amount), 0) as total
     FROM payments
     WHERE invoice_id IN (
       SELECT id FROM invoices WHERE customer_id = $1 AND deleted_at IS NULL
     ) AND document_status = 'STAMPED'`,
    [customerId]
  );

  const balance = await calculateBalance(customerId);

  return {
    customer,
    stats: {
      totalInvoices: parseInt(invoicesResult.rows[0].count, 10),
      totalInvoiced: parseFloat(invoicesResult.rows[0].total),
      totalPaid: parseFloat(paymentsResult.rows[0].total),
      pendingBalance: balance,
      creditLimit: customer.credit_limit,
      creditUsed: Math.max(0, balance),
      creditAvailable: Math.max(0, customer.credit_limit - balance),
      onCredit: balance > customer.credit_limit,
    },
  };
}

export default {
  createCustomer,
  getCustomerById,
  getCustomerByRFC,
  listCustomers,
  updateCustomer,
  deleteCustomer,
  calculateBalance,
  getCustomerPendingInvoices,
  updateCustomerBalance,
  getCustomerStats,
};
