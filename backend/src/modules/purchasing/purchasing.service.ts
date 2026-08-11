/**
 * Purchasing Service — órdenes de cotización/compra (Fase 4, §2 §3 ALMACEN.MD).
 *
 *  · runReorderCheck(): el análisis — detecta productos bajo mínimo o que
 *    llegarán al mínimo en ≤15 días (vista v_projected_stockout_15d) y genera
 *    UNA orden de cotización por almacén con cantidad y proveedor sugeridos.
 *    Anti-duplicado: un producto con orden ABIERTA no se vuelve a proponer.
 *  · receiveOrder(): recepción parcial o total → PURCHASE_IN vía
 *    applyMovementTx (regla de oro #4) referenciando la orden.
 *  · Transiciones de estado validadas; aprobar exige ADMIN/MANAGER (la ruta).
 */

import { PoolClient } from 'pg';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError, ConflictError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import { applyMovementTx } from '../inventory/inventory.service';

export type OrderStatus =
  | 'PENDING' | 'QUOTED' | 'APPROVED' | 'PURCHASED'
  | 'RECEIVED_PARTIAL' | 'RECEIVED' | 'CANCELLED';

/** Estados que cuentan como "orden abierta" para el anti-duplicado. */
const OPEN_STATUSES = ['PENDING', 'QUOTED', 'APPROVED', 'PURCHASED', 'RECEIVED_PARTIAL'];

/** Transiciones válidas del ciclo (§3). */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING:          ['QUOTED', 'APPROVED', 'CANCELLED'],
  QUOTED:           ['APPROVED', 'CANCELLED'],
  APPROVED:         ['PURCHASED', 'CANCELLED'],
  PURCHASED:        ['RECEIVED_PARTIAL', 'RECEIVED', 'CANCELLED'],
  RECEIVED_PARTIAL: ['RECEIVED', 'CANCELLED'],
  RECEIVED:         [],
  CANCELLED:        [],
};

async function nextFolio(client: PoolClient, companyId: string): Promise<number> {
  const r = await transactionQuery<{ next: number }>(
    client,
    `SELECT COALESCE(MAX(folio), 0) + 1 AS next FROM purchase_orders WHERE company_id = $1`,
    [companyId]
  );
  return Number(r.rows[0].next);
}

/* ─────────────────────  ANÁLISIS AUTOMÁTICO (§2)  ───────────────────── */

export interface ReorderResult {
  ordersCreated: Array<{
    orderId: string; folio: number; warehouseCode: string; items: number;
  }>;
  candidates: number;
  skippedWithOpenOrder: number;
}

/**
 * Analiza el inventario de UNA empresa y genera órdenes de cotización AUTO.
 * Una orden por almacén, con todos sus productos candidatos.
 */
export async function runReorderCheck(
  companyId: string,
  user?: { userId?: string; email?: string }
): Promise<ReorderResult> {
  return transaction(async (client) => {
    const candR = await transactionQuery<any>(
      client,
      `SELECT v.*, sp.supplier_id AS suggested_supplier_id, sp.last_price
         FROM v_projected_stockout_15d v
         LEFT JOIN LATERAL (
           SELECT supplier_id, last_price
             FROM supplier_products sp
            WHERE sp.product_id = v.product_id
            ORDER BY sp.is_primary DESC, sp.last_purchase_date DESC NULLS LAST
            LIMIT 1
         ) sp ON true
        WHERE v.company_id = $1 AND v.reorder_needed = true AND v.suggested_qty > 0`,
      [companyId]
    );

    let skipped = 0;
    const byWarehouse = new Map<string, any[]>();

    for (const c of candR.rows) {
      // Anti-duplicado: ¿ya hay una orden abierta con este producto en este almacén?
      const open = await transactionQuery(
        client,
        `SELECT 1
           FROM purchase_order_items poi
           JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE po.company_id = $1 AND po.warehouse_id = $2
            AND poi.product_id = $3 AND po.status = ANY($4)
          LIMIT 1`,
        [companyId, c.warehouse_id, c.product_id, OPEN_STATUSES]
      );
      if (open.rows.length > 0) { skipped++; continue; }

      if (!byWarehouse.has(c.warehouse_id)) byWarehouse.set(c.warehouse_id, []);
      byWarehouse.get(c.warehouse_id)!.push(c);
    }

    const ordersCreated: ReorderResult['ordersCreated'] = [];
    for (const [warehouseId, items] of byWarehouse) {
      const folio = await nextFolio(client, companyId);
      // Proveedor de la orden: el sugerido más frecuente entre los items
      const supplierCounts = new Map<string, number>();
      for (const it of items) {
        if (it.suggested_supplier_id) {
          supplierCounts.set(it.suggested_supplier_id,
            (supplierCounts.get(it.suggested_supplier_id) || 0) + 1);
        }
      }
      const topSupplier = [...supplierCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      const po = await transactionQuery<{ id: string }>(
        client,
        `INSERT INTO purchase_orders
           (company_id, folio, order_type, status, source, supplier_id, warehouse_id,
            needed_by_date, notes, created_by, created_by_email)
         VALUES ($1, $2, 'QUOTATION', 'PENDING', 'AUTO', $3, $4,
                 (NOW() + INTERVAL '15 days')::date,
                 'Generada por análisis de mínimos y proyección a 15 días', $5, $6)
         RETURNING id`,
        [companyId, folio, topSupplier, warehouseId,
         user?.userId || null, user?.email || 'reorder@system']
      );
      const orderId = po.rows[0].id;

      for (const it of items) {
        await transactionQuery(
          client,
          `INSERT INTO purchase_order_items
             (purchase_order_id, product_id, quantity_suggested, quantity_ordered,
              last_purchase_price, supplier_suggested_id)
           VALUES ($1, $2, $3, $3, $4, $5)`,
          [orderId, it.product_id, it.suggested_qty,
           it.last_price ?? null, it.suggested_supplier_id ?? null]
        );
      }

      ordersCreated.push({
        orderId, folio,
        warehouseCode: items[0].warehouse_code,
        items: items.length,
      });
    }

    return { ordersCreated, candidates: candR.rows.length, skippedWithOpenOrder: skipped };
  });
}

/** Análisis de TODAS las empresas activas + alerta por correo (cron diario). */
export async function runReorderCheckAllCompanies(): Promise<void> {
  const companies = await query<{ id: string; business_name: string; contact_email: string | null; email: string | null }>(
    `SELECT id, business_name, contact_email, email FROM companies
      WHERE deleted_at IS NULL AND is_active = true`
  );
  for (const c of companies.rows) {
    try {
      const r = await runReorderCheck(c.id);
      if (r.ordersCreated.length > 0) {
        logger.info(
          `[reorder] ${c.business_name}: ${r.ordersCreated.length} orden(es) de cotización generadas ` +
          `(${r.candidates} candidatos, ${r.skippedWithOpenOrder} ya con orden abierta)`
        );
        // Alerta por correo — best effort (§2: alerta preventiva)
        const to = c.contact_email || c.email;
        if (to) {
          try {
            const { sendPlainMail } = await import('../mailer/mailer.service');
            const lines = r.ordersCreated
              .map((o) => `· Orden de cotización #${o.folio} — almacén ${o.warehouseCode} — ${o.items} producto(s)`)
              .join('\n');
            await sendPlainMail({
              companyId: c.id,
              to,
              subject: `GDM ALMACÉN · ${r.ordersCreated.length} orden(es) de cotización por inventario bajo`,
              message:
                `El análisis diario detectó productos en o por debajo del mínimo ` +
                `(o que llegarán al mínimo en 15 días) y generó:\n\n${lines}\n\n` +
                `Revísalas en el módulo Órdenes de compra para cotizar y aprobar.`,
            });
          } catch (e) {
            logger.warn(`[reorder] Alerta email a ${to} falló: ${(e as Error).message}`);
          }
        }
      }
    } catch (e) {
      logger.error(`[reorder] Empresa ${c.id} falló: ${(e as Error).message}`);
    }
  }
}

/* ─────────────────────  CICLO DE ESTADOS (§3)  ───────────────────── */

export async function changeStatus(
  companyId: string,
  orderId: string,
  newStatus: OrderStatus,
  user: { userId?: string; email?: string }
): Promise<any> {
  return transaction(async (client) => {
    const r = await transactionQuery<any>(
      client,
      `SELECT id, status FROM purchase_orders
        WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [orderId, companyId]
    );
    if (r.rows.length === 0) throw new NotFoundError('Orden no encontrada');
    const current = r.rows[0].status as OrderStatus;

    if (!TRANSITIONS[current]?.includes(newStatus)) {
      throw new ConflictError(`Transición inválida: ${current} → ${newStatus}`);
    }
    // La recepción va por receiveOrder(), no por cambio de estado directo
    if (newStatus === 'RECEIVED' || newStatus === 'RECEIVED_PARTIAL') {
      throw new ValidationError('Usa el endpoint de recepción para registrar mercancía recibida');
    }

    const upd = await transactionQuery<any>(
      client,
      `UPDATE purchase_orders SET
          status = $1::varchar,
          order_type = CASE WHEN $1::varchar = 'APPROVED' THEN 'PURCHASE' ELSE order_type END,
          approved_by = CASE WHEN $1::varchar = 'APPROVED' THEN $2::uuid ELSE approved_by END,
          approved_at = CASE WHEN $1::varchar = 'APPROVED' THEN NOW() ELSE approved_at END
        WHERE id = $3
        RETURNING id, folio, status, order_type`,
      [newStatus, user.userId || null, orderId]
    );
    return upd.rows[0];
  });
}

/* ─────────────────────  PROVEEDOR DE LA ORDEN  ───────────────────── */

/**
 * Cambia el proveedor al que se le va a comprar.
 *
 * El análisis de mínimos propone UN proveedor —el del último precio de compra—
 * pero es apenas una sugerencia: el que surtió la vez pasada puede no tener
 * existencia, tardar tres semanas o haber subido el precio. Sin esta función,
 * la única salida era cancelar la orden y capturarla otra vez a mano.
 *
 * Se permite hasta RECEIVED_PARTIAL porque el cambio de proveedor a media
 * entrega ocurre —el primero surtió la mitad y el resto se le compra a otro—.
 * En una orden ya surtida o cancelada sí se bloquea: ahí el proveedor es parte
 * del historial y de la deuda que ya se generó.
 */
export async function setSupplier(
  companyId: string,
  orderId: string,
  supplierId: string | null
): Promise<any> {
  return transaction(async (client) => {
    const poR = await transactionQuery<any>(
      client,
      `SELECT id, folio, status FROM purchase_orders
        WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [orderId, companyId]
    );
    if (poR.rows.length === 0) throw new NotFoundError('Orden no encontrada');
    if (['RECEIVED', 'CANCELLED'].includes(poR.rows[0].status)) {
      throw new ConflictError(
        'La orden ya está cerrada — el proveedor no se puede cambiar.'
      );
    }

    if (supplierId) {
      const sup = await transactionQuery<any>(
        client,
        `SELECT id, business_name FROM customers
          WHERE id = $1 AND company_id = $2 AND party_type = 'SUPPLIER' AND deleted_at IS NULL`,
        [supplierId, companyId]
      );
      if (sup.rows.length === 0) throw new NotFoundError('Proveedor no encontrado');
    }

    const upd = await transactionQuery<any>(
      client,
      `UPDATE purchase_orders SET supplier_id = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, folio, supplier_id,
                  (SELECT business_name FROM customers WHERE id = $1) AS supplier_name`,
      [supplierId, orderId]
    );
    return upd.rows[0];
  });
}

/* ─────────────────────  RECEPCIÓN (§14 parcial)  ───────────────────── */

export interface DatosDeFactura {
  /** Folio de la factura del proveedor — obligatorio para generar la deuda. */
  invoiceNumber?: string;
  /** Total a pagar CON impuestos. Si no viene, se calcula de lo recibido. */
  invoiceAmount?: number;
  /** Fecha de la factura: de ahí cuentan los días de crédito. */
  invoiceDate?: string;
}

export async function receiveOrder(
  companyId: string,
  orderId: string,
  receipts: Array<{ itemId: string; quantity: number; unitCost?: number }>,
  user: { userId?: string; email?: string },
  /** Política de costos para esta recepción (pregunta al operador). */
  costingMethod?: 'PROMEDIO' | 'ULTIMO' | 'CAPAS',
  factura?: DatosDeFactura
): Promise<any> {
  if (!receipts?.length) throw new ValidationError('Indica qué items y cantidades recibes');

  return transaction(async (client) => {
    const poR = await transactionQuery<any>(
      client,
      `SELECT id, folio, status, warehouse_id, supplier_id FROM purchase_orders
        WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [orderId, companyId]
    );
    if (poR.rows.length === 0) throw new NotFoundError('Orden no encontrada');
    const po = poR.rows[0];
    if (!['PURCHASED', 'RECEIVED_PARTIAL', 'APPROVED'].includes(po.status)) {
      throw new ConflictError(
        `Solo se recibe mercancía de órdenes aprobadas/compradas (estado actual: ${po.status})`
      );
    }

    let received = 0;
    let costoRecibido = 0;
    const excedentes: Array<{ producto: string; pedido: number; recibido: number }> = [];

    for (const rec of receipts) {
      const qty = Number(rec.quantity);
      if (!qty || qty <= 0) continue;

      const itR = await transactionQuery<any>(
        client,
        `SELECT poi.id, poi.product_id, poi.quantity_ordered, poi.quantity_received,
                poi.last_purchase_price, p.name AS product_name
           FROM purchase_order_items poi
           JOIN products p ON p.id = poi.product_id
          WHERE poi.id = $1 AND poi.purchase_order_id = $2 FOR UPDATE OF poi`,
        [rec.itemId, orderId]
      );
      if (itR.rows.length === 0) throw new NotFoundError(`Item ${rec.itemId} no es de esta orden`);
      const it = itR.rows[0];

      /* Se admite recibir MÁS de lo pedido.
       *
       * Antes esto se rechazaba, y era un rechazo contra la realidad: el
       * proveedor manda la caja completa aunque se le hayan pedido 47 piezas,
       * o surte de más para no dejar el pedido abierto. La mercancía ya está
       * en el andén; negarse a registrarla no la devuelve — sólo obliga a
       * meterla por un ajuste manual, que es justo donde se pierde el rastro
       * de qué compra la trajo y a qué costo.
       *
       * El excedente no se esconde: se anota en el movimiento del kardex y se
       * devuelve al frente para que quien recibe lo vea y decida si lo acepta
       * o lo regresa. */
      const pending = Number(it.quantity_ordered) - Number(it.quantity_received);
      const deMas = qty - pending;
      if (deMas > 0.000001) {
        excedentes.push({
          producto: it.product_name,
          pedido: Number(it.quantity_ordered),
          recibido: Number(it.quantity_received) + qty,
        });
      }

      const unitCost = rec.unitCost != null ? Number(rec.unitCost)
                     : (it.last_purchase_price != null ? Number(it.last_purchase_price) : 0);
      costoRecibido += qty * unitCost;

      await applyMovementTx(client, {
        companyId,
        productId: it.product_id,
        movementType: 'PURCHASE_IN',
        quantity: qty,
        unitCost,
        warehouseToId: po.warehouse_id,
        referenceType: 'purchase_order',
        referenceId: orderId,
        reason: `Recepción orden de compra #${po.folio}` +
                (factura?.invoiceNumber ? ` · factura ${factura.invoiceNumber}` : '') +
                (deMas > 0.000001 ? ` · ${deMas} de más sobre lo pedido` : ''),
        userId: user.userId,
        userEmail: user.email,
        costingMethod,
      });

      await transactionQuery(
        client,
        `UPDATE purchase_order_items SET quantity_received = quantity_received + $1 WHERE id = $2`,
        [qty, rec.itemId]
      );
      received++;
    }
    if (received === 0) throw new ValidationError('Ninguna cantidad válida para recibir');

    // ¿Quedó completa?
    const pendR = await transactionQuery<{ pending: number }>(
      client,
      `SELECT COALESCE(SUM(quantity_ordered - quantity_received), 0) AS pending
         FROM purchase_order_items WHERE purchase_order_id = $1`,
      [orderId]
    );
    const stillPending = Number(pendR.rows[0].pending) > 0.000001;
    const newStatus = stillPending ? 'RECEIVED_PARTIAL' : 'RECEIVED';

    const upd = await transactionQuery<any>(
      client,
      `UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2
        RETURNING id, folio, status`,
      [newStatus, orderId]
    );

    /* ── La deuda con el proveedor ────────────────────────────────────────
     *
     * Recibir mercancía es contraer una deuda. Hasta hoy la recepción sólo
     * movía existencias y el pasivo aparecía —si aparecía— cuando alguien lo
     * capturaba a mano en tesorería. Aquí nace con la factura que trae el
     * repartidor, que es el momento en que realmente se sabe cuánto se debe.
     *
     * Requiere proveedor: una deuda sin acreedor no se le puede pagar a
     * nadie. Por eso el frente obliga a elegirlo antes de recibir. */
    let deuda: any = null;
    const folioFactura = String(factura?.invoiceNumber || '').trim().slice(0, 60);

    if (folioFactura) {
      if (!po.supplier_id) {
        throw new ValidationError(
          'Elige el proveedor de la orden antes de recibir: sin proveedor no se ' +
          'puede registrar la deuda en tesorería.'
        );
      }

      const yaExiste = await transactionQuery<any>(
        client,
        `SELECT id, amount, due_date FROM supplier_payments_schedule
          WHERE company_id = $1 AND supplier_id = $2
            AND UPPER(invoice_number) = UPPER($3) AND status <> 'CANCELLED'
          LIMIT 1`,
        [companyId, po.supplier_id, folioFactura]
      );

      if (yaExiste.rows[0]) {
        /* Segunda entrega amparada por la misma factura, o doble clic en
         * "Confirmar". La mercancía sí entró —eso ya se registró arriba—,
         * pero la deuda no se duplica. */
        deuda = {
          id: yaExiste.rows[0].id,
          amount: Number(yaExiste.rows[0].amount),
          dueDate: yaExiste.rows[0].due_date,
          yaExistia: true,
        };
      } else {
        /* El importe que se debe es el TOTAL de la factura, con impuestos: es
         * lo que se le va a transferir al proveedor. El costo de la mercancía
         * recibida sólo sirve de propuesta cuando no lo capturan. */
        const importe = factura?.invoiceAmount != null && Number(factura.invoiceAmount) > 0
          ? Number(factura.invoiceAmount)
          : costoRecibido;

        if (importe > 0) {
          const insR = await transactionQuery<any>(
            client,
            `INSERT INTO supplier_payments_schedule
               (company_id, supplier_id, purchase_order_id, invoice_number,
                amount, due_date, notes)
             SELECT $1, $2, $3, $4, $5,
                    (COALESCE($6::timestamp, NOW())
                      + make_interval(days => COALESCE(c.credit_days, 0)))::date,
                    $7
               FROM customers c WHERE c.id = $2
             RETURNING id, amount, due_date,
                       (SELECT COALESCE(credit_days, 0) FROM customers WHERE id = $2) AS credit_days`,
            [companyId, po.supplier_id, orderId, folioFactura, importe,
             factura?.invoiceDate || null,
             `Orden de compra #${po.folio} · factura ${folioFactura}`]
          );
          if (insR.rows[0]) {
            // Consume línea de crédito, igual que la compra por XML.
            await transactionQuery(
              client,
              `UPDATE customers SET credit_used = COALESCE(credit_used, 0) + $1 WHERE id = $2`,
              [importe, po.supplier_id]
            );
            deuda = {
              id: insR.rows[0].id,
              amount: Number(insR.rows[0].amount),
              dueDate: insR.rows[0].due_date,
              creditDays: Number(insR.rows[0].credit_days || 0),
              yaExistia: false,
            };
          }
        }
      }
    }

    logger.info(
      `[purchasing] orden #${po.folio}: ${received} partida(s) recibida(s)` +
      (folioFactura ? `, factura ${folioFactura}` : ', sin factura') +
      (deuda ? `, deuda ${deuda.yaExistia ? 'ya existente' : 'generada'} ${deuda.amount}` : '') +
      (excedentes.length ? `, ${excedentes.length} partida(s) con excedente` : '')
    );

    return {
      ...upd.rows[0],
      itemsReceived: received,
      stillPending,
      invoiceNumber: folioFactura || null,
      deuda,
      excedentes,
    };
  });
}
