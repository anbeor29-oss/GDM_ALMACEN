/**
 * faltantes.service — qué hay que comprar, SIN generar nada.
 *
 * POR QUÉ VIVE APARTE DE LA RUTA
 * Eran sesenta líneas de SQL dentro del handler, y nada de eso se podía probar
 * sin levantar el servidor. La regla del margen —qué cuenta como "ya está
 * llegando"— es justo lo que hay que poder verificar con números.
 *
 * SE PARTE DE warehouse_stock, NO DE LA VISTA DE PROYECCIÓN
 * `v_projected_stockout_15d` filtra `stock_minimum > 0`, y eso deja fuera
 * justamente lo que se pidió listar: un producto EN CEROS al que nadie le
 * configuró mínimo no aparece. Se parte del stock y se enriquece con la vista
 * cuando hay proyección, no al revés.
 *
 * CUATRO SITUACIONES, ordenadas por urgencia:
 *   agotado    → existencia en 0 o negativa
 *   bajo       → en o por debajo del mínimo configurado
 *   cerca      → hasta N unidades ARRIBA del mínimo (N = 2 por omisión)
 *   proyectado → llegará al mínimo en ≤15 días según el consumo
 *
 * "cerca" existe porque enterarse al TOCAR el mínimo es enterarse tarde: el
 * proveedor no entrega el mismo día, y entre que se pide y llega, el producto
 * ya se agotó. Es la diferencia entre un aviso y un reporte de daños.
 */

import { query } from '../../config/database';

export interface Faltante {
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  product_id: string;
  sku: string;
  product_name: string;
  quantity: number;
  stock_minimum: number;
  stock_maximum: number | null;
  situacion: 'agotado' | 'bajo' | 'cerca' | 'proyectado';
  sobre_el_minimo: number;
  sugerido: number;
  supplier_id: string | null;
  supplier_name: string | null;
  ya_pedido: boolean;
}

/**
 * @param margen Cuántas unidades ARRIBA del mínimo siguen contando como aviso.
 *               2 por omisión. Con 0 se comporta como antes: sólo lo que ya
 *               está en o bajo el mínimo.
 */
export async function listarFaltantes(companyId: string, margen = 2): Promise<any[]> {
  const m = Number.isFinite(Number(margen)) ? Math.max(0, Math.trunc(Number(margen))) : 2;
  const r = await query<any>(
    `SELECT ws.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
              ws.product_id, pr.sku, pr.name AS product_name,
              ws.quantity, ws.stock_minimum, ws.stock_maximum,
              v.days_to_minimum, v.daily_consumption,
              CASE
                WHEN ws.quantity <= 0 THEN 'agotado'
                WHEN ws.stock_minimum > 0 AND ws.quantity <= ws.stock_minimum THEN 'bajo'
                /* ── El escalón de aviso ──
                 * Dos unidades ARRIBA del mínimo. Todavía no es faltante, pero
                 * ya se está llegando: es el momento en que pedir sirve de
                 * algo, porque el proveedor tarda y esperar a tocar el mínimo
                 * es esperar a quedarse sin. */
                WHEN ws.stock_minimum > 0
                     AND ws.quantity <= ws.stock_minimum + $2 THEN 'cerca'
                ELSE 'proyectado'
              END AS situacion,
              /* Cuántas unidades faltan para tocar el mínimo. Es lo que
               * convierte "cerca" en un número: "2 arriba del mínimo". */
              GREATEST(ws.quantity - ws.stock_minimum, 0) AS sobre_el_minimo,
              /* Cuánto sugerir. La vista lo calcula cuando hay máximo y
               * consumo; si no, se propone llegar al máximo; y si tampoco hay
               * máximo queda en 0 para que lo escriba quien compra. Inventar
               * una cantidad sin base sería peor que dejarla vacía. */
              COALESCE(NULLIF(v.suggested_qty, 0),
                       GREATEST(COALESCE(ws.stock_maximum, 0) - ws.quantity, 0)) AS sugerido,
              sp.supplier_id, sp.last_price,
              c.business_name AS supplier_name, c.rfc AS supplier_rfc,
              /* ¿Ya hay una orden abierta con este producto en este almacén?
               * Sin este dato la pantalla invitaría a pedir dos veces lo mismo,
               * y el aviso llegaría cuando el proveedor entregue doble. */
              EXISTS (
                SELECT 1 FROM purchase_order_items poi
                  JOIN purchase_orders po ON po.id = poi.purchase_order_id
                 WHERE po.company_id = pr.company_id
                   AND po.warehouse_id = ws.warehouse_id
                   AND poi.product_id = ws.product_id
                   AND po.status IN ('PENDING','QUOTED','APPROVED','PURCHASED','RECEIVED_PARTIAL')
              ) AS ya_pedido
         FROM warehouse_stock ws
         JOIN products   pr ON pr.id = ws.product_id AND pr.deleted_at IS NULL
         JOIN warehouses w  ON w.id  = ws.warehouse_id AND w.deleted_at IS NULL
         LEFT JOIN v_projected_stockout_15d v
                ON v.product_id = ws.product_id AND v.warehouse_id = ws.warehouse_id
         LEFT JOIN LATERAL (
           SELECT sp2.supplier_id, sp2.last_price
             FROM supplier_products sp2
            WHERE sp2.product_id = ws.product_id
            ORDER BY sp2.is_primary DESC, sp2.last_purchase_date DESC NULLS LAST
            LIMIT 1
         ) sp ON true
         LEFT JOIN customers c ON c.id = sp.supplier_id
        WHERE pr.company_id = $1
          AND (ws.quantity <= 0
               /* El mínimo MÁS EL MARGEN: entra lo que ya está por debajo y
                * también lo que le faltan dos para llegar. Esperar a tocar el
                * mínimo para enterarse es enterarse tarde — el proveedor no
                * entrega el mismo día. */
               OR (ws.stock_minimum > 0 AND ws.quantity <= ws.stock_minimum + $2)
               OR v.reorder_needed = true)
        ORDER BY (ws.quantity <= 0) DESC,
                 (ws.stock_minimum > 0 AND ws.quantity <= ws.stock_minimum) DESC,
                 v.days_to_minimum ASC NULLS LAST,
                 pr.name`,
    [companyId, m]
  );
  return r.rows;
}
