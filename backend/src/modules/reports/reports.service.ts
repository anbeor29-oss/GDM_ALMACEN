/**
 * Reports Service
 * Business intelligence: cobranza, ventas, fiscal
 */

import { query } from '../../config/database';
import logger from '../../middleware/logger';

interface DateRange {
  dateFrom?: Date;
  dateTo?: Date;
}

/**
 * REPORTE DE COBRANZA (Accounts Receivable)
 * Saldos pendientes de clientes, antigüedad de saldos
 */
export async function getCollectionsReport(companyId: string): Promise<any> {
  // Saldos por cliente
  const customersResult = await query(
    `SELECT
       c.id, c.rfc, c.business_name, c.credit_limit, c.balance,
       c.credit_days, c.last_invoice_date,
       COUNT(i.id) FILTER (WHERE i.status NOT IN ('PAID', 'CANCELLED', 'DRAFT')) as pending_invoices,
       COALESCE(SUM(i.total) FILTER (WHERE i.status NOT IN ('PAID', 'CANCELLED', 'DRAFT')), 0) as pending_amount
     FROM customers c
     LEFT JOIN invoices i ON i.customer_id = c.id AND i.deleted_at IS NULL
     WHERE c.company_id = $1 AND c.deleted_at IS NULL
     GROUP BY c.id
     HAVING COALESCE(SUM(i.total) FILTER (WHERE i.status NOT IN ('PAID', 'CANCELLED', 'DRAFT')), 0) > 0
     ORDER BY pending_amount DESC`,
    [companyId]
  );

  // Antigüedad de saldos (aging)
  const agingResult = await query(
    `SELECT
       CASE
         WHEN NOW() - i.date_issued <= INTERVAL '30 days' THEN '0-30'
         WHEN NOW() - i.date_issued <= INTERVAL '60 days' THEN '31-60'
         WHEN NOW() - i.date_issued <= INTERVAL '90 days' THEN '61-90'
         ELSE '90+'
       END as bucket,
       COUNT(*) as invoice_count,
       COALESCE(SUM(i.total), 0) as amount
     FROM invoices i
     WHERE i.company_id = $1
       AND i.status NOT IN ('PAID', 'CANCELLED', 'DRAFT')
       AND i.deleted_at IS NULL
     GROUP BY bucket
     ORDER BY bucket`,
    [companyId]
  );

  const totalPending = customersResult.rows.reduce(
    (sum, row) => sum + parseFloat(row.pending_amount),
    0
  );

  return {
    total_pending: totalPending,
    customers_with_balance: customersResult.rows.length,
    customers: customersResult.rows,
    aging: agingResult.rows,
  };
}

/**
 * REPORTE DE VENTAS (Sales Report)
 * Ventas por periodo, top clientes, top productos
 */
export async function getSalesReport(companyId: string, range: DateRange = {}): Promise<any> {
  const params: any[] = [companyId];
  let dateFilter = '';
  let paramCount = 2;

  if (range.dateFrom) {
    dateFilter += ` AND i.date_issued >= $${paramCount++}`;
    params.push(range.dateFrom);
  }
  if (range.dateTo) {
    dateFilter += ` AND i.date_issued <= $${paramCount++}`;
    params.push(range.dateTo);
  }

  // Resumen general
  const summaryResult = await query(
    `SELECT
       COUNT(*) as total_invoices,
       COALESCE(SUM(subtotal), 0) as total_subtotal,
       COALESCE(SUM(tax_transferred), 0) as total_tax,
       COALESCE(SUM(total), 0) as total_amount,
       COALESCE(AVG(total), 0) as average_invoice
     FROM invoices i
     WHERE i.company_id = $1
       AND i.status NOT IN ('CANCELLED', 'DRAFT')
       AND i.deleted_at IS NULL
       ${dateFilter}`,
    params
  );

  // Ventas por mes
  const monthlyResult = await query(
    `SELECT
       TO_CHAR(date_issued, 'YYYY-MM') as month,
       COUNT(*) as invoice_count,
       COALESCE(SUM(total), 0) as amount
     FROM invoices i
     WHERE i.company_id = $1
       AND i.status NOT IN ('CANCELLED', 'DRAFT')
       AND i.deleted_at IS NULL
       ${dateFilter}
     GROUP BY month
     ORDER BY month DESC
     LIMIT 12`,
    params
  );

  // Top clientes
  const topCustomersResult = await query(
    `SELECT
       c.rfc, c.business_name,
       COUNT(i.id) as invoice_count,
       COALESCE(SUM(i.total), 0) as total_amount
     FROM invoices i
     JOIN customers c ON i.customer_id = c.id
     WHERE i.company_id = $1
       AND i.status NOT IN ('CANCELLED', 'DRAFT')
       AND i.deleted_at IS NULL
       ${dateFilter}
     GROUP BY c.id, c.rfc, c.business_name
     ORDER BY total_amount DESC
     LIMIT 10`,
    params
  );

  // Top productos (desde invoice_items)
  const topProductsResult = await query(
    `SELECT
       ii.description, ii.clave_sat,
       SUM(ii.quantity) as total_quantity,
       COALESCE(SUM(ii.total), 0) as total_amount
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.company_id = $1
       AND i.status NOT IN ('CANCELLED', 'DRAFT')
       AND i.deleted_at IS NULL
       ${dateFilter}
     GROUP BY ii.description, ii.clave_sat
     ORDER BY total_amount DESC
     LIMIT 10`,
    params
  );

  return {
    summary: summaryResult.rows[0],
    monthly: monthlyResult.rows,
    top_customers: topCustomersResult.rows,
    top_products: topProductsResult.rows,
  };
}

/**
 * REPORTE FISCAL (Tax Report)
 * IVA trasladado, retenido, por periodo
 */
export async function getTaxReport(companyId: string, range: DateRange = {}): Promise<any> {
  const params: any[] = [companyId];
  let dateFilter = '';
  let paramCount = 2;

  if (range.dateFrom) {
    dateFilter += ` AND i.date_issued >= $${paramCount++}`;
    params.push(range.dateFrom);
  }
  if (range.dateTo) {
    dateFilter += ` AND i.date_issued <= $${paramCount++}`;
    params.push(range.dateTo);
  }

  // Resumen de impuestos
  const taxSummary = await query(
    `SELECT
       COALESCE(SUM(subtotal), 0) as base_gravable,
       COALESCE(SUM(tax_transferred), 0) as iva_trasladado,
       COALESCE(SUM(tax_retained), 0) as iva_retenido,
       COALESCE(SUM(tax_ieps), 0) as ieps,
       COUNT(*) as invoice_count
     FROM invoices i
     WHERE i.company_id = $1
       AND i.status NOT IN ('CANCELLED', 'DRAFT')
       AND i.deleted_at IS NULL
       ${dateFilter}`,
    params
  );

  // Desglose mensual de impuestos
  const monthlyTax = await query(
    `SELECT
       TO_CHAR(date_issued, 'YYYY-MM') as month,
       COALESCE(SUM(subtotal), 0) as base,
       COALESCE(SUM(tax_transferred), 0) as iva_trasladado,
       COALESCE(SUM(tax_retained), 0) as iva_retenido
     FROM invoices i
     WHERE i.company_id = $1
       AND i.status NOT IN ('CANCELLED', 'DRAFT')
       AND i.deleted_at IS NULL
       ${dateFilter}
     GROUP BY month
     ORDER BY month DESC
     LIMIT 12`,
    params
  );

  return {
    summary: taxSummary.rows[0],
    monthly: monthlyTax.rows,
  };
}

/**
 * REPORTE DE ESTADOS (Status Report)
 * Facturas por estado
 */
export async function getStatusReport(companyId: string): Promise<any> {
  const result = await query(
    `SELECT
       status,
       COUNT(*) as count,
       COALESCE(SUM(total), 0) as amount
     FROM invoices i
     WHERE i.company_id = $1 AND i.deleted_at IS NULL
     GROUP BY status
     ORDER BY count DESC`,
    [companyId]
  );

  const total = result.rows.reduce((sum, row) => sum + parseInt(row.count, 10), 0);

  return {
    total_invoices: total,
    by_status: result.rows,
  };
}

/**
 * DASHBOARD METRICS
 * Métricas resumidas para el dashboard
 */
export async function getDashboardMetrics(companyId: string): Promise<any> {
  const result = await query(
    `SELECT
       (SELECT COUNT(*) FROM invoices WHERE company_id = $1 AND deleted_at IS NULL) as total_invoices,
       (SELECT COUNT(*) FROM customers WHERE company_id = $1 AND deleted_at IS NULL) as total_customers,
       (SELECT COUNT(*) FROM products WHERE company_id = $1 AND deleted_at IS NULL) as total_products,
       (SELECT COALESCE(SUM(total), 0) FROM invoices
        WHERE company_id = $1 AND status NOT IN ('CANCELLED', 'DRAFT') AND deleted_at IS NULL) as total_revenue,
       (SELECT COALESCE(SUM(total), 0) FROM invoices
        WHERE company_id = $1 AND status NOT IN ('PAID', 'CANCELLED') AND deleted_at IS NULL) as pending_revenue,
       (SELECT COUNT(*) FROM invoices
        WHERE company_id = $1 AND date_issued >= NOW() - INTERVAL '30 days' AND deleted_at IS NULL) as invoices_last_30d`,
    [companyId]
  );

  logger.info(`Dashboard metrics generated for company ${companyId}`);

  return result.rows[0];
}

/**
 * REPORTE DE COBRANZA DETALLADO — facturas por cliente con saldo pendiente.
 *
 * Umbral SAT: si el saldo residual es ≤ 0.20 (veinte centavos) lo consideramos
 * "cobrado" — es ruido por redondeo de IVA, no cobranza real.
 *
 * Regla de saldo:
 *    saldo = total_facturado − pagado − acreditado(NC)
 * Solo se listan las facturas con saldo > 0.20.
 *
 * @param customerId  Si viene, filtra a un solo cliente.
 */
export async function getReceivablesReport(
  companyId: string,
  customerId?: string
): Promise<{
  filter_customer_id: string | null;
  threshold: number;
  totals: { invoiced: number; paid: number; credited: number; balance: number; invoice_count: number };
  customers: Array<{
    id: string; rfc: string; business_name: string;
    invoice_count: number; invoiced: number; paid: number; credited: number; balance: number;
    invoices: Array<{
      id: string; serie: string | null; folio: number; cfdi_uuid: string | null;
      date_issued: string; status: string;
      total: number; paid: number; credited: number; balance: number;
      payments: Array<{ id: string; date: string; amount: number; folio: string | null }>;
      credit_notes: Array<{ id: string; date: string; total: number; folio: string | null }>;
    }>;
  }>;
}> {
  const THRESHOLD = 0.20;
  const params: any[] = [companyId];
  let custClause = '';
  if (customerId) {
    params.push(customerId);
    custClause = `AND i.customer_id = $${params.length}`;
  }

  // Facturas con saldo > threshold, agrupadas por cliente.
  const invsR = await query<any>(
    `SELECT
       i.id, i.serie, i.folio, i.cfdi_uuid, i.date_issued, i.status,
       i.total::numeric AS total,
       c.id AS customer_id, c.rfc, c.business_name,
       COALESCE((SELECT SUM(payment_amount) FROM payments p
                  WHERE p.invoice_id = i.id AND p.deleted_at IS NULL
                    AND p.document_status != 'CANCELLED'), 0)::numeric AS paid,
       COALESCE((SELECT SUM(total) FROM credit_notes cn
                  WHERE cn.invoice_id = i.id AND cn.deleted_at IS NULL
                    AND cn.status != 'CANCELLED'), 0)::numeric AS credited
     FROM invoices i
     JOIN customers c ON c.id = i.customer_id
     WHERE i.company_id = $1
       AND i.status NOT IN ('CANCELLED', 'DRAFT')
       AND i.deleted_at IS NULL
       ${custClause}
     ORDER BY c.business_name, i.date_issued`,
    params
  );

  // Filtro por saldo > threshold en memoria (respetamos el redondeo a 2 decimales).
  const rows = invsR.rows
    .map((r) => {
      const total = Number(r.total);
      const paid = Number(r.paid);
      const credited = Number(r.credited);
      const balance = Math.round((total - paid - credited) * 100) / 100;
      return { ...r, total, paid, credited, balance };
    })
    .filter((r) => r.balance > THRESHOLD);

  if (rows.length === 0) {
    return {
      filter_customer_id: customerId ?? null,
      threshold: THRESHOLD,
      totals: { invoiced: 0, paid: 0, credited: 0, balance: 0, invoice_count: 0 },
      customers: [],
    };
  }

  const invoiceIds = rows.map((r) => r.id);
  // Batch de pagos y NC por invoice_id (para no hacer N+1).
  const paysR = await query<any>(
    `SELECT invoice_id, id, payment_date, payment_amount, folio, serie
       FROM payments
      WHERE invoice_id = ANY($1::uuid[]) AND deleted_at IS NULL
      ORDER BY payment_date`,
    [invoiceIds]
  );
  const ncR = await query<any>(
    `SELECT invoice_id, id, date_issued, total, folio, serie
       FROM credit_notes
      WHERE invoice_id = ANY($1::uuid[]) AND deleted_at IS NULL
        AND status != 'CANCELLED'
      ORDER BY date_issued`,
    [invoiceIds]
  );

  const paysByInv = new Map<string, any[]>();
  for (const p of paysR.rows) {
    if (!paysByInv.has(p.invoice_id)) paysByInv.set(p.invoice_id, []);
    paysByInv.get(p.invoice_id)!.push({
      id: p.id,
      date: p.payment_date,
      amount: Number(p.payment_amount),
      folio: p.serie ? `${p.serie}-${p.folio}` : String(p.folio ?? ''),
    });
  }
  const ncByInv = new Map<string, any[]>();
  for (const n of ncR.rows) {
    if (!ncByInv.has(n.invoice_id)) ncByInv.set(n.invoice_id, []);
    ncByInv.get(n.invoice_id)!.push({
      id: n.id,
      date: n.date_issued,
      total: Number(n.total),
      folio: n.serie ? `${n.serie}-${n.folio}` : String(n.folio ?? ''),
    });
  }

  // Agrupamos por cliente.
  const byCust = new Map<string, any>();
  for (const r of rows) {
    if (!byCust.has(r.customer_id)) {
      byCust.set(r.customer_id, {
        id: r.customer_id,
        rfc: r.rfc,
        business_name: r.business_name,
        invoice_count: 0,
        invoiced: 0, paid: 0, credited: 0, balance: 0,
        invoices: [] as any[],
      });
    }
    const g = byCust.get(r.customer_id)!;
    g.invoice_count++;
    g.invoiced += r.total;
    g.paid += r.paid;
    g.credited += r.credited;
    g.balance += r.balance;
    g.invoices.push({
      id: r.id,
      serie: r.serie,
      folio: r.folio,
      cfdi_uuid: r.cfdi_uuid,
      date_issued: r.date_issued,
      status: r.status,
      total: r.total,
      paid: r.paid,
      credited: r.credited,
      balance: r.balance,
      payments: paysByInv.get(r.id) || [],
      credit_notes: ncByInv.get(r.id) || [],
    });
  }
  const customers = Array.from(byCust.values()).sort((a, b) => b.balance - a.balance);

  const totals = customers.reduce(
    (acc, c) => ({
      invoiced: acc.invoiced + c.invoiced,
      paid: acc.paid + c.paid,
      credited: acc.credited + c.credited,
      balance: acc.balance + c.balance,
      invoice_count: acc.invoice_count + c.invoice_count,
    }),
    { invoiced: 0, paid: 0, credited: 0, balance: 0, invoice_count: 0 }
  );

  return {
    filter_customer_id: customerId ?? null,
    threshold: THRESHOLD,
    totals,
    customers,
  };
}

export default {
  getCollectionsReport,
  getSalesReport,
  getTaxReport,
  getStatusReport,
  getDashboardMetrics,
  getReceivablesReport,
};
