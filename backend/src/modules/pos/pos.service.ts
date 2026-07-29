/**
 * POS Service — venta de mostrador + factura global diaria (Fase 5).
 *
 *  · createSale(): descuenta inventario AL MOMENTO (SALE_OUT por partida,
 *    misma transacción). Modo D3: si la empresa bloquea venta sin stock se
 *    rechaza; si no, se descuenta lo disponible y el faltante queda en kardex.
 *  · cancelSale(): devuelve el stock realmente descontado (CUSTOMER_RETURN).
 *  · closeDay(): las ventas OPEN del día se facturan en UNA factura global
 *    al público en general (RFC XAXX010101000, uso S01, un concepto por
 *    ticket con clave SAT 01010101) timbrada por el flujo CFDI normal.
 */

import { PoolClient } from 'pg';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError, ConflictError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import { applyMovementTx, getOrCreateDefaultWarehouse } from '../inventory/inventory.service';
import * as invoicesService from '../invoices/invoices.service';
import * as productsService from '../products/products.service';

const PUBLIC_RFC = 'XAXX010101000';
const GLOBAL_SKU = 'VENTA-GLOBAL';
const IVA_RATE = 0.16;

/**
 * Fecha de HOY en horario de México (YYYY-MM-DD).
 * Regla de oro #7 (lección GDM_FAC): jamás toISOString() para fechas de
 * negocio — el servidor puede estar en UTC y "hoy" se vuelve "mañana"
 * pasadas las 18:00. 'sv-SE' formatea como YYYY-MM-DD.
 */
export function todayMx(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
}

/* ─────────────────────  VENTA  ───────────────────── */

export interface PosSaleInput {
  warehouseId?: string;
  paymentForm?: string;          // c_FormaPago; default 01 efectivo
  items: Array<{ productId: string; quantity: number; unitPrice?: number }>;
}

export async function createSale(
  companyId: string,
  input: PosSaleInput,
  user: { userId?: string; email?: string }
): Promise<any> {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ValidationError('La venta necesita al menos un producto');
  }

  return transaction(async (client) => {
    const warehouseId = input.warehouseId
      || await getOrCreateDefaultWarehouse(client, companyId);

    // ¿La empresa bloquea venta sin stock? (D3)
    const blockR = await transactionQuery<{ inventory_block_no_stock: boolean }>(
      client, `SELECT inventory_block_no_stock FROM companies WHERE id = $1`, [companyId]
    );
    const blockNoStock = !!blockR.rows[0]?.inventory_block_no_stock;

    const folioR = await transactionQuery<{ next: number }>(
      client,
      `SELECT COALESCE(MAX(folio), 0) + 1 AS next FROM pos_sales WHERE company_id = $1`,
      [companyId]
    );
    const folio = Number(folioR.rows[0].next);

    // Resolver productos, precios y total
    let total = 0;
    const lines: Array<{ productId: string; quantity: number; unitPrice: number; lineTotal: number; sku: string; name: string; tracked: boolean }> = [];
    for (const it of input.items) {
      const qty = Number(it.quantity);
      if (!it.productId || !qty || qty <= 0) {
        throw new ValidationError('Cada partida requiere productId y quantity > 0');
      }
      const pR = await transactionQuery<any>(
        client,
        `SELECT p.id, p.sku, p.name, p.base_price,
                EXISTS (SELECT 1 FROM warehouse_stock ws WHERE ws.product_id = p.id) AS tracked
           FROM products p
          WHERE p.id = $1 AND p.company_id = $2 AND p.deleted_at IS NULL AND p.is_active = true`,
        [it.productId, companyId]
      );
      if (pR.rows.length === 0) throw new NotFoundError(`Producto ${it.productId} no encontrado`);
      const p = pR.rows[0];
      const unitPrice = it.unitPrice != null ? Number(it.unitPrice) : Number(p.base_price || 0);
      if (unitPrice < 0) throw new ValidationError(`Precio inválido en ${p.sku}`);
      const lineTotal = Math.round(unitPrice * qty * 100) / 100;
      total += lineTotal;
      lines.push({ productId: p.id, quantity: qty, unitPrice, lineTotal, sku: p.sku, name: p.name, tracked: p.tracked });
    }
    total = Math.round(total * 100) / 100;
    const subtotal = Math.round((total / (1 + IVA_RATE)) * 100) / 100;
    const tax = Math.round((total - subtotal) * 100) / 100;

    const saleR = await transactionQuery<any>(
      client,
      `INSERT INTO pos_sales
         (company_id, warehouse_id, folio, status, payment_form, subtotal, tax, total, user_id, user_email)
       VALUES ($1, $2, $3, 'OPEN', $4, $5, $6, $7, $8, $9)
       RETURNING id, folio, total, sold_at`,
      [companyId, warehouseId, folio, input.paymentForm || '01',
       subtotal, tax, total, user.userId || null, user.email || null]
    );
    const sale = saleR.rows[0];

    const warnings: string[] = [];
    for (const line of lines) {
      await transactionQuery(
        client,
        `INSERT INTO pos_sale_items (pos_sale_id, product_id, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5)`,
        [sale.id, line.productId, line.quantity, line.unitPrice, line.lineTotal]
      );

      // Solo los productos con control de inventario descuentan stock
      if (!line.tracked) continue;

      const stR = await transactionQuery<{ quantity: number }>(
        client,
        `SELECT quantity FROM warehouse_stock
          WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE`,
        [warehouseId, line.productId]
      );
      const available = Number(stR.rows[0]?.quantity ?? 0);

      if (blockNoStock && available < line.quantity) {
        throw new ConflictError(
          `Existencia insuficiente de ${line.sku} ${line.name}: disponible ${available}, ` +
          `pedido ${line.quantity} (la empresa bloquea venta sin stock)`
        );
      }
      const toDiscount = Math.min(available, line.quantity);
      const short = line.quantity - toDiscount;
      if (short > 0) {
        warnings.push(`${line.sku}: faltaron ${short} (disponible ${available})`);
      }
      if (toDiscount <= 0) continue;

      await applyMovementTx(client, {
        companyId,
        productId: line.productId,
        movementType: 'SALE_OUT',
        quantity: toDiscount,
        warehouseFromId: warehouseId,
        referenceType: 'pos_sale',
        referenceId: sale.id,
        reason: short > 0
          ? `Venta POS #${folio} (VENTA SIN EXISTENCIA SUFICIENTE: faltaron ${short})`
          : `Venta POS #${folio}`,
        userId: user.userId,
        userEmail: user.email,
      });
    }

    return { ...sale, warnings, items: lines.length };
  });
}

/* ─────────────────────  CANCELACIÓN  ───────────────────── */

export async function cancelSale(
  companyId: string,
  saleId: string,
  user: { userId?: string; email?: string }
): Promise<any> {
  return transaction(async (client) => {
    const r = await transactionQuery<any>(
      client,
      `SELECT id, folio, status FROM pos_sales
        WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [saleId, companyId]
    );
    if (r.rows.length === 0) throw new NotFoundError('Venta no encontrada');
    const sale = r.rows[0];
    if (sale.status === 'CANCELLED') throw new ConflictError('La venta ya está cancelada');
    if (sale.status === 'IN_GLOBAL') {
      throw new ConflictError(
        'La venta ya está incluida en la factura global del día — cancela mediante nota de crédito'
      );
    }

    // Devolver EXACTAMENTE lo descontado (guard anti-doble)
    const already = await transactionQuery(
      client,
      `SELECT 1 FROM inventory_movements
        WHERE reference_type = 'pos_sale_cancel' AND reference_id = $1 LIMIT 1`,
      [saleId]
    );
    if (already.rows.length === 0) {
      const sales = await transactionQuery<any>(
        client,
        `SELECT product_id, warehouse_from_id, SUM(quantity) AS quantity
           FROM inventory_movements
          WHERE reference_type = 'pos_sale' AND reference_id = $1 AND movement_type = 'SALE_OUT'
          GROUP BY product_id, warehouse_from_id`,
        [saleId]
      );
      for (const s of sales.rows) {
        await applyMovementTx(client, {
          companyId,
          productId: s.product_id,
          movementType: 'CUSTOMER_RETURN',
          quantity: Number(s.quantity),
          warehouseToId: s.warehouse_from_id,
          referenceType: 'pos_sale_cancel',
          referenceId: saleId,
          reason: `Cancelación de venta POS #${sale.folio}`,
          userId: user.userId,
          userEmail: user.email,
        });
      }
    }

    const upd = await transactionQuery<any>(
      client,
      `UPDATE pos_sales SET status = 'CANCELLED', cancelled_at = NOW()
        WHERE id = $1 RETURNING id, folio, status`,
      [saleId]
    );
    return upd.rows[0];
  });
}

/* ─────────────────────  CIERRE DEL DÍA · FACTURA GLOBAL  ───────────────────── */

/** Cliente "PÚBLICO EN GENERAL" de la empresa (upsert idempotente). */
async function getOrCreatePublicCustomer(client: PoolClient, companyId: string): Promise<string> {
  const r = await transactionQuery<{ id: string }>(
    client,
    `SELECT id FROM customers
      WHERE company_id = $1 AND rfc = $2`,
    [companyId, PUBLIC_RFC]
  );
  if (r.rows.length > 0) {
    // Reactivar por si estaba soft-deleted
    await transactionQuery(
      client,
      `UPDATE customers SET deleted_at = NULL, is_active = true WHERE id = $1`,
      [r.rows[0].id]
    );
    return r.rows[0].id;
  }
  const cpR = await transactionQuery<{ postal_code: string }>(
    client, `SELECT postal_code FROM companies WHERE id = $1`, [companyId]
  );
  const ins = await transactionQuery<{ id: string }>(
    client,
    `INSERT INTO customers
       (company_id, rfc, business_name, fiscal_regime, postal_code, party_type, is_active)
     VALUES ($1, $2, 'PUBLICO EN GENERAL', '616', $3, 'CUSTOMER', true)
     RETURNING id`,
    [companyId, PUBLIC_RFC, cpR.rows[0]?.postal_code || '00000']
  );
  return ins.rows[0].id;
}

/** Producto genérico para los conceptos de la global (sin control de stock). */
async function getOrCreateGlobalProduct(companyId: string): Promise<string> {
  const r = await query<{ id: string }>(
    `SELECT id FROM products
      WHERE company_id = $1 AND sku = $2 AND deleted_at IS NULL`,
    [companyId, GLOBAL_SKU]
  );
  if (r.rows.length > 0) return r.rows[0].id;
  const created = await productsService.createProduct(companyId, {
    sku: GLOBAL_SKU,
    name: 'VENTA MOSTRADOR (FACTURA GLOBAL)',
    claveSat: '01010101',        // "No existe en el catálogo" — estándar para globales
    unitCode: 'ACT',             // Actividad
    basePrice: 0,
    taxType: 'IVA',
    taxRate: IVA_RATE,
    taxPresetId: 'iva16',
  } as any);
  return created.id;
}

export interface CloseDayResult {
  invoiceId: string | null;
  folio?: string;
  salesIncluded: number;
  totalInvoiced: number;
  stamped: boolean;
  message: string;
}

/**
 * Cierre del día: factura global de las ventas OPEN de la fecha dada
 * (default hoy). Un concepto por ticket. Idempotente: las ventas quedan
 * IN_GLOBAL y no vuelven a facturarse.
 */
export async function closeDay(
  companyId: string,
  dateStr?: string,
  user?: { userId?: string; email?: string }
): Promise<CloseDayResult> {
  const day = dateStr || todayMx();

  // 1) Ventas OPEN del día (fuera de TX: la creación de factura usa su propio flujo)
  const salesR = await query<any>(
    `SELECT id, folio, total FROM pos_sales
      WHERE company_id = $1 AND status = 'OPEN' AND sold_at::date = $2::date
      ORDER BY folio`,
    [companyId, day]
  );
  if (salesR.rows.length === 0) {
    return {
      invoiceId: null, salesIncluded: 0, totalInvoiced: 0, stamped: false,
      message: `Sin ventas abiertas el ${day} — nada que facturar.`,
    };
  }

  // 2) Cliente público general + producto global
  const publicCustomerId = await transaction((client) =>
    getOrCreatePublicCustomer(client, companyId)
  );
  const globalProductId = await getOrCreateGlobalProduct(companyId);

  // 3) Factura: un concepto por ticket (precio pre-IVA; el preset iva16 lo
  //    vuelve a desglosar — diferencias de centavos por redondeo se asumen
  //    en esta etapa MOCK y se calibrarán con el PAC real)
  const items = salesR.rows.map((s: any) => ({
    productId: globalProductId,
    quantity: 1,
    unitPrice: Math.round((Number(s.total) / (1 + IVA_RATE)) * 100) / 100,
    description: `Venta POS #${s.folio} del ${day}`,
  }));

  const invoice = await invoicesService.createInvoice(companyId, {
    customerId: publicCustomerId,
    cfdiType: 'I',
    paymentForm: '01',
    paymentMethod: 'PUE',
    cfdiUse: 'S01',               // Sin efectos fiscales — estándar para global
    items,
    notes: `Factura global del día ${day} — ${salesR.rows.length} venta(s) de mostrador`,
  } as any);

  // 4) Timbrar por el flujo normal (MOCK/SW según env). El producto global no
  //    tiene control de stock → el hook de inventario lo ignora (el stock ya
  //    se descontó al momento de cada venta POS).
  let stamped = false;
  try {
    const pac = await import('../pac/pac.service');
    await pac.stampInvoice(companyId, invoice.id);
    stamped = true;
  } catch (e) {
    logger.error(`[pos] Factura global creada pero el timbrado falló: ${(e as Error).message}`);
  }

  // 5) Marcar ventas como IN_GLOBAL
  await query(
    `UPDATE pos_sales SET status = 'IN_GLOBAL', global_invoice_id = $1
      WHERE id = ANY($2::uuid[])`,
    [invoice.id, salesR.rows.map((s: any) => s.id)]
  );

  const totalInvoiced = salesR.rows.reduce((a: number, s: any) => a + Number(s.total), 0);
  logger.info(
    `[pos] Cierre ${day}: factura global ${invoice.serie || ''}-${invoice.folio} ` +
    `con ${salesR.rows.length} ventas por $${totalInvoiced.toFixed(2)} (stamped=${stamped})`
  );

  return {
    invoiceId: invoice.id,
    folio: `${invoice.serie || ''}-${invoice.folio}`,
    salesIncluded: salesR.rows.length,
    totalInvoiced: Math.round(totalInvoiced * 100) / 100,
    stamped,
    message: `Factura global generada con ${salesR.rows.length} venta(s).`,
  };
}

/** Cierre para todas las empresas activas (cron 23:55). */
export async function closeDayAllCompanies(): Promise<void> {
  const companies = await query<{ id: string; business_name: string }>(
    `SELECT id, business_name FROM companies WHERE deleted_at IS NULL AND is_active = true`
  );
  for (const c of companies.rows) {
    try {
      const r = await closeDay(c.id);
      if (r.salesIncluded > 0) {
        logger.info(`[pos-cron] ${c.business_name}: global ${r.folio} (${r.salesIncluded} ventas)`);
      }
    } catch (e) {
      logger.error(`[pos-cron] ${c.business_name} falló: ${(e as Error).message}`);
    }
  }
}
