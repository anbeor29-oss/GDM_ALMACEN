/**
 * Customers Service
 * Business logic for customer management
 */

import { query, transaction, transactionQuery } from '../../config/database';
import { tomarEdicion } from '../../utils/edicion';
import { ConflictError, NotFoundError, ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import { Customer } from '../../types';
import { isValidRFC, isValidEmail, isValidPostalCode, isValidStateCode } from '../../utils/validators';

/**
 * SALDO DEL CLIENTE — lo que nos debe hoy.
 *
 * Se define una sola vez porque lo usan el listado y calculateBalance(), y
 * tenerlo duplicado fue precisamente lo que dejó que se desincronizaran.
 *
 * Dos errores que corrige respecto de la versión anterior:
 *
 *  1. Filtraba por `status IN ('SENT','PARTIAL_PAYMENT')`, y esos dos estados
 *     NO EXISTEN en este sistema: una factura es DRAFT, STAMPED, PAID o
 *     CANCELLED. El filtro no casaba con nada, así que el saldo salía SIEMPRE
 *     en cero — por eso "cuando hay saldo, no aparece".
 *  2. Hacía `SUM(i.total) - SUM(p.payment_amount)` sobre un LEFT JOIN. Con dos
 *     pagos parciales, el total de la factura se sumaba DOS veces y la deuda
 *     salía inflada. Los pagos se agregan ahora en una subconsulta, de modo
 *     que cada factura entra una sola vez.
 *
 * Se cuentan solo las STAMPED: la timbrada es la que ampara la deuda. DRAFT
 * todavía no existe para el SAT, CANCELLED dejó de existir, y PAID ya se
 * liquidó.
 */
const SALDO_SQL = `
  COALESCE((
    SELECT SUM(
             i.total
             /* Lo pagado. Sale de payment_invoices, que es donde vive el
              * desglose desde que un pago puede liquidar VARIAS facturas.
              *
              * Antes se leía payments.invoice_id, que en un pago multi-factura
              * apunta sólo a la PRIMERA —"por compatibilidad", dice el propio
              * código de pagos—. El total del cliente salía bien de milagro
              * (el importe completo se restaba una vez), pero factura por
              * factura era falso: la primera quedaba con saldo negativo y las
              * demás debiendo entero.
              *
              * El COALESCE al final cubre los pagos viejos, anteriores a la
              * tabla puente, que sólo existen en payments.invoice_id. */
             - COALESCE((
                 SELECT SUM(pi.monto)
                   FROM payment_invoices pi
                   JOIN payments p ON p.id = pi.payment_id
                  WHERE pi.invoice_id = i.id
                    AND p.document_status = 'STAMPED'
                    AND p.deleted_at IS NULL
               ), (
                 SELECT SUM(p.payment_amount)
                   FROM payments p
                  WHERE p.invoice_id = i.id
                    AND p.document_status = 'STAMPED'
                    AND p.deleted_at IS NULL
               ), 0)
             /* Las notas de crédito NO se restaban.
              *
              * Una NC reduce lo que el cliente debe —para eso existe—, así que
              * sin esto el sistema le seguía cobrando un descuento que ya se le
              * había concedido. Sólo cuentan las timbradas: una NC en borrador
              * no ampara nada y una cancelada dejó de existir. */
             - COALESCE((
                 SELECT SUM(cn.total)
                   FROM credit_notes cn
                  WHERE cn.invoice_id = i.id
                    AND cn.status = 'STAMPED'
               ), 0)
           )
      FROM invoices i
     WHERE i.customer_id = c.id
       AND i.status = 'STAMPED'
       AND i.deleted_at IS NULL
  ), 0)`;

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
  // Datos bancarios (depósito al proveedor — compra express)
  bankCode?: string;
  bankName?: string;
  bankAccount?: string;
  bankClabe?: string;
  bankAccountHolder?: string;
  creditLine?: number;
}): Promise<Customer> {
  // Validate RFC
  if (!isValidRFC(data.rfc)) {
    throw new ValidationError('Invalid RFC format');
  }

  // Anti-duplicados (requerimiento ALMACEN): el RFC es la identidad del
  // tercero. Si existe ACTIVO se rechaza con mensaje claro (indicando si es
  // cliente o proveedor); si existe SOFT-DELETED se REACTIVA actualizando
  // datos (el UNIQUE de BD impediría el INSERT de todos modos).
  const existing = await query<any>(
    'SELECT id, party_type, es_cliente, es_proveedor, business_name, deleted_at '
    + 'FROM customers WHERE company_id = $1 AND UPPER(rfc) = $2',
    [companyId, data.rfc.toUpperCase()]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (!row.deleted_at) {
      /* ── Ya existe: ¿mismo rol, o uno nuevo? ──
       *
       * Un tercero puede ser cliente Y proveedor —un banco donde tengo dinero
       * y que además me presta, un cliente que un día me vende algo—. Antes
       * esto se rechazaba siempre, y como el RFC es único por empresa no
       * quedaba salida: ni agregarle el rol, ni crear otro registro.
       *
       * Ahora, si le falta el rol que se pide, SE LE AGREGA y se devuelve el
       * mismo tercero. Duplicarlo sería la salida fácil y la peor: dos
       * expedientes del mismo banco, editados por separado, sin forma de
       * saber cuál manda. */
      const quiere = (data.partyType || 'CUSTOMER') === 'SUPPLIER' ? 'es_proveedor' : 'es_cliente';
      const yaLoTiene = quiere === 'es_proveedor' ? row.es_proveedor : row.es_cliente;

      if (yaLoTiene) {
        const tipo = quiere === 'es_proveedor' ? 'PROVEEDOR' : 'cliente';
        throw new ConflictError(
          `El RFC ${data.rfc.toUpperCase()} ya está registrado como ${tipo} ` +
          `(${row.business_name}). Edítalo en lugar de crearlo de nuevo.`
        );
      }

      const conRol = await query<Customer>(
        `UPDATE customers SET ${quiere} = TRUE, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [row.id]
      );
      return conRol.rows[0];
    }
    // Reactivar el registro borrado con los datos nuevos
    const revived = await query<Customer>(
      `UPDATE customers SET
          deleted_at = NULL, is_active = true,
          business_name = $1, fiscal_regime = COALESCE($2, fiscal_regime),
          postal_code = COALESCE($3, postal_code), email = COALESCE($4, email),
          phone = COALESCE($5, phone),
          es_cliente   = es_cliente   OR $6,
          es_proveedor = es_proveedor OR $7,
          updated_at = NOW()
        WHERE id = $8
        RETURNING *`,
      [data.businessName, data.fiscalRegime || null, data.postalCode || null,
       data.email || null, data.phone || null,
       /* OR y no asignacion: al revivir un tercero se le SUMA el rol que se
        * pide, sin quitarle los que ya tenia. */
       data.partyType !== 'SUPPLIER', data.partyType === 'SUPPLIER', row.id]
    );
    return revived.rows[0];
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
      email, phone, contact_person, credit_limit, credit_days,
      es_cliente, es_proveedor,
      bank_code, bank_name, bank_account, bank_clabe, bank_account_holder, credit_line, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
             $19, $20, $21, $22, $23, $24, $25, $26, true)
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
      /* El rol, no party_type: esa columna ahora la mantiene sola la base a
       * partir de las banderas, y escribirla a mano la dejaria peleada con
       * ellas en cuanto el tercero tenga dos roles. */
      data.partyType !== 'SUPPLIER',
      data.partyType === 'SUPPLIER',
      data.bankCode || null,
      data.bankName || null,
      data.bankAccount || null,
      data.bankClabe || null,
      data.bankAccountHolder || null,
      data.creditLine || 0,
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

  // Build query — solo CLIENTES. Se filtra por el ROL es_cliente y no por
  // party_type: un tercero puede ser cliente Y proveedor, y con el filtro
  // viejo desaparecia de esta lista en cuanto se le agregaba el otro rol.
  // Los proveedores viven
  // en la misma tabla (STI) pero se listan en /suppliers, no aquí. Sin este
  // filtro, los proveedores creados por compras XML (Fase 2 ALMACEN)
  // contaminarían el dashboard y el selector de cliente al facturar.
  let whereClause = `WHERE company_id = $1 AND deleted_at IS NULL AND es_cliente`;
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
    /* El saldo se CALCULA, no se lee de la columna.
     *
     * `customers.balance` sólo cambia si alguien llama updateCustomerBalance(),
     * y basta un pago, una nota de crédito o un timbrado que no la llame para
     * que el listado muestre un saldo viejo — que es justo lo que pasaba.
     *
     * El alias es `saldo_calculado` y NO `balance`: `c.*` ya trae la columna de
     * la tabla, y dos columnas con el mismo nombre dejan al driver decidir cuál
     * gana. Eso no lo puede decidir un driver. Abajo se pisa explícitamente. */
    `SELECT c.*, ${SALDO_SQL} AS saldo_calculado
       FROM customers c ${whereClause}
      ORDER BY ${sortField === 'balance' ? SALDO_SQL : sortField} ${sortOrder}
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
    /* `balance` se pisa con el calculado: la columna de la tabla viaja en la
     * fila pero está vieja, y quien consuma esto debe ver el saldo real sin
     * enterarse de que existen dos. */
    customers: customersResult.rows.map((r: any) => ({
      ...r,
      balance: Number(r.saldo_calculado ?? 0),
    })),
    total,
  };
}

/**
 * Update customer
 */
export async function updateCustomer(
  companyId: string,
  customerId: string,
  data: Partial<Customer>,
  /* Número de edición que traía el formulario. Sin él no se compara: los
   * procesos internos —el importador de XML, por ejemplo— no vienen de una
   * pantalla y no tienen ninguno que devolver. */
  edicionEsperada?: number | string | null
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
  // Campos del domicilio fiscal + datos bancarios (depósito) + línea de crédito.
  // credit_used queda FUERA a propósito: lo maneja el sistema (tesorería).
  for (const f of [
    'default_cfdi_use','postal_code','state','municipality','city',
    'neighborhood','street','ext_number','address',
    'bank_code','bank_name','bank_account','bank_clabe','bank_account_holder',
    'credit_line',
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

  /* El contador de edición y el UPDATE van en la MISMA transacción.
   *
   * Separados, un fallo del UPDATE dejaría el contador subido por un guardado
   * que nunca ocurrió, y el siguiente en abrir la pantalla recibiría un
   * conflicto inventado. */
  const result = await transaction(async (client) => {
    await tomarEdicion(client, 'customers', customerId, edicionEsperada);
    return transactionQuery<Customer>(
      client,
      `UPDATE customers SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
  });

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
