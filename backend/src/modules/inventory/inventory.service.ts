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
}

export interface MovementResult {
  movementId: string;
  productId: string;
  warehouseId: string;
  newQuantity: number;
  avgCost: number;
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

  let newQty: number;
  let newAvg = currentAvg;

  if (isIn) {
    newQty = currentQty + quantity;
    // Costo promedio ponderado — solo cuando la entrada trae costo
    if (unitCost != null && unitCost >= 0) {
      newAvg = newQty > 0
        ? (currentQty * currentAvg + quantity * unitCost) / newQty
        : unitCost;
    }
  } else {
    if (currentQty < quantity) {
      throw new ConflictError(
        `Existencia insuficiente: disponible ${currentQty}, solicitado ${quantity}`
      );
    }
    newQty = currentQty - quantity;
    // Las salidas no alteran el costo promedio
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
     unitCost ?? (isOut ? currentAvg : null),
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

    // El costo que viaja es el promedio del origen
    const srcR = await transactionQuery<{ avg_cost: number }>(
      client,
      `SELECT avg_cost FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2`,
      [warehouseFromId, productId]
    );
    const travelCost = Number(srcR.rows[0]?.avg_cost ?? 0);

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
