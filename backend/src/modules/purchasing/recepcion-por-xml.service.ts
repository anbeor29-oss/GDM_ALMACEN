/**
 * recepcion-por-xml.service — cierra la orden de compra cuando la mercancía
 * entra de verdad al almacén.
 *
 * EL HUECO QUE TAPA
 * El ciclo de una orden era: se detecta el faltante, se cotiza, se compra… y
 * ahí se quedaba. Cuando el proveedor entregaba y se subía su XML, el
 * inventario sí se movía, pero la orden seguía figurando abierta para siempre.
 * Con el tiempo, la lista de órdenes pendientes deja de significar nada: nadie
 * puede distinguir lo que falta por llegar de lo que llegó hace tres meses.
 *
 * QUÉ HACE
 * Al recibir una compra por XML, busca órdenes abiertas del MISMO proveedor con
 * los productos que llegaron, abona lo recibido renglón por renglón y mueve el
 * estado:
 *
 *   · llegó todo lo pedido      → RECEIVED
 *   · llegó una parte           → RECEIVED_PARTIAL
 *   · no coincidió ningún renglón → la orden no se toca
 *
 * POR QUÉ NO LANZA NUNCA
 * La compra ya se registró y el inventario ya se movió cuando esto corre. Si
 * fallara el enlace con la orden y eso abortara la operación, el usuario
 * perdería una recepción entera por un dato administrativo. El resultado se
 * devuelve para mostrarlo, y si algo no cuadra se ajusta a mano desde la orden.
 *
 * POR QUÉ EL PROVEEDOR TIENE QUE COINCIDIR
 * Sin ese filtro, una compra de tornillos a un proveedor cerraría la orden de
 * tornillos que se le pidió a OTRO —que sigue debiéndolos—. El emparejamiento
 * por producto solo no basta.
 */

import { PoolClient } from 'pg';
import { transactionQuery } from '../../config/database';
import logger from '../../middleware/logger';

/** Estados en los que una orden todavía espera mercancía. */
const ABIERTAS = ['PENDING', 'QUOTED', 'APPROVED', 'PURCHASED', 'RECEIVED_PARTIAL'];

export interface RecepcionAplicada {
  ordenId: string;
  folio: string;
  estadoAnterior: string;
  estadoNuevo: string;
  renglones: Array<{ productId: string; abonado: number; pedido: number; recibidoTotal: number }>;
}

/**
 * Abona al inventario de órdenes abiertas lo que acaba de entrar por XML.
 *
 * Corre DENTRO de la transacción de la importación: si la importación se
 * revierte, el abono a la orden se revierte con ella. Lo contrario dejaría
 * órdenes marcadas como recibidas por mercancía que no entró.
 */
export async function aplicarRecepcionDesdeXml(
  client: PoolClient,
  opts: {
    companyId: string;
    supplierId: string;
    warehouseId?: string;
    /** Lo que de verdad entró: producto y cantidad contada. */
    recibido: Array<{ productId: string; cantidad: number }>;
    userEmail?: string;
  }
): Promise<RecepcionAplicada[]> {
  const aplicadas: RecepcionAplicada[] = [];
  if (!opts.recibido.length || !opts.supplierId) return aplicadas;

  try {
    const productIds = opts.recibido.map(r => r.productId);

    /* Órdenes abiertas de ESE proveedor que incluyan alguno de los productos.
     *
     * Se ordenan por antigüedad: si hay dos órdenes pendientes del mismo
     * producto, lo que llega salda primero la más vieja. Es la regla que
     * cualquiera espera y evita que una orden quede eternamente abierta
     * mientras las nuevas se cierran. */
    const ordR = await transactionQuery<any>(client,
      `SELECT DISTINCT po.id, po.folio, po.status, po.created_at
         FROM purchase_orders po
         JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
        WHERE po.company_id = $1
          AND po.supplier_id = $2
          AND po.status = ANY($3)
          AND poi.product_id = ANY($4::uuid[])
          ${opts.warehouseId ? 'AND (po.warehouse_id = $5 OR po.warehouse_id IS NULL)' : ''}
        ORDER BY po.created_at ASC`,
      opts.warehouseId
        ? [opts.companyId, opts.supplierId, ABIERTAS, productIds, opts.warehouseId]
        : [opts.companyId, opts.supplierId, ABIERTAS, productIds]
    );

    /* Lo que queda por repartir de cada producto. Se va descontando conforme
     * se abona a cada orden, para no acreditar la misma mercancía dos veces
     * cuando hay varias órdenes con el mismo producto. */
    const pendiente = new Map<string, number>();
    for (const r of opts.recibido) {
      pendiente.set(r.productId, (pendiente.get(r.productId) || 0) + Number(r.cantidad));
    }

    for (const orden of ordR.rows) {
      const itemsR = await transactionQuery<any>(client,
        `SELECT id, product_id, quantity_ordered, quantity_received
           FROM purchase_order_items
          WHERE purchase_order_id = $1`,
        [orden.id]
      );

      const renglones: RecepcionAplicada['renglones'] = [];

      for (const it of itemsR.rows) {
        const porRepartir = pendiente.get(it.product_id) || 0;
        if (porRepartir <= 0) continue;

        const pedido = Number(it.quantity_ordered);
        const yaRecibido = Number(it.quantity_received);
        const falta = Math.max(0, pedido - yaRecibido);
        if (falta <= 0) continue;

        /* Se abona SOLO lo que falta de esa orden. Si llegó de más, el sobrante
         * queda disponible para otra orden del mismo producto; y si no hay
         * otra, simplemente no se acredita a ninguna: el inventario ya lo
         * registró, y inflar `quantity_received` por encima de lo pedido haría
         * que la orden mienta sobre lo que se solicitó. */
        const abonar = Math.min(porRepartir, falta);

        await transactionQuery(client,
          `UPDATE purchase_order_items
              SET quantity_received = quantity_received + $2
            WHERE id = $1`,
          [it.id, abonar]
        );
        pendiente.set(it.product_id, porRepartir - abonar);
        renglones.push({
          productId: it.product_id,
          abonado: abonar,
          pedido,
          recibidoTotal: yaRecibido + abonar,
        });
      }

      if (!renglones.length) continue;

      /* ¿Se completó la orden? Se relee de la base en vez de calcularlo con lo
       * que se acaba de abonar: la orden pudo tener renglones que llegaron en
       * una entrega anterior, y sumar sólo lo de ahora la dejaría como parcial
       * cuando en realidad ya está completa. */
      const faltanR = await transactionQuery<{ n: string }>(client,
        `SELECT COUNT(*)::text AS n
           FROM purchase_order_items
          WHERE purchase_order_id = $1
            AND quantity_received < quantity_ordered`,
        [orden.id]
      );
      const completa = Number(faltanR.rows[0].n) === 0;
      const nuevo = completa ? 'RECEIVED' : 'RECEIVED_PARTIAL';

      await transactionQuery(client,
        /* No se toca ninguna fecha de recepción: la tabla no tiene esa columna
         * y agregarla sólo para esto sería inventar estructura. `updated_at`
         * ya registra cuándo cambió, y el estado dice qué pasó. */
        `UPDATE purchase_orders
            SET status = $2, updated_at = NOW()
          WHERE id = $1`,
        [orden.id, nuevo]
      );

      logger.info(
        `[compras] orden ${orden.folio}: ${orden.status} → ${nuevo} ` +
        `por recepción de XML (${renglones.length} renglón/es)`
      );
      aplicadas.push({
        ordenId: orden.id,
        folio: orden.folio,
        estadoAnterior: orden.status,
        estadoNuevo: nuevo,
        renglones,
      });
    }
  } catch (e) {
    /* Nunca revienta la recepción. Ver la nota del encabezado: la mercancía ya
     * entró, y perder eso por un enlace administrativo sería un mal negocio. */
    logger.warn(`[compras] no se pudo enlazar la recepción con órdenes: ${(e as Error).message}`);
  }

  return aplicadas;
}
