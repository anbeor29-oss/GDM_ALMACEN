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
import { preregistrarEnTransaccion } from './preregistro-proveedor.service';
import { applyMovementTx } from '../inventory/inventory.service';

export type OrderStatus =
  | 'PENDING' | 'QUOTED' | 'APPROVED' | 'PURCHASED'
  | 'RECEIVED_PARTIAL' | 'RECEIVED' | 'CANCELLED';

/**
 * Las únicas tasas de IVA que existen en México: 16% general, 8% en la región
 * fronteriza y 0% en alimentos, medicinas y exportación.
 *
 * La lista es cerrada a propósito. Con un campo libre alguien captura 15 o 1.6
 * y el pago programado sale mal sin que nada lo detecte; aquí una tasa que no
 * esté en la lista se rechaza en vez de convertirse calladamente en 16.
 */
export const TASAS_IVA = [16, 8, 0] as const;
const TASA_IVA_DEFAULT = 16;

function tasaDeIvaValida(tasa?: number): number {
  if (tasa == null || tasa === undefined) return TASA_IVA_DEFAULT;
  const n = Number(tasa);
  if (!TASAS_IVA.includes(n as any)) {
    throw new ValidationError(
      `Tasa de IVA no válida: ${tasa}. Las únicas admitidas son 16%, 8% y 0%.`
    );
  }
  return n;
}

/**
 * Redondeo a centavos.
 *
 * `subtotal * 1.16` en punto flotante da 1160.0000000000002 y ese número acaba
 * en la pantalla de tesorería y en la transferencia. Se corta aquí, una vez,
 * en lugar de maquillarlo en cada lugar que lo muestre.
 */
function redondeaPesos(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

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

/* ─────────────────────  LA DEUDA CON EL PROVEEDOR  ───────────────────── */

/**
 * Da de alta la cuenta por pagar de una compra en tesorería.
 *
 * Vive aquí, en un solo lugar, porque la deuda nace por DOS caminos: con la
 * factura que trae el repartidor al recibir, y con la factura que llega días
 * después de una orden ya surtida. Son el mismo hecho contable, y tenerlo
 * duplicado garantizaba que un día uno de los dos dejara de consumir la línea
 * de crédito o de respetar los días de vencimiento.
 *
 * No lanza si la factura ya estaba registrada: devuelve la existente marcada.
 * El doble clic y la segunda entrega amparada por una sola factura son casos
 * de todos los días, no errores que valga la pena interrumpir.
 */
async function generarDeudaProveedor(
  client: PoolClient,
  d: {
    companyId: string;
    supplierId: string | null;
    orderId: string;
    folio: number;
    invoiceNumber: string;
    /** Importe antes de impuestos. Si no viene, se usa el costo de la mercancía. */
    subtotal?: number;
    /** 16, 8 o 0. Si no viene, 16. */
    taxRate?: number;
    invoiceDate?: string;
    /**
     * El TOTAL de la factura, tal como lo dice el papel. Si viene, manda sobre
     * el subtotal: quien tiene la factura en la mano lee el total, no la base.
     */
    total?: number;
    /**
     * Días de crédito de ESTA factura. Si no vienen, los del proveedor.
     *
     * Se permite por factura porque el plazo se negocia por compra: el mismo
     * proveedor da 30 días en la mercancía de siempre y contado en un pedido
     * especial.
     */
    creditDays?: number;
    /** Costo de la mercancía, como propuesta cuando no capturan el subtotal. */
    importePropuesto: number;
  }
): Promise<any> {
  if (!d.supplierId) {
    throw new ValidationError(
      'Falta a quién se le debe: elige el proveedor de la lista o captura su ' +
      'nombre para darlo de alta al vuelo. Sin acreedor, la deuda no se puede ' +
      'registrar en tesorería.'
    );
  }

  const yaExiste = await transactionQuery<any>(
    client,
    `SELECT id, amount, subtotal, tax_rate, due_date FROM supplier_payments_schedule
      WHERE company_id = $1 AND supplier_id = $2
        AND UPPER(invoice_number) = UPPER($3) AND status <> 'CANCELLED'
      LIMIT 1`,
    [d.companyId, d.supplierId, d.invoiceNumber]
  );
  if (yaExiste.rows[0]) {
    return {
      id: yaExiste.rows[0].id,
      amount: Number(yaExiste.rows[0].amount),
      subtotal: yaExiste.rows[0].subtotal != null ? Number(yaExiste.rows[0].subtotal) : null,
      taxRate: yaExiste.rows[0].tax_rate != null ? Number(yaExiste.rows[0].tax_rate) : null,
      dueDate: yaExiste.rows[0].due_date,
      yaExistia: true,
    };
  }

  /* El IVA se calcula, no se supone.
   *
   * Antes se guardaba el costo de la mercancía tal cual cuando nadie capturaba
   * el total, y eso programaba un pago 16% más chico que el que el proveedor
   * iba a cobrar. Aquí el subtotal es el dato que se captura —el costo sirve de
   * propuesta— y el total sale de la tasa elegida. */
  const tasa = tasaDeIvaValida(d.taxRate);

  /* Tres caminos, en orden de qué tan directo es el dato:
   *
   *   1. El TOTAL capturado. Es lo que dice la factura y lo que se va a pagar;
   *      el subtotal se deriva. Quien tiene el papel en la mano lee el total.
   *   2. El SUBTOTAL capturado, más el IVA de la tasa elegida.
   *   3. Ninguno de los dos: el costo de la mercancía recibida, como propuesta.
   *
   * El orden importa. Antes se guardaba el costo tal cual cuando nadie
   * capturaba nada, y eso programaba un pago 16% más chico que el que el
   * proveedor iba a cobrar. */
  let base: number;
  let importe: number;
  if (d.total != null && Number(d.total) > 0) {
    importe = redondeaPesos(Number(d.total));
    base = redondeaPesos(importe / (1 + tasa / 100));
  } else {
    base = d.subtotal != null && Number(d.subtotal) > 0
      ? Number(d.subtotal)
      : d.importePropuesto;
    importe = redondeaPesos(base * (1 + tasa / 100));
  }
  if (!(importe > 0)) return null;

  /* Los días de la factura ganan a los del proveedor; si no vienen, se deja
   * NULL y el SQL cae a los del catálogo. */
  const dias = Number.isFinite(Number(d.creditDays)) && Number(d.creditDays) >= 0
    ? Math.trunc(Number(d.creditDays))
    : null;

  const insR = await transactionQuery<any>(
    client,
    `INSERT INTO supplier_payments_schedule
       (company_id, supplier_id, purchase_order_id, invoice_number,
        subtotal, tax_rate, amount, due_date, notes)
     SELECT $1, $2, $3, $4, $5, $6, $7,
            (COALESCE($8::timestamp, NOW())
              + make_interval(days => COALESCE($10::int, c.credit_days, 0)))::date,
            $9
       FROM customers c WHERE c.id = $2
     RETURNING id, amount, subtotal, tax_rate, due_date,
               COALESCE($10::int,
                        (SELECT COALESCE(credit_days, 0) FROM customers WHERE id = $2)
               ) AS credit_days`,
    [d.companyId, d.supplierId, d.orderId, d.invoiceNumber,
     redondeaPesos(base), tasa, importe,
     d.invoiceDate || null,
     `Orden de compra #${d.folio} · factura ${d.invoiceNumber} · ` +
     `subtotal ${redondeaPesos(base)} + IVA ${tasa}%`,
     dias]
  );
  if (!insR.rows[0]) return null;

  // Consume línea de crédito, igual que la compra por XML.
  await transactionQuery(
    client,
    `UPDATE customers SET credit_used = COALESCE(credit_used, 0) + $1 WHERE id = $2`,
    [importe, d.supplierId]
  );
  return {
    id: insR.rows[0].id,
    amount: Number(insR.rows[0].amount),
    subtotal: Number(insR.rows[0].subtotal),
    taxRate: Number(insR.rows[0].tax_rate),
    dueDate: insR.rows[0].due_date,
    creditDays: Number(insR.rows[0].credit_days || 0),
    yaExistia: false,
  };
}

/**
 * Registra la factura de una orden YA SURTIDA — la mercancía entró antes que
 * el papel.
 *
 * Es lo más común del mundo: llega el camión con la remisión, se recibe para
 * que el almacén pueda vender, y la factura aparece tres días después. Sin
 * esto había que capturar la deuda a mano en tesorería, sin liga con la orden
 * que la originó, y el proveedor quedaba con la línea de crédito libre como si
 * no se le debiera nada.
 *
 * NO mueve existencias: la mercancía ya se registró al recibir. Aquí sólo
 * nace el pasivo.
 */
export async function registrarFacturaDeOrden(
  companyId: string,
  orderId: string,
  datos: DatosDeFactura & { invoiceNumber: string }
): Promise<any> {
  const folioFactura = String(datos?.invoiceNumber || '').trim().slice(0, 60);
  if (!folioFactura) throw new ValidationError('Captura el número de la factura');

  return transaction(async (client) => {
    const poR = await transactionQuery<any>(
      client,
      `SELECT id, folio, status, supplier_id FROM purchase_orders
        WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [orderId, companyId]
    );
    if (poR.rows.length === 0) throw new NotFoundError('Orden no encontrada');
    const po = poR.rows[0];

    if (!['RECEIVED', 'RECEIVED_PARTIAL'].includes(po.status)) {
      throw new ConflictError(
        'Esta orden todavía no tiene mercancía recibida. Captura la factura ' +
        'desde "Recibir mercancía", junto con lo que entra al almacén.'
      );
    }

    /* Si la orden se cerró sin proveedor, aquí se completa —de la lista o
     * capturando su nombre—. Es llenar un dato que faltaba, no reescribir
     * historia: si ya tenía proveedor, se le debe a ése. */
    const supplierId = await resolverProveedorDeLaOrden(
      client, companyId, orderId, po.supplier_id, datos
    );

    /* Propuesta de subtotal: lo que costó lo que YA se recibió. El IVA se le
     * suma después, según la tasa elegida. */
    const costoR = await transactionQuery<{ costo: string }>(
      client,
      `SELECT COALESCE(SUM(quantity_received * COALESCE(last_purchase_price, 0)), 0)::text AS costo
         FROM purchase_order_items WHERE purchase_order_id = $1`,
      [orderId]
    );

    const deuda = await generarDeudaProveedor(client, {
      companyId,
      supplierId,
      orderId,
      folio: po.folio,
      invoiceNumber: folioFactura,
      subtotal: datos.subtotal,
      total: datos.total,
      taxRate: datos.taxRate,
      invoiceDate: datos.invoiceDate,
      creditDays: datos.creditDays,
      importePropuesto: Number(costoR.rows[0].costo || 0),
    });

    logger.info(
      `[purchasing] orden #${po.folio}: factura ${folioFactura} registrada ` +
      `(deuda ${deuda?.yaExistia ? 'ya existente' : 'generada'} ${deuda?.amount ?? 0})`
    );
    return { id: po.id, folio: po.folio, invoiceNumber: folioFactura, deuda };
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
  /** Importe ANTES de impuestos. Si no viene, se usa el costo de lo recibido. */
  subtotal?: number;
  /** Tasa de IVA: 16, 8 o 0. Si no viene, 16. */
  taxRate?: number;
  /** Fecha de la factura: de ahí cuentan los días de crédito. */
  invoiceDate?: string;
  /** El TOTAL como lo dice el papel. Si viene, manda sobre el subtotal. */
  total?: number;
  /** Días de crédito de ESTA factura. Si no vienen, los del proveedor. */
  creditDays?: number;
  /**
   * Nombre del proveedor cuando NO está en el catálogo.
   *
   * Se da de alta al vuelo con esto y los días de crédito —un preregistro— y
   * la deuda queda con acreedor. Antes, sin proveedor dado de alta, la
   * mercancía entraba y la deuda no: nadie la reclamaba hasta que el proveedor
   * llamaba, y para entonces ya había vencido.
   */
  supplierName?: string;
  /** Proveedor ya existente, cuando la orden no traía ninguno. */
  supplierId?: string;
}

/**
 * Deja lista la orden para que la deuda tenga acreedor.
 *
 * Devuelve el proveedor a usar, dándolo de alta al vuelo si hace falta. Vive
 * aquí y no en cada camino porque la factura llega por dos rutas —al recibir y
 * días después— y las dos necesitan lo mismo.
 */
async function resolverProveedorDeLaOrden(
  client: PoolClient,
  companyId: string,
  orderId: string,
  actual: string | null,
  factura?: DatosDeFactura
): Promise<string | null> {
  /* Si la orden ya tiene proveedor, se le debe a ése. Lo que venga en el
   * cuerpo se ignora: no es llenar un hueco, sería reescribir a quién se le
   * compró. */
  if (actual) return actual;

  let nuevo: string | null = null;

  if (factura?.supplierId) {
    const sup = await transactionQuery<any>(
      client,
      `SELECT id FROM customers
        WHERE id = $1 AND company_id = $2 AND party_type = 'SUPPLIER' AND deleted_at IS NULL`,
      [factura.supplierId, companyId]
    );
    if (sup.rows.length === 0) throw new NotFoundError('Proveedor no encontrado');
    nuevo = factura.supplierId;
  } else if (String(factura?.supplierName || '').trim()) {
    const pre = await preregistrarEnTransaccion(client, companyId, {
      nombre: String(factura!.supplierName),
      creditDays: factura?.creditDays,
    });
    nuevo = pre.id;
  }

  if (nuevo) {
    await transactionQuery(
      client,
      `UPDATE purchase_orders SET supplier_id = $1, updated_at = NOW() WHERE id = $2`,
      [nuevo, orderId]
    );
  }
  return nuevo;
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

    const folioFactura = String(factura?.invoiceNumber || '').trim().slice(0, 60);

    /* El proveedor, antes de la deuda: puede venir de la orden, de la lista, o
     * capturarse al vuelo con su nombre. */
    const proveedorDeuda = folioFactura
      ? await resolverProveedorDeLaOrden(client, companyId, orderId, po.supplier_id, factura)
      : po.supplier_id;

    const deuda = folioFactura
      ? await generarDeudaProveedor(client, {
          companyId,
          supplierId: proveedorDeuda,
          orderId,
          folio: po.folio,
          invoiceNumber: folioFactura,
          subtotal: factura?.subtotal,
          total: factura?.total,
          taxRate: factura?.taxRate,
          invoiceDate: factura?.invoiceDate,
          creditDays: factura?.creditDays,
          importePropuesto: costoRecibido,
        })
      : null;

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
