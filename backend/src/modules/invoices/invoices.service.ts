/**
 * Invoices Service
 * Business logic for invoice management with automatic calculations
 */

import { query, transaction, transactionQuery } from '../../config/database';
import { ConflictError, NotFoundError, ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import { Invoice } from '../../types';
import * as customersService from '../customers/customers.service';
import * as productsService from '../products/products.service';
import * as companiesService from '../companies/companies.service';

interface InvoiceLineItem {
  productId: string;
  quantity: number;
  unitPrice?: number;  // Si no se proporciona, se toma del producto
  taxPresetId?: string; // ej. 'iva16', 'iva0', 'ivaex', 'hon_pf_pm', ...
}

/**
 * Catálogo de presets de impuesto (espejo del front).
 * Aquí vive la fuente de verdad para construir el desglose Anexo 20.
 *
 *  rateIva : IVA trasladado (tasa)
 *  retIva  : IVA retenido (tasa)
 *  retIsr  : ISR retenido (tasa)
 *  iepsRate: IEPS trasladado (tasa)
 *  isExempt: true si la operación es exenta de IVA (TipoFactor='Exento')
 */
interface TaxPreset {
  id: string;
  rateIva: number;
  retIva: number;
  retIsr: number;
  iepsRate: number;
  isExempt: boolean;
}

const TAX_PRESETS: Record<string, TaxPreset> = {
  iva16:        { id: 'iva16',        rateIva: 0.16, retIva: 0,        retIsr: 0,      iepsRate: 0, isExempt: false },
  iva8:         { id: 'iva8',         rateIva: 0.08, retIva: 0,        retIsr: 0,      iepsRate: 0, isExempt: false },
  iva0:         { id: 'iva0',         rateIva: 0,    retIva: 0,        retIsr: 0,      iepsRate: 0, isExempt: false },
  ivaex:        { id: 'ivaex',        rateIva: 0,    retIva: 0,        retIsr: 0,      iepsRate: 0, isExempt: true  },
  hon_pf_pm:    { id: 'hon_pf_pm',    rateIva: 0.16, retIva: 0.106667, retIsr: 0.10,   iepsRate: 0, isExempt: false },
  resico_pf_pm: { id: 'resico_pf_pm', rateIva: 0.16, retIva: 0.106667, retIsr: 0.0125, iepsRate: 0, isExempt: false },
  arr_pf_pm:    { id: 'arr_pf_pm',    rateIva: 0.16, retIva: 0.106667, retIsr: 0.10,   iepsRate: 0, isExempt: false },
  auto_carga:   { id: 'auto_carga',   rateIva: 0.16, retIva: 0.04,     retIsr: 0,      iepsRate: 0, isExempt: false },
  desperdicios: { id: 'desperdicios', rateIva: 0.16, retIva: 0.16,     retIsr: 0,      iepsRate: 0, isExempt: false },
};

function resolveTaxPreset(presetId: string | undefined, product: any): TaxPreset {
  if (presetId && TAX_PRESETS[presetId]) return TAX_PRESETS[presetId];
  // Inferir desde el producto cuando el front no envía preset
  if (product?.is_exempt) return TAX_PRESETS.ivaex;
  const r = Number(product?.tax_rate);
  if (r === 0.08) return TAX_PRESETS.iva8;
  if (r === 0)    return TAX_PRESETS.iva0;
  return TAX_PRESETS.iva16;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export { TAX_PRESETS };

/**
 * Create invoice with automatic calculations
 */
export async function createInvoice(
  companyId: string,
  data: {
    customerId: string;
    cfdiType: 'I' | 'E' | 'T';  // Ingreso, Egreso, Traslado
    paymentForm: string;
    paymentMethod: string;
    cfdiUse: string;
    items: InvoiceLineItem[];
    currency?: string;
    exchangeRate?: number;
    discount?: number;
    paymentTerms?: string;
    notes?: string;
  }
): Promise<any> {
  return transaction(async (client) => {
    // 1. Validate company exists
    const company = await companiesService.getCompanyById(companyId);

    // 2. Validate customer exists and belongs to company
    const customer = await customersService.getCustomerById(companyId, data.customerId);

    // 3. Validate items (productos) y construir desglose Anexo 20 por línea
    const invoiceItems: any[] = [];
    let subtotal = 0;
    let totIvaTraslado = 0;
    let totIvaRetenido = 0;
    let totIsrRetenido = 0;
    let totIeps = 0;

    for (const item of data.items) {
      const product = await productsService.getProductById(companyId, item.productId);
      const preset  = resolveTaxPreset(item.taxPresetId, product);

      const unitPrice    = item.unitPrice || product.base_price || 0;
      const lineSubtotal = r2(item.quantity * unitPrice);
      const lineIvaTrasl = r2(lineSubtotal * preset.rateIva);
      const lineRetIva   = r2(lineSubtotal * preset.retIva);
      const lineRetIsr   = r2(lineSubtotal * preset.retIsr);
      const lineIeps     = r2(lineSubtotal * preset.iepsRate);
      const lineTotal    = r2(lineSubtotal + lineIvaTrasl + lineIeps - lineRetIva - lineRetIsr);

      invoiceItems.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        subtotal: lineSubtotal,
        taxAmount: lineIvaTrasl,      // IVA trasladado por línea (compat)
        total: lineTotal,
        claveSat: product.clave_sat,
        unitCode: product.unit_code,
        taxRate: preset.rateIva,
        // Prioriza descripción custom del item (usuario puede cambiarla en
        // Nueva Factura sin tocar el catálogo). Solo fallback al name del producto.
        description: ((item as any).description || product.name || '').toString().trim(),
        taxPresetId: preset.id,
        retIvaRate: preset.retIva,
        retIsrRate: preset.retIsr,
        iepsRate: preset.iepsRate,
        retIvaAmount: lineRetIva,
        retIsrAmount: lineRetIsr,
        iepsAmount: lineIeps,
        isExempt: preset.isExempt,
      });

      subtotal       += lineSubtotal;
      totIvaTraslado += lineIvaTrasl;
      totIvaRetenido += lineRetIva;
      totIsrRetenido += lineRetIsr;
      totIeps        += lineIeps;
    }

    if (invoiceItems.length === 0) {
      throw new ValidationError('Invoice must have at least one item');
    }

    // 4. Calculate totals (Anexo 20: Total = SubT + Trasl − Ret − Desc)
    const discount = data.discount || 0;
    const totRetenido = r2(totIvaRetenido + totIsrRetenido);
    const total = r2(subtotal + totIvaTraslado + totIeps - totRetenido - discount);
    const totalTax = r2(totIvaTraslado); // legado — se sigue guardando en tax_transferred

    // 5. Get and increment folio atomically
    const nextFolio = await companiesService.getAndIncrementInvoiceFolio(companyId);

    // 6. Create invoice
    const invoiceResult = await transactionQuery(
      client,
      `INSERT INTO invoices
       (company_id, customer_id, folio, serie, cfdi_type, date_issued,
        currency, exchange_rate, subtotal, tax_transferred, tax_retained,
        tax_retained_iva, tax_retained_isr, tax_ieps, total,
        discount, payment_form, payment_method, cfdi_use,
        payment_terms, notes, status, is_active)
       VALUES ($1, $2, $3, $4, $5, NOW(),
               $6, $7, $8, $9, $10,
               $11, $12, $13, $14,
               $15, $16, $17, $18, $19, $20, 'DRAFT', true)
       RETURNING *`,
      [
        companyId,
        data.customerId,
        nextFolio,
        company.default_invoice_series,
        data.cfdiType,
        data.currency || 'MXN',
        data.exchangeRate || 1,
        subtotal,
        totalTax,
        totRetenido,
        totIvaRetenido,
        totIsrRetenido,
        totIeps,
        total,
        discount,
        data.paymentForm,
        data.paymentMethod,
        data.cfdiUse,
        data.paymentTerms,
        data.notes,
      ]
    );

    if (invoiceResult.rows.length === 0) {
      throw new Error('Failed to create invoice');
    }

    const invoice = invoiceResult.rows[0];

    // 7. Insert line items
    for (let idx = 0; idx < invoiceItems.length; idx++) {
      const item = invoiceItems[idx];

      await transactionQuery(
        client,
        `INSERT INTO invoice_items
         (invoice_id, product_id, line_number, quantity, unit_price,
          subtotal, tax_amount, total, description,
          clave_sat, unit_code, tax_rate,
          tax_preset_id, ret_iva_rate, ret_isr_rate, ieps_rate,
          ret_iva_amount, ret_isr_amount, ieps_amount, is_exempt)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          invoice.id,
          item.productId,
          idx + 1,
          item.quantity,
          item.unitPrice,
          item.subtotal,
          item.taxAmount,
          item.total,
          item.description,
          item.claveSat,
          item.unitCode,
          item.taxRate,
          item.taxPresetId,
          item.retIvaRate,
          item.retIsrRate,
          item.iepsRate,
          item.retIvaAmount,
          item.retIsrAmount,
          item.iepsAmount,
          item.isExempt,
        ]
      );
    }

    // 8. Update customer balance
    await customersService.updateCustomerBalance(data.customerId);

    logger.info(`Invoice created: ${invoice.serie}-${invoice.folio} for customer ${customer.rfc}`);

    return {
      ...invoice,
      items: invoiceItems,
    };
  });
}

/**
 * Get invoice by ID
 */
export async function getInvoiceById(companyId: string, invoiceId: string): Promise<any> {
  const result = await query(
    `SELECT i.*, c.rfc as customer_rfc, c.business_name as customer_name
     FROM invoices i
     JOIN customers c ON i.customer_id = c.id
     WHERE i.id = $1 AND i.company_id = $2 AND i.deleted_at IS NULL`,
    [invoiceId, companyId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Invoice not found');
  }

  // Get items
  const itemsResult = await query(
    `SELECT * FROM invoice_items WHERE invoice_id = $1`,
    [invoiceId]
  );

  return {
    ...result.rows[0],
    items: itemsResult.rows,
  };
}

/**
 * List invoices with filters
 */
export async function listInvoices(
  companyId: string,
  options: {
    customerId?: string;
    status?: string;
    dateFrom?: Date;
    dateTo?: Date;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ invoices: any[]; total: number }> {
  const { customerId, status, dateFrom, dateTo, limit = 10, offset = 0 } = options;

  let whereClause = 'WHERE i.company_id = $1 AND i.deleted_at IS NULL';
  const params: any[] = [companyId];
  let paramCount = 2;

  if (customerId) {
    whereClause += ` AND i.customer_id = $${paramCount++}`;
    params.push(customerId);
  }

  if (status) {
    whereClause += ` AND i.status = $${paramCount++}`;
    params.push(status);
  }

  if (dateFrom) {
    whereClause += ` AND i.date_issued >= $${paramCount++}`;
    params.push(dateFrom);
  }

  if (dateTo) {
    whereClause += ` AND i.date_issued <= $${paramCount++}`;
    params.push(dateTo);
  }

  const invoicesResult = await query(
    // OJO: los subqueries de payments deben excluir document_status='CANCELLED'
    // — cuando se cancela un complemento, se marca (no se borra), así que
    // sin el filtro el saldo seguía descontando el monto del pago cancelado.
    `SELECT i.*,
            c.business_name as customer_name,
            c.rfc as customer_rfc,
            COALESCE((SELECT SUM(payment_amount) FROM payments
                       WHERE invoice_id = i.id AND deleted_at IS NULL
                         AND document_status != 'CANCELLED'), 0)::numeric AS paid_total,
            COALESCE((SELECT SUM(total) FROM credit_notes
                       WHERE invoice_id = i.id AND deleted_at IS NULL AND status != 'CANCELLED'), 0)::numeric AS credited_total,
            GREATEST(0, i.total
                      - COALESCE((SELECT SUM(payment_amount) FROM payments
                                   WHERE invoice_id = i.id AND deleted_at IS NULL
                                     AND document_status != 'CANCELLED'), 0)
                      - COALESCE((SELECT SUM(total) FROM credit_notes
                                   WHERE invoice_id = i.id AND deleted_at IS NULL AND status != 'CANCELLED'), 0)
                    )::numeric AS balance
     FROM invoices i
     JOIN customers c ON i.customer_id = c.id
     ${whereClause}
     ORDER BY i.date_issued DESC
     LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
    [...params, limit, offset]
  );

  const totalResult = await query(
    `SELECT COUNT(*) as count FROM invoices i ${whereClause}`,
    params
  );

  const total = parseInt(totalResult.rows[0].count, 10);

  return {
    invoices: invoicesResult.rows,
    total,
  };
}

/**
 * Update invoice (only DRAFT — timbradas y canceladas son inmutables).
 * Acepta el mismo payload que createInvoice: reemplaza customer, items,
 * totales y campos fiscales. Preserva folio, serie y fecha original.
 */
export async function updateInvoice(
  companyId: string,
  invoiceId: string,
  data: {
    customerId?: string;
    cfdiType?: 'I' | 'E' | 'T';
    paymentForm?: string;
    paymentMethod?: string;
    cfdiUse?: string;
    items?: InvoiceLineItem[];
    currency?: string;
    exchangeRate?: number;
    discount?: number;
    paymentTerms?: string;
    notes?: string;
  } & Partial<Invoice>
): Promise<any> {
  const existing = await getInvoiceById(companyId, invoiceId);

  if (existing.status !== 'DRAFT' || existing.is_stamped) {
    throw new ValidationError(
      'Solo se pueden editar facturas en estado DRAFT (no timbradas)'
    );
  }

  // Modo simple: solo tocar payment_form/payment_method/notes sin reemplazar
  // items. Se detecta cuando no vienen items en el payload — mantiene la
  // compatibilidad con clientes viejos del endpoint.
  const hasItems = Array.isArray(data.items) && data.items.length > 0;

  if (!hasItems) {
    const fields: string[] = [];
    const values: any[] = [];
    let p = 1;
    if (data.paymentForm || (data as any).payment_form) {
      fields.push(`payment_form = $${p++}`);
      values.push(data.paymentForm || (data as any).payment_form);
    }
    if (data.paymentMethod || (data as any).payment_method) {
      fields.push(`payment_method = $${p++}`);
      values.push(data.paymentMethod || (data as any).payment_method);
    }
    if (data.notes !== undefined) {
      fields.push(`notes = $${p++}`);
      values.push(data.notes);
    }
    if (fields.length === 0) return existing;
    fields.push(`updated_at = NOW()`);
    values.push(invoiceId);
    const r = await query(
      `UPDATE invoices SET ${fields.join(', ')} WHERE id = $${p} RETURNING *`,
      values
    );
    logger.info(`Invoice updated (light): ${invoiceId}`);
    return r.rows[0];
  }

  // Modo pleno: reemplazar customer, items y recalcular totales en TX.
  return transaction(async (client) => {
    const targetCustomerId = data.customerId || existing.customer_id;
    const customer = await customersService.getCustomerById(companyId, targetCustomerId);

    let subtotal = 0;
    let totIvaTraslado = 0;
    let totIvaRetenido = 0;
    let totIsrRetenido = 0;
    let totIeps = 0;
    const invoiceItems: any[] = [];

    for (const item of data.items!) {
      const product = await productsService.getProductById(companyId, item.productId);
      const preset  = resolveTaxPreset(item.taxPresetId, product);
      const unitPrice    = item.unitPrice || product.base_price || 0;
      const lineSubtotal = r2(item.quantity * unitPrice);
      const lineIvaTrasl = r2(lineSubtotal * preset.rateIva);
      const lineRetIva   = r2(lineSubtotal * preset.retIva);
      const lineRetIsr   = r2(lineSubtotal * preset.retIsr);
      const lineIeps     = r2(lineSubtotal * preset.iepsRate);
      const lineTotal    = r2(lineSubtotal + lineIvaTrasl + lineIeps - lineRetIva - lineRetIsr);

      invoiceItems.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        subtotal: lineSubtotal,
        taxAmount: lineIvaTrasl,
        total: lineTotal,
        claveSat: product.clave_sat,
        unitCode: product.unit_code,
        taxRate: preset.rateIva,
        description: ((item as any).description || product.name || '').toString().trim(),
        taxPresetId: preset.id,
        retIvaRate: preset.retIva,
        retIsrRate: preset.retIsr,
        iepsRate: preset.iepsRate,
        retIvaAmount: lineRetIva,
        retIsrAmount: lineRetIsr,
        iepsAmount: lineIeps,
        isExempt: preset.isExempt,
      });
      subtotal       += lineSubtotal;
      totIvaTraslado += lineIvaTrasl;
      totIvaRetenido += lineRetIva;
      totIsrRetenido += lineRetIsr;
      totIeps        += lineIeps;
    }

    if (invoiceItems.length === 0) {
      throw new ValidationError('La factura debe tener al menos un concepto');
    }

    const discount = data.discount ?? (Number(existing.discount) || 0);
    const totRetenido = r2(totIvaRetenido + totIsrRetenido);
    const total = r2(subtotal + totIvaTraslado + totIeps - totRetenido - discount);
    const totalTax = r2(totIvaTraslado);

    // Reemplazar la cabecera (sin tocar folio/serie/date_issued/status)
    await transactionQuery(
      client,
      `UPDATE invoices SET
         customer_id = $1,
         cfdi_type = $2,
         currency = $3,
         exchange_rate = $4,
         subtotal = $5,
         tax_transferred = $6,
         tax_retained = $7,
         tax_retained_iva = $8,
         tax_retained_isr = $9,
         tax_ieps = $10,
         total = $11,
         discount = $12,
         payment_form = $13,
         payment_method = $14,
         cfdi_use = $15,
         payment_terms = $16,
         notes = $17,
         updated_at = NOW()
       WHERE id = $18 AND company_id = $19`,
      [
        targetCustomerId,
        data.cfdiType || existing.cfdi_type || 'I',
        data.currency || existing.currency || 'MXN',
        data.exchangeRate ?? (Number(existing.exchange_rate) || 1),
        subtotal,
        totalTax,
        totRetenido,
        totIvaRetenido,
        totIsrRetenido,
        totIeps,
        total,
        discount,
        data.paymentForm || existing.payment_form,
        data.paymentMethod || existing.payment_method,
        data.cfdiUse || existing.cfdi_use,
        data.paymentTerms ?? existing.payment_terms,
        data.notes ?? existing.notes,
        invoiceId,
        companyId,
      ]
    );

    // Reemplazar items (delete + insert es simple y correcto para DRAFT)
    await transactionQuery(client, `DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);

    for (let idx = 0; idx < invoiceItems.length; idx++) {
      const it = invoiceItems[idx];
      await transactionQuery(
        client,
        `INSERT INTO invoice_items
         (invoice_id, product_id, line_number, quantity, unit_price,
          subtotal, tax_amount, total, description,
          clave_sat, unit_code, tax_rate,
          tax_preset_id, ret_iva_rate, ret_isr_rate, ieps_rate,
          ret_iva_amount, ret_isr_amount, ieps_amount, is_exempt)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          invoiceId,
          it.productId,
          idx + 1,
          it.quantity,
          it.unitPrice,
          it.subtotal,
          it.taxAmount,
          it.total,
          it.description,
          it.claveSat,
          it.unitCode,
          it.taxRate,
          it.taxPresetId,
          it.retIvaRate,
          it.retIsrRate,
          it.iepsRate,
          it.retIvaAmount,
          it.retIsrAmount,
          it.iepsAmount,
          it.isExempt,
        ]
      );
    }

    await customersService.updateCustomerBalance(targetCustomerId);

    logger.info(`Invoice updated (full): ${existing.serie}-${existing.folio}`);

    const updated = await transactionQuery(
      client,
      `SELECT * FROM invoices WHERE id = $1`,
      [invoiceId]
    );
    return { ...updated.rows[0], items: invoiceItems };
  });
}

/**
 * Delete invoice (soft delete, only DRAFT)
 */
export async function deleteInvoice(companyId: string, invoiceId: string): Promise<void> {
  const invoice = await getInvoiceById(companyId, invoiceId);

  if (invoice.status !== 'DRAFT') {
    throw new ValidationError('Can only delete invoices in DRAFT status');
  }

  await query(
    'UPDATE invoices SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1',
    [invoiceId]
  );

  // Update customer balance
  await customersService.updateCustomerBalance(invoice.customer_id);

  logger.info(`Invoice deleted: ${invoice.serie}-${invoice.folio}`);
}

/**
 * Change invoice status
 */
export async function changeInvoiceStatus(
  companyId: string,
  invoiceId: string,
  newStatus: string
): Promise<any> {
  const invoice = await getInvoiceById(companyId, invoiceId);

  // Validate status transition
  const validTransitions: { [key: string]: string[] } = {
    DRAFT: ['READY', 'CANCELLED'],
    READY: ['STAMPED', 'CANCELLED'],
    STAMPED: ['SENT', 'CANCELLED'],
    SENT: ['PAID', 'PARTIAL_PAYMENT'],
    PARTIAL_PAYMENT: ['PAID'],
    PAID: [],
    CANCELLED: [],
  };

  if (!validTransitions[invoice.status]?.includes(newStatus)) {
    throw new ValidationError(
      `Cannot transition from ${invoice.status} to ${newStatus}`
    );
  }

  const result = await query(
    `UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [newStatus, invoiceId]
  );

  logger.info(`Invoice status changed: ${invoice.serie}-${invoice.folio} → ${newStatus}`);

  return result.rows[0];
}

/**
 * Get invoice summary (totals, items, etc)
 */
export async function getInvoiceSummary(companyId: string, invoiceId: string): Promise<any> {
  const invoice = await getInvoiceById(companyId, invoiceId);

  return {
    folio: `${invoice.serie}-${invoice.folio}`,
    customer: {
      rfc: invoice.customer_rfc,
      name: invoice.customer_name,
    },
    dates: {
      issued: invoice.date_issued,
      expired: invoice.date_expired,
    },
    totals: {
      subtotal: invoice.subtotal,
      taxTransferred: invoice.tax_transferred,
      discount: invoice.discount,
      total: invoice.total,
    },
    payment: {
      form: invoice.payment_form,
      method: invoice.payment_method,
      terms: invoice.payment_terms,
    },
    status: invoice.status,
    items: invoice.items.map((item: any) => ({
      product: item.description,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      subtotal: item.subtotal,
      tax: item.tax_amount,
      total: item.total,
    })),
  };
}

/**
 * Get customer invoices
 */
export async function getCustomerInvoices(customerId: string): Promise<any[]> {
  const result = await query(
    `SELECT id, folio, serie, total, date_issued, status
     FROM invoices
     WHERE customer_id = $1 AND deleted_at IS NULL
     ORDER BY date_issued DESC`,
    [customerId]
  );

  return result.rows;
}

export default {
  createInvoice,
  getInvoiceById,
  listInvoices,
  updateInvoice,
  deleteInvoice,
  changeInvoiceStatus,
  getInvoiceSummary,
  getCustomerInvoices,
};
