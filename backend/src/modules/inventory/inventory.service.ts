/**
 * Inventory Service — núcleo del multialmacén (Fase 1 ALMACEN).
 *
 *  REGLA DE ORO #4 (README ALMACEN): applyMovement() es el ÚNICO código del
 *  sistema autorizado a escribir warehouse_stock. Ningún módulo debe hacer
 *  `UPDATE warehouse_stock` por su cuenta — ventas, compras XML, traspasos,
 *  ajustes y conteos físicos pasan todos por aquí.
 *
 *  Garantías:
 *   · Concurrencia: SELECT ... FOR UPDATE sobre el renglón de stock (§8)
 *   · Stock nunca negativo (CHECK en BD + validación con mensaje claro)
 *   · Costo promedio ponderado en entradas (§14)
 *   · Kardex inmutable: cada movimiento queda en inventory_movements (§10)
 *   · Multi-tenant: valida que producto y almacén pertenezcan a la empresa
 */

import { PoolClient } from 'pg';
import { transaction, transactionQuery } from '../../config/database';
import { ValidationError, ConflictError, NotFoundError } from '../../middleware/errorHandler';

export type MovementType =
  | 'PURCHASE_IN'
  | 'SALE_OUT'
  | 'CUSTOMER_RETURN'
  | 'SUPPLIER_RETURN'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'SHRINKAGE'
  | 'THEFT'
  | 'DAMAGED'
  | 'INITIAL';

/** Tipos que AUMENTAN existencia (requieren warehouseToId) */
const IN_TYPES: MovementType[] = ['PURCHASE_IN', 'CUSTOMER_RETURN', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'INITIAL'];
/** Tipos que DISMINUYEN existencia (requieren warehouseFromId) */
const OUT_TYPES: MovementType[] = ['SALE_OUT', 'SUPPLIER_RETURN', 'TRANSFER_OUT', 'ADJUSTMENT_OUT', 'SHRINKAGE', 'THEFT', 'DAMAGED'];

/** Política de costos (requerimiento del usuario — ver migración zz_inventory_costing):
 *  PROMEDIO = prorratear (ponderado) · ULTIMO = revaluar todo al costo nuevo ·
 *  CAPAS = respetar precios (existente a X, nuevo a Z, salidas FIFO). */
export type CostingMethod = 'PROMEDIO' | 'ULTIMO' | 'CAPAS';

export interface MovementInput {
  companyId: string;
  productId: string;
  movementType: MovementType;
  /** Siempre positiva; la dirección la da movementType */
  quantity: number;
  /** Costo unitario — obligatorio en PURCHASE_IN/INITIAL, opcional en el resto */
  unitCost?: number;
  warehouseFromId?: string;
  warehouseToId?: string;
  referenceType?: string;
  referenceId?: string;
  transferGroup?: string;
  reason?: string;
  userId?: string;
  userEmail?: string;
  /** Override de la política de costos de la empresa para ESTA operación
   *  (el selector con el que el sistema pregunta al operador). */
  costingMethod?: CostingMethod;
}

export interface MovementResult {
  movementId: string;
  productId: string;
  warehouseId: string;
  newQuantity: number;
  avgCost: number;
  /** Costo unitario efectivo del movimiento (en CAPAS, el de las capas consumidas). */
  appliedUnitCost: number | null;
  /** Política con la que se aplicó. */
  costingMethod: CostingMethod;
}

/** Política efectiva: override de la operación > configuración de la empresa. */
async function resolveCostingMethod(
  client: PoolClient,
  companyId: string,
  override?: CostingMethod
): Promise<CostingMethod> {
  if (override && ['PROMEDIO', 'ULTIMO', 'CAPAS'].includes(override)) return override;
  const r = await transactionQuery<{ inventory_costing_method: CostingMethod }>(
    client,
    `SELECT inventory_costing_method FROM companies WHERE id = $1`,
    [companyId]
  );
  return r.rows[0]?.inventory_costing_method || 'PROMEDIO';
}

/**
 * CAPAS · baseline: si el producto ya tenía existencia ANTES de operar con
 * capas (o entradas hechas bajo otra política), esa existencia se convierte
 * en la capa más antigua al costo promedio vigente — "lo existente a precio X".
 */
async function ensureLayerBaseline(
  client: PoolClient,
  companyId: string,
  warehouseId: string,
  productId: string,
  currentQty: number,
  currentAvg: number
): Promise<void> {
  const r = await transactionQuery<{ total: number }>(
    client,
    `SELECT COALESCE(SUM(quantity_remaining), 0) AS total
       FROM stock_cost_layers
      WHERE warehouse_id = $1 AND product_id = $2`,
    [warehouseId, productId]
  );
  const layered = Number(r.rows[0].total);
  const gap = currentQty - layered;
  if (gap > 0.000001) {
    await transactionQuery(
      client,
      `INSERT INTO stock_cost_layers
         (company_id, warehouse_id, product_id, quantity_remaining, unit_cost, received_at)
       VALUES ($1, $2, $3, $4, $5, '1970-01-01')`,
      [companyId, warehouseId, productId, gap, currentAvg]
    );
  }
}

/** CAPAS · consumir FIFO. Devuelve el costo unitario ponderado de lo consumido. */
async function consumeLayersFIFO(
  client: PoolClient,
  warehouseId: string,
  productId: string,
  quantity: number
): Promise<number> {
  let remaining = quantity;
  let costAccum = 0;
  const layers = await transactionQuery<any>(
    client,
    `SELECT id, quantity_remaining, unit_cost
       FROM stock_cost_layers
      WHERE warehouse_id = $1 AND product_id = $2 AND quantity_remaining > 0
      ORDER BY received_at ASC, id ASC
      FOR UPDATE`,
    [warehouseId, productId]
  );
  for (const layer of layers.rows) {
    if (remaining <= 0.000001) break;
    const take = Math.min(Number(layer.quantity_remaining), remaining);
    await transactionQuery(
      client,
      `UPDATE stock_cost_layers SET quantity_remaining = quantity_remaining - $1 WHERE id = $2`,
      [take, layer.id]
    );
    costAccum += take * Number(layer.unit_cost);
    remaining -= take;
  }
  const consumed = quantity - remaining;
  return consumed > 0 ? costAccum / consumed : 0;
}

/** CAPAS · costo promedio de las capas restantes (para valuación/vistas). */
async function remainingLayersAvg(
  client: PoolClient,
  warehouseId: string,
  productId: string,
  fallback: number
): Promise<number> {
  const r = await transactionQuery<{ qty: number; value: number }>(
    client,
    `SELECT COALESCE(SUM(quantity_remaining), 0) AS qty,
            COALESCE(SUM(quantity_remaining * unit_cost), 0) AS value
       FROM stock_cost_layers
      WHERE warehouse_id = $1 AND product_id = $2`,
    [warehouseId, productId]
  );
  const qty = Number(r.rows[0].qty);
  return qty > 0.000001 ? Number(r.rows[0].value) / qty : fallback;
}

/**
 * Aplica UN movimiento de inventario dentro de una transacción existente.
 * Para operaciones sueltas usa applyMovement(); los flujos multi-movimiento
 * (traspasos, facturas con N partidas) comparten `client`.
 */
export async function applyMovementTx(
  client: PoolClient,
  input: MovementInput
): Promise<MovementResult> {
  const {
    companyId, productId, movementType, quantity,
    unitCost, warehouseFromId, warehouseToId,
    referenceType, referenceId, transferGroup, reason, userId, userEmail,
  } = input;

  if (!quantity || quantity <= 0) {
    throw new ValidationError('La cantidad del movimiento debe ser mayor a cero');
  }

  const isIn = IN_TYPES.includes(movementType);
  const isOut = OUT_TYPES.includes(movementType);
  if (!isIn && !isOut) throw new ValidationError(`Tipo de movimiento inválido: ${movementType}`);

  const warehouseId = isIn ? warehouseToId : warehouseFromId;
  if (!warehouseId) {
    throw new ValidationError(
      isIn ? 'warehouseToId es obligatorio en movimientos de entrada'
           : 'warehouseFromId es obligatorio en movimientos de salida'
    );
  }
  if ((movementType === 'PURCHASE_IN' || movementType === 'INITIAL') && (unitCost == null || unitCost < 0)) {
    throw new ValidationError('unitCost es obligatorio en entradas por compra o carga inicial');
  }
  if ((movementType === 'ADJUSTMENT_IN' || movementType === 'ADJUSTMENT_OUT') && !reason?.trim()) {
    throw new ValidationError('El motivo (reason) es obligatorio en ajustes manuales');
  }

  // Multi-tenant: producto y almacén deben ser de la empresa del JWT
  const prodR = await transactionQuery(
    client,
    `SELECT id FROM products WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
    [productId, companyId]
  );
  if (prodR.rows.length === 0) throw new NotFoundError('Producto no encontrado en esta empresa');

  const whR = await transactionQuery<{ id: string; is_active: boolean }>(
    client,
    `SELECT id, is_active FROM warehouses WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
    [warehouseId, companyId]
  );
  if (whR.rows.length === 0) throw new NotFoundError('Almacén no encontrado en esta empresa');
  if (!whR.rows[0].is_active && movementType !== 'TRANSFER_OUT') {
    throw new ConflictError('El almacén está inactivo — solo se permiten traspasos de salida');
  }

  // Asegurar renglón de stock y bloquearlo (FOR UPDATE = serializa concurrentes)
  await transactionQuery(
    client,
    `INSERT INTO warehouse_stock (warehouse_id, product_id)
     VALUES ($1, $2) ON CONFLICT (warehouse_id, product_id) DO NOTHING`,
    [warehouseId, productId]
  );
  const stockR = await transactionQuery<{ id: string; quantity: number; avg_cost: number }>(
    client,
    `SELECT id, quantity, avg_cost FROM warehouse_stock
      WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE`,
    [warehouseId, productId]
  );
  const stock = stockR.rows[0];
  const currentQty = Number(stock.quantity);
  const currentAvg = Number(stock.avg_cost);

  // Política de costos efectiva (override de la operación > empresa)
  const method = await resolveCostingMethod(client, companyId, input.costingMethod);

  let newQty: number;
  let newAvg = currentAvg;
  let appliedUnitCost: number | null = unitCost ?? null;

  if (isIn) {
    newQty = currentQty + quantity;
    const inCost = unitCost != null && unitCost >= 0 ? unitCost : currentAvg;

    if (method === 'CAPAS') {
      // Respetar precios: lo existente queda en su capa; lo nuevo entra a su costo
      await ensureLayerBaseline(client, companyId, warehouseId, productId, currentQty, currentAvg);
      await transactionQuery(
        client,
        `INSERT INTO stock_cost_layers
           (company_id, warehouse_id, product_id, quantity_remaining, unit_cost)
         VALUES ($1, $2, $3, $4, $5)`,
        [companyId, warehouseId, productId, quantity, inCost]
      );
      newAvg = await remainingLayersAvg(client, warehouseId, productId, inCost);
      appliedUnitCost = inCost;
    } else if (unitCost != null && unitCost >= 0) {
      if (method === 'ULTIMO') {
        // Aumentar en forma general: TODO el stock se revalúa al costo nuevo
        newAvg = unitCost;
      } else {
        // PROMEDIO (default): prorratear — costo promedio ponderado
        newAvg = newQty > 0
          ? (currentQty * currentAvg + quantity * unitCost) / newQty
          : unitCost;
      }
      appliedUnitCost = unitCost;
    }
  } else {
    if (currentQty < quantity) {
      throw new ConflictError(
        `Existencia insuficiente: disponible ${currentQty}, solicitado ${quantity}`
      );
    }
    newQty = currentQty - quantity;

    if (method === 'CAPAS') {
      // La salida consume las capas más antiguas primero (FIFO)
      await ensureLayerBaseline(client, companyId, warehouseId, productId, currentQty, currentAvg);
      appliedUnitCost = await consumeLayersFIFO(client, warehouseId, productId, quantity);
      newAvg = await remainingLayersAvg(client, warehouseId, productId, currentAvg);
    } else {
      // PROMEDIO/ULTIMO: las salidas no alteran el costo promedio
      appliedUnitCost = unitCost ?? currentAvg;
    }
  }

  await transactionQuery(
    client,
    `UPDATE warehouse_stock SET quantity = $1, avg_cost = $2, updated_at = NOW() WHERE id = $3`,
    [newQty, newAvg, stock.id]
  );

  const movR = await transactionQuery<{ id: string }>(
    client,
    `INSERT INTO inventory_movements
       (company_id, product_id, movement_type, quantity, unit_cost,
        warehouse_from_id, warehouse_to_id, reference_type, reference_id,
        transfer_group, reason, user_id, user_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [companyId, productId, movementType, quantity,
     appliedUnitCost,
     warehouseFromId ?? null, warehouseToId ?? null,
     referenceType ?? null, referenceId ?? null,
     transferGroup ?? null, reason ?? null, userId ?? null, userEmail ?? null]
  );

  // Métricas informativas del producto (la verdad por almacén vive en warehouse_stock)
  if (movementType === 'PURCHASE_IN') {
    await transactionQuery(
      client,
      `UPDATE products SET last_cost = $1, updated_at = NOW() WHERE id = $2`,
      [unitCost, productId]
    );
  }
  await transactionQuery(
    client,
    `UPDATE products p SET
        stock_quantity = COALESCE(t.total_qty, 0),
        avg_cost       = COALESCE(t.w_avg, 0)
      FROM (SELECT SUM(quantity) AS total_qty,
                   CASE WHEN SUM(quantity) > 0
                        THEN SUM(quantity * avg_cost) / SUM(quantity) ELSE 0 END AS w_avg
              FROM warehouse_stock WHERE product_id = $1) t
      WHERE p.id = $1`,
    [productId]
  );

  return {
    movementId: movR.rows[0].id,
    productId,
    warehouseId,
    newQuantity: newQty,
    avgCost: newAvg,
    appliedUnitCost,
    costingMethod: method,
  };
}

/** Movimiento suelto — abre su propia transacción. */
export async function applyMovement(input: MovementInput): Promise<MovementResult> {
  return transaction((client) => applyMovementTx(client, input));
}

/**
 * Traspaso atómico entre almacenes (§7): TRANSFER_OUT + TRANSFER_IN en UNA
 * transacción, mismo transfer_group. El costo viaja con la mercancía
 * (avg_cost del almacén origen).
 *
 * Anti-deadlock: bloquea ambos renglones de stock en orden determinístico
 * (por warehouse_id) ANTES de aplicar; FOR UPDATE es reentrante en la misma tx.
 */
export async function transferStock(params: {
  companyId: string;
  productId: string;
  warehouseFromId: string;
  warehouseToId: string;
  quantity: number;
  reason?: string;
  userId?: string;
  userEmail?: string;
}): Promise<{ out: MovementResult; in: MovementResult; transferGroup: string }> {
  const { companyId, productId, warehouseFromId, warehouseToId, quantity } = params;
  if (warehouseFromId === warehouseToId) {
    throw new ValidationError('El almacén origen y destino no pueden ser el mismo');
  }

  return transaction(async (client) => {
    // Pre-lock ordenado de ambos renglones
    const ordered = [warehouseFromId, warehouseToId].sort();
    for (const wid of ordered) {
      await transactionQuery(
        client,
        `INSERT INTO warehouse_stock (warehouse_id, product_id)
         VALUES ($1, $2) ON CONFLICT (warehouse_id, product_id) DO NOTHING`,
        [wid, productId]
      );
      await transactionQuery(
        client,
        `SELECT id FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE`,
        [wid, productId]
      );
    }

    const { randomUUID } = await import('crypto');
    const transferGroup = randomUUID();

    const out = await applyMovementTx(client, {
      ...params,
      movementType: 'TRANSFER_OUT',
      warehouseFromId,
      warehouseToId: undefined,
      transferGroup,
      referenceType: 'transfer',
    });
    // El costo que viaja con la mercancía: en CAPAS es el de las capas
    // consumidas (FIFO); en PROMEDIO/ULTIMO es el promedio del origen.
    const travelCost = out.appliedUnitCost ?? 0;
    const inMove = await applyMovementTx(client, {
      ...params,
      movementType: 'TRANSFER_IN',
      warehouseFromId: undefined,
      warehouseToId,
      unitCost: travelCost,
      transferGroup,
      referenceType: 'transfer',
    });

    return { out, in: inMove, transferGroup };
  });
}

/* ─────────────── FASE 3 · Integración ventas ↔ inventario ─────────────── */

export interface StockShortage {
  productId: string;
  sku: string;
  name: string;
  requested: number;
  available: number;
}

/**
 * Partidas de una factura que SÍ se controlan en inventario:
 * solo las que tienen product_id Y el producto tiene renglón en
 * warehouse_stock (los servicios — timbres, honorarios — nunca lo tienen).
 */
async function getTrackedInvoiceItems(
  client: PoolClient,
  companyId: string,
  invoiceId: string
): Promise<Array<{ productId: string; sku: string; name: string; quantity: number }>> {
  const r = await transactionQuery<any>(
    client,
    `SELECT ii.product_id, p.sku, p.name, SUM(ii.quantity) AS quantity
       FROM invoice_items ii
       JOIN products p ON p.id = ii.product_id AND p.deleted_at IS NULL
      WHERE ii.invoice_id = $1
        AND ii.product_id IS NOT NULL
        AND p.company_id = $2
        AND EXISTS (SELECT 1 FROM warehouse_stock ws WHERE ws.product_id = ii.product_id)
      GROUP BY ii.product_id, p.sku, p.name`,
    [invoiceId, companyId]
  );
  return r.rows.map((row: any) => ({
    productId: row.product_id,
    sku: row.sku,
    name: row.name,
    quantity: Number(row.quantity),
  }));
}

/**
 * Faltantes de existencia para una factura (contra el almacén default).
 * Se usa ANTES de timbrar cuando la empresa bloquea venta sin stock (D3),
 * para no gastar el timbre con el PAC y luego fallar.
 */
export async function checkInvoiceStock(
  client: PoolClient,
  companyId: string,
  invoiceId: string
): Promise<StockShortage[]> {
  const items = await getTrackedInvoiceItems(client, companyId, invoiceId);
  if (items.length === 0) return [];
  const warehouseId = await getOrCreateDefaultWarehouse(client, companyId);

  const shortages: StockShortage[] = [];
  for (const it of items) {
    const r = await transactionQuery<{ quantity: number }>(
      client,
      `SELECT quantity FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2`,
      [warehouseId, it.productId]
    );
    const available = Number(r.rows[0]?.quantity ?? 0);
    if (available < it.quantity) {
      shortages.push({ ...it, requested: it.quantity, available });
    }
  }
  return shortages;
}

/**
 * Descuenta el stock de una factura TIMBRADA (§9) — se llama DENTRO de la
 * misma transacción del timbrado (regla de oro #10).
 *
 * Modo alerta (default D3): si falta existencia, descuenta lo disponible y
 * la diferencia queda anotada en el motivo del kardex — el faltante se
 * regulariza con inventario físico. Nunca se genera stock negativo.
 */
export async function discountInvoiceStock(
  client: PoolClient,
  params: { companyId: string; invoiceId: string; docRef: string; userId?: string; userEmail?: string }
): Promise<{ movements: number; warnings: string[] }> {
  const { companyId, invoiceId, docRef, userId, userEmail } = params;

  // Guard anti-doble-descuento (retimbrado / reintento)
  const already = await transactionQuery(
    client,
    `SELECT 1 FROM inventory_movements
      WHERE reference_type = 'invoice' AND reference_id = $1 LIMIT 1`,
    [invoiceId]
  );
  if (already.rows.length > 0) return { movements: 0, warnings: [] };

  const items = await getTrackedInvoiceItems(client, companyId, invoiceId);
  if (items.length === 0) return { movements: 0, warnings: [] };

  const warehouseId = await getOrCreateDefaultWarehouse(client, companyId);
  const warnings: string[] = [];
  let movements = 0;

  for (const it of items) {
    const r = await transactionQuery<{ quantity: number }>(
      client,
      `SELECT quantity FROM warehouse_stock
        WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE`,
      [warehouseId, it.productId]
    );
    const available = Number(r.rows[0]?.quantity ?? 0);
    const toDiscount = Math.min(available, it.quantity);
    const short = it.quantity - toDiscount;

    if (short > 0) {
      warnings.push(`${it.sku} ${it.name}: pedido ${it.quantity}, disponible ${available} — faltaron ${short}`);
    }
    if (toDiscount <= 0) continue;

    await applyMovementTx(client, {
      companyId,
      productId: it.productId,
      movementType: 'SALE_OUT',
      quantity: toDiscount,
      warehouseFromId: warehouseId,
      referenceType: 'invoice',
      referenceId: invoiceId,
      reason: short > 0
        ? `Venta ${docRef} (VENTA SIN EXISTENCIA SUFICIENTE: faltaron ${short})`
        : `Venta ${docRef}`,
      userId,
      userEmail,
    });
    movements++;
  }
  return { movements, warnings };
}

/**
 * Devuelve al inventario lo descontado por una factura (cancelación §9).
 * Revierte EXACTAMENTE los SALE_OUT registrados (no lo facturado): si en
 * modo alerta se descontó parcial, se devuelve ese parcial.
 */
export async function restoreInvoiceStock(
  client: PoolClient,
  params: { companyId: string; invoiceId: string; docRef: string; userId?: string; userEmail?: string }
): Promise<number> {
  const { companyId, invoiceId, docRef, userId, userEmail } = params;

  // Guard anti-doble-devolución
  const already = await transactionQuery(
    client,
    `SELECT 1 FROM inventory_movements
      WHERE reference_type = 'invoice_cancel' AND reference_id = $1 LIMIT 1`,
    [invoiceId]
  );
  if (already.rows.length > 0) return 0;

  const sales = await transactionQuery<any>(
    client,
    `SELECT product_id, warehouse_from_id, SUM(quantity) AS quantity
       FROM inventory_movements
      WHERE reference_type = 'invoice' AND reference_id = $1
        AND movement_type = 'SALE_OUT' AND company_id = $2
      GROUP BY product_id, warehouse_from_id`,
    [invoiceId, companyId]
  );

  let movements = 0;
  for (const s of sales.rows) {
    await applyMovementTx(client, {
      companyId,
      productId: s.product_id,
      movementType: 'CUSTOMER_RETURN',
      quantity: Number(s.quantity),
      warehouseToId: s.warehouse_from_id,
      referenceType: 'invoice_cancel',
      referenceId: invoiceId,
      reason: `Cancelación de factura ${docRef} — devolución al inventario`,
      userId,
      userEmail,
    });
    movements++;
  }
  return movements;
}

/**
 * Almacén default de la empresa — se crea bajo demanda para empresas nuevas
 * (el bootstrap de la migración solo cubrió las existentes en ese momento).
 */
export async function getOrCreateDefaultWarehouse(
  client: PoolClient,
  companyId: string
): Promise<string> {
  const r = await transactionQuery<{ id: string }>(
    client,
    `SELECT id FROM warehouses
      WHERE company_id = $1 AND is_default = true AND deleted_at IS NULL`,
    [companyId]
  );
  if (r.rows.length > 0) return r.rows[0].id;

  const ins = await transactionQuery<{ id: string }>(
    client,
    `INSERT INTO warehouses (company_id, code, name, is_default)
     VALUES ($1, 'GEN', 'Almacén General', true)
     ON CONFLICT (company_id, code) DO UPDATE SET is_default = true, deleted_at = NULL
     RETURNING id`,
    [companyId]
  );
  return ins.rows[0].id;
}
