/**
 * factura-individual.service — factura una venta de mostrador a nombre de un
 * cliente, en lugar de mandarla a la global del día.
 *
 * EL CASO QUE RESUELVE
 * Alguien compra poco en el mostrador pero quiere factura con su RFC. Antes la
 * única salida era capturarle una factura aparte a mano, y eso descuadraba el
 * inventario: el POS ya había descontado la mercancía y la factura la volvía a
 * descontar.
 *
 * EL PROBLEMA DEL DOBLE DESCUENTO, Y CÓMO SE EVITA
 * Timbrar una factura descuenta existencias (`discountInvoiceStock`). La venta
 * del POS ya las descontó al cobrar. Facturar encima restaría dos veces la
 * misma mercancía.
 *
 * En vez de agregar un interruptor para saltarse el descuento —que alguien
 * acabaría usando donde no debe—, se REAPUNTAN los movimientos que ya existen:
 * los del kardex pasan de referenciar `pos_sale` a referenciar la `invoice`.
 * Con eso, el guard anti-doble-descuento que ya vive en `discountInvoiceStock`
 * los encuentra y no descuenta nada.
 *
 * Y de paso mejora la trazabilidad: en el Kardex, el renglón de esa salida deja
 * de decir "pos_sale" y muestra el folio de la factura, que es el documento con
 * el que alguien va a reclamar.
 *
 * SE FACTURA LO QUE SE VENDIÓ, NO UN CONCEPTO GENÉRICO
 * La factura global usa un producto único "venta al público" porque ampara
 * decenas de tickets. Aquí el cliente pidió SU factura: tiene que ver lo que
 * compró, con su clave del SAT y su precio.
 */

import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import * as invoicesService from '../invoices/invoices.service';

export interface FacturaDeVenta {
  invoiceId: string;
  folio: string;
  uuid: string | null;
  stamped: boolean;
  aviso?: string;
}

/**
 * Emite la factura de UNA venta de mostrador.
 *
 * @param saleId  venta en estado OPEN — ya cobrada y ya descontada del stock
 * @param customerId cliente del catálogo (con RFC válido)
 */
export async function facturarVenta(opts: {
  companyId: string;
  saleId: string;
  customerId: string;
  cfdiUse?: string;
  user?: { userId?: string; email?: string };
}): Promise<FacturaDeVenta> {
  const { companyId, saleId, customerId } = opts;

  const saleR = await query<any>(
    `SELECT id, folio, status, payment_form, total, warehouse_id
       FROM pos_sales
      WHERE id = $1 AND company_id = $2`,
    [saleId, companyId]
  );
  if (saleR.rows.length === 0) throw new NotFoundError('Venta no encontrada');
  const sale = saleR.rows[0];

  if (sale.status === 'INVOICED_INDIVIDUAL') {
    throw new ValidationError('Esa venta ya tiene su factura.');
  }
  if (sale.status === 'IN_GLOBAL') {
    throw new ValidationError(
      'Esa venta ya quedó incluida en la factura global del día. Para facturarla ' +
      'a nombre del cliente hay que emitir una nota de crédito de la global primero.'
    );
  }
  if (sale.status === 'CANCELLED') {
    throw new ValidationError('Esa venta está cancelada.');
  }

  /* Las partidas reales del ticket. Se leen con su precio de venta tal como se
   * cobró: recalcularlo con el precio de lista daría un importe distinto al
   * que el cliente pagó, y la factura tiene que coincidir con el ticket. */
  const itemsR = await query<any>(
    `SELECT psi.product_id, psi.quantity, psi.unit_price, p.name
       FROM pos_sale_items psi
       JOIN products p ON p.id = psi.product_id
      WHERE psi.pos_sale_id = $1
      ORDER BY psi.created_at NULLS LAST, psi.id`,
    [saleId]
  );
  if (itemsR.rows.length === 0) {
    throw new ValidationError('La venta no tiene partidas — no hay qué facturar.');
  }

  const invoice = await invoicesService.createInvoice(companyId, {
    customerId,
    cfdiType: 'I',
    /* La forma de pago del ticket: si cobró en efectivo, la factura dice
     * efectivo. PUE porque en mostrador se paga al momento — un PPD obligaría
     * a un complemento de pago por dinero que ya está en la caja. */
    paymentForm: sale.payment_form || '01',
    paymentMethod: 'PUE',
    cfdiUse: opts.cfdiUse || 'G03',
    items: itemsR.rows.map((it: any) => ({
      productId: it.product_id,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unit_price),
    })),
    notes: `Venta de mostrador #${sale.folio}`,
  } as any);

  const folio = `${invoice.serie || 'F'}-${String(invoice.folio).padStart(6, '0')}`;

  /* Reapuntar los movimientos ANTES de timbrar.
   *
   * El orden importa: el descuento ocurre dentro de la transacción del
   * timbrado, así que si esto se hiciera después, el timbrado ya habría
   * restado la mercancía por segunda vez. */
  const reapuntados = await transaction(async (client) => {
    const r = await transactionQuery(client,
      `UPDATE inventory_movements
          SET reference_type = 'invoice',
              reference_id   = $2,
              reason = reason || ' · facturada ' || $3
        WHERE reference_type = 'pos_sale'
          AND reference_id = $1`,
      [saleId, invoice.id, folio]
    );
    await transactionQuery(client,
      `UPDATE pos_sales
          SET status = 'INVOICED_INDIVIDUAL', invoice_id = $2, customer_id = $3
        WHERE id = $1`,
      [saleId, invoice.id, customerId]
    );
    return r.rowCount || 0;
  });

  let stamped = false;
  let uuid: string | null = null;
  let aviso: string | undefined;
  try {
    const pac = await import('../pac/pac.service');
    const res: any = await pac.stampInvoice(companyId, invoice.id);
    uuid = res?.uuid || null;
    stamped = true;
  } catch (e) {
    /* La venta ya está cobrada y la factura creada. Si el PAC falla, no se
     * deshace nada: se avisa y se reintenta desde Facturas. Cancelar la venta
     * porque el timbrado falló dejaría al cliente con mercancía y sin ticket. */
    aviso = `La factura ${folio} se creó pero no se pudo timbrar: ${(e as Error).message}. ` +
            'Reinténtalo desde Facturas.';
    logger.error(`[pos] venta ${sale.folio}: ${aviso}`);
  }

  logger.info(
    `[pos] venta #${sale.folio} facturada como ${folio} ` +
    `(${reapuntados} movimiento(s) de kardex reapuntados, sin doble descuento)`
  );
  return { invoiceId: invoice.id, folio, uuid, stamped, aviso };
}
