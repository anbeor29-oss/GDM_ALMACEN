/**
 * Notas de Crédito (CFDI 4.0 tipo E — Egreso).
 * Catálogos involucrados (Anexo 20):
 *  - c_TipoDeComprobante = "E"
 *  - c_TipoRelacion: 01 = Nota de crédito de los documentos relacionados,
 *                   03 = Devolución de mercancía, 02 = Nota de débito, etc.
 *
 * Reglas implementadas:
 *  - El monto total de la NC no puede exceder el saldo pendiente de la factura.
 *  - Al guardarse en BD se simula timbrado MOCK (status STAMPED, UUID).
 *  - El sistema aplica el monto como un "pago" a la factura referenciada
 *    (de forma que el seguimiento de saldo y los reportes funcionen sin código aparte).
 */

import { v4 as uuidv4 } from 'uuid';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import { applyMovementTx, getOrCreateDefaultWarehouse } from '../inventory/inventory.service';

export interface CreditNoteInput {
  customerId: string;
  invoiceId: string;             // factura a la que aplica
  tipoRelacion?: string;         // c_TipoRelacion (01 default)
  motivo?: string;
  /** Si viene, la NC se calcula como % del TOTAL de la factura (pronto pago / devolución parcial). */
  discountPercent?: number;
  /** Monto TOTAL de la NC (alternativo a discountPercent). Incluye IVA. */
  amount?: number;
  iva?: number;                  // IVA contenido en el monto (opcional, se prorratea si falta)
  currency?: string;
  applyToInvoice?: boolean;      // true: descuenta del saldo; false: solo registra
  /**
   * ALMACEN §9/§10 — Devolución de mercancía AUTOMÁTICA: partidas de la
   * factura que el cliente regresa físicamente. Al crear la NC generan
   * CUSTOMER_RETURN al inventario en la MISMA transacción. Cancelar la NC
   * saca la mercancía de vuelta (reversa).
   */
  returnItems?: Array<{ productId: string; quantity: number }>;
  /** Almacén que recibe la devolución (default: el default de la empresa). */
  returnWarehouseId?: string;
}

const MOTIVOS_NC: Record<string, string> = {
  '01': 'Nota de crédito de los documentos relacionados',
  '02': 'Nota de débito de los documentos relacionados',
  '03': 'Devolución de mercancía sobre facturas o traslados previos',
  '04': 'Sustitución de los CFDI previos',
  '07': 'CFDI por aplicación de anticipo',
};

async function getNextNCFolio(client: any, companyId: string): Promise<number> {
  const r = await transactionQuery<{ folio: number }>(
    client,
    `SELECT COALESCE(MAX(folio), 0) + 1 AS folio
       FROM credit_notes
      WHERE company_id = $1`,
    [companyId]
  );
  return r.rows[0]?.folio || 1;
}

export async function createCreditNote(companyId: string, data: CreditNoteInput) {
  if (!data.customerId) throw new ValidationError('customerId es requerido');
  if (!data.invoiceId)  throw new ValidationError('invoiceId es requerido');

  const hasPct    = typeof data.discountPercent === 'number' && data.discountPercent > 0;
  const hasAmount = typeof data.amount === 'number' && data.amount > 0;
  if (!hasPct && !hasAmount) {
    throw new ValidationError('Debes indicar amount o discountPercent (>0)');
  }
  if (hasPct && (data.discountPercent! > 100)) {
    throw new ValidationError('discountPercent debe ser entre 0 y 100');
  }

  const tipoRel = data.tipoRelacion || '01';
  if (!MOTIVOS_NC[tipoRel]) {
    throw new ValidationError(
      `tipoRelacion inválido. Válidos: ${Object.keys(MOTIVOS_NC).join(', ')}`
    );
  }

  return transaction(async (client) => {
    // 1) Verificar factura y obtener saldo
    const invR = await transactionQuery<any>(
      client,
      `SELECT id, customer_id, folio, serie, subtotal, total, tax_transferred,
              status, currency
         FROM invoices
        WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [data.invoiceId, companyId]
    );
    const invoice = invR.rows[0];
    if (!invoice) throw new NotFoundError('Factura no encontrada');
    if (invoice.customer_id !== data.customerId) {
      throw new ValidationError('La factura no pertenece a ese cliente');
    }

    // Calcular saldo restante = total - pagos previos - NC previas
    const sums = await transactionQuery<{ paid: number; nc: number }>(
      client,
      `SELECT
         (SELECT COALESCE(SUM(payment_amount), 0) FROM payments
            WHERE invoice_id = $1 AND deleted_at IS NULL
              AND document_status != 'CANCELLED') AS paid,
         (SELECT COALESCE(SUM(total), 0) FROM credit_notes
            WHERE invoice_id = $1 AND deleted_at IS NULL AND status != 'CANCELLED') AS nc`,
      [invoice.id]
    );
    const total = Number(invoice.total);
    const restante = total - Number(sums.rows[0].paid) - Number(sums.rows[0].nc);

    // Si vino discountPercent, derivamos el amount como % del TOTAL de la factura
    // (caso típico: 5% por pronto pago, 10% por devolución parcial).
    let ncTotal = hasPct
      ? Math.round(total * (data.discountPercent! / 100) * 100) / 100
      : data.amount!;

    if (ncTotal > restante + 0.01) {
      throw new ValidationError(
        `La nota de crédito ($${ncTotal.toFixed(2)}) excede el saldo pendiente ($${restante.toFixed(2)}).`
      );
    }

    // 2) Crear NC con simulación de timbrado
    const folio = await getNextNCFolio(client, companyId);
    const fakeUUID = uuidv4().toUpperCase();

    // IVA contenido en la NC:
    //   1) si lo pasaron explícito, lo usamos;
    //   2) si no, lo prorrateamos usando la proporción IVA/Total de la factura;
    //   3) último fallback: 16%.
    let iva: number;
    if (typeof data.iva === 'number' && data.iva >= 0) {
      iva = data.iva;
    } else if (Number(invoice.tax_transferred) > 0 && Number(invoice.total) > 0) {
      iva = Math.round((ncTotal * (Number(invoice.tax_transferred) / Number(invoice.total))) * 100) / 100;
    } else {
      iva = Math.round((ncTotal - ncTotal / 1.16) * 100) / 100;
    }
    const subtotal = Math.round((ncTotal - iva) * 100) / 100;

    // Datos del emisor y receptor para el XML del NC (mismos que la factura padre).
    // Necesarios para que el atributo NoCertificado + Emisor/Receptor queden en
    // el XML y luego el PDF pueda leerlos con extractTimbreData.
    const compR = await transactionQuery<{ rfc: string; business_name: string; fiscal_regime: string; postal_code: string; csd_no_certificado: string | null }>(
      client,
      `SELECT rfc, business_name, fiscal_regime, postal_code, csd_no_certificado
         FROM companies WHERE id = $1`,
      [companyId]
    );
    const emisor = compR.rows[0];
    const custR = await transactionQuery<{ rfc: string; business_name: string; postal_code: string; fiscal_regime: string }>(
      client,
      `SELECT rfc, business_name, postal_code, fiscal_regime
         FROM customers WHERE id = $1`,
      [data.customerId]
    );
    const receptor = custR.rows[0];
    const noCertEmisor = emisor?.csd_no_certificado || '00001000000506430009';

    // Construye XML CFDI 4.0 tipo E (Egreso) — válido estructuralmente para
    // descarga; mientras estemos en mock PAC, sirve como respaldo del comprobante.
    const motivoText = data.motivo
      || (hasPct ? `${data.discountPercent}% — ${MOTIVOS_NC[tipoRel]}` : MOTIVOS_NC[tipoRel]);
    const moneda = data.currency || invoice.currency || 'MXN';
    const esc = (s: any) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  Version="4.0" Serie="NC" Folio="${folio}"
  Fecha="${new Date().toISOString().slice(0, 19)}"
  NoCertificado="${noCertEmisor}"
  TipoDeComprobante="E" Moneda="${moneda}"
  SubTotal="${subtotal.toFixed(2)}" Total="${ncTotal.toFixed(2)}"
  Exportacion="01" LugarExpedicion="${emisor?.postal_code || '00000'}">
  <cfdi:Emisor Rfc="${esc(emisor?.rfc)}" Nombre="${esc(emisor?.business_name)}"
    RegimenFiscal="${emisor?.fiscal_regime || '601'}"/>
  <cfdi:Receptor Rfc="${esc(receptor?.rfc)}" Nombre="${esc(receptor?.business_name)}"
    DomicilioFiscalReceptor="${receptor?.postal_code || '00000'}"
    RegimenFiscalReceptor="${receptor?.fiscal_regime || '616'}" UsoCFDI="G02"/>
  <cfdi:CfdiRelacionados TipoRelacion="${tipoRel}">
    <cfdi:CfdiRelacionado UUID="${invoice.cfdi_uuid || ''}"/>
  </cfdi:CfdiRelacionados>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" ClaveUnidad="ACT"
      Descripcion="${esc(motivoText)}"
      ValorUnitario="${subtotal.toFixed(2)}" Importe="${subtotal.toFixed(2)}" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados>
        <cfdi:Traslado Base="${subtotal.toFixed(2)}" Impuesto="002" TipoFactor="Tasa"
          TasaOCuota="0.160000" Importe="${iva.toFixed(2)}"/>
      </cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="${iva.toFixed(2)}">
    <cfdi:Traslados>
      <cfdi:Traslado Base="${subtotal.toFixed(2)}" Impuesto="002" TipoFactor="Tasa"
        TasaOCuota="0.160000" Importe="${iva.toFixed(2)}"/>
    </cfdi:Traslados>
  </cfdi:Impuestos>
</cfdi:Comprobante>`;

    const insR = await transactionQuery<any>(
      client,
      `INSERT INTO credit_notes
         (company_id, customer_id, invoice_id, folio, serie,
          tipo_relacion, motivo, subtotal, iva, total, currency,
          date_issued, status, uuid, pac_timestamp, xml_content)
       VALUES ($1,$2,$3,$4,'NC',$5,$6,$7,$8,$9,$10, NOW(), 'STAMPED', $11, NOW(), $12)
       RETURNING *`,
      [
        companyId, data.customerId, invoice.id, folio,
        tipoRel, motivoText,
        subtotal, iva, ncTotal, moneda, fakeUUID, xml,
      ]
    );
    const note = insR.rows[0];

    // 3) Si aplica al saldo: actualizar estado de la factura
    if (data.applyToInvoice !== false) {
      const nuevoCubierto = Number(sums.rows[0].paid) + Number(sums.rows[0].nc) + ncTotal;
      const nuevoStatus = nuevoCubierto >= total - 0.01 ? 'PAID' : 'PARTIAL_PAYMENT';
      await transactionQuery(
        client,
        `UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2`,
        [nuevoStatus, invoice.id]
      );
    }

    // 4) ALMACEN §9 — Devolución de mercancía AUTOMÁTICA en la misma TX:
    //    cada returnItem valida contra las partidas de la factura y genera
    //    CUSTOMER_RETURN al almacén indicado (o al default).
    let returnedCount = 0;
    if (Array.isArray(data.returnItems) && data.returnItems.length > 0) {
      const warehouseId = data.returnWarehouseId
        || await getOrCreateDefaultWarehouse(client, companyId);

      for (const ri of data.returnItems) {
        const qty = Number(ri.quantity);
        if (!ri.productId || !qty || qty <= 0) {
          throw new ValidationError('Cada returnItem requiere productId y quantity > 0');
        }
        // La devolución debe corresponder a lo facturado (producto y tope de cantidad)
        const itR = await transactionQuery<{ invoiced: number }>(
          client,
          `SELECT COALESCE(SUM(quantity), 0) AS invoiced
             FROM invoice_items
            WHERE invoice_id = $1 AND product_id = $2`,
          [invoice.id, ri.productId]
        );
        const invoiced = Number(itR.rows[0].invoiced);
        if (invoiced <= 0) {
          throw new ValidationError(
            `El producto ${ri.productId} no está en la factura ${invoice.serie}-${invoice.folio}`
          );
        }
        // Tope: lo facturado menos lo ya devuelto por NCs previas de esa factura
        const prevR = await transactionQuery<{ returned: number }>(
          client,
          `SELECT COALESCE(SUM(m.quantity), 0) AS returned
             FROM inventory_movements m
             JOIN credit_notes cn ON cn.id = m.reference_id
            WHERE m.reference_type = 'credit_note' AND m.movement_type = 'CUSTOMER_RETURN'
              AND m.product_id = $1 AND cn.invoice_id = $2 AND cn.status != 'CANCELLED'`,
          [ri.productId, invoice.id]
        );
        const alreadyReturned = Number(prevR.rows[0].returned);
        if (qty > invoiced - alreadyReturned) {
          throw new ValidationError(
            `Devolución excede lo facturado: facturado ${invoiced}, ya devuelto ${alreadyReturned}, intentas ${qty}`
          );
        }

        await applyMovementTx(client, {
          companyId,
          productId: ri.productId,
          movementType: 'CUSTOMER_RETURN',
          quantity: qty,
          warehouseToId: warehouseId,
          referenceType: 'credit_note',
          referenceId: note.id,
          reason: `Devolución por NC ${note.serie}-${note.folio} (factura ${invoice.serie}-${invoice.folio})`,
          userEmail: 'credit-note@system',
        });
        returnedCount++;
      }
    }

    logger.info(
      `Nota de Crédito ${note.serie}-${note.folio} creada (motivo ${tipoRel}) ` +
      `por $${ncTotal} contra factura ${invoice.serie}-${invoice.folio}` +
      (hasPct ? ` (${data.discountPercent}% del total)` : '') +
      (returnedCount > 0 ? ` · ${returnedCount} producto(s) devueltos al inventario.` : '.')
    );

    return { ...note, inventory_returns: returnedCount };
  });
}

/**
 * Devuelve saldo de una factura: total, pagado, acreditado por NC, restante,
 * y el detalle de movimientos (pagos + notas de crédito) para mostrar en UI.
 */
export async function getInvoiceBalance(companyId: string, invoiceId: string) {
  // Trae el comprobante padre (CFDI tipo I) con su timbre — esta info se usa
  // tanto para el desglose de saldo como para la "Historia de timbres".
  const invR = await query<any>(
    `SELECT id, folio, serie, total, status, currency, date_issued,
            cfdi_uuid, pac_id, pac_timestamp, is_stamped
       FROM invoices
      WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
    [invoiceId, companyId]
  );
  const invoice = invR.rows[0];
  if (!invoice) throw new NotFoundError('Factura no encontrada');

  const paymentsR = await query<any>(
    // Devolvemos uuid SIN alias para que el frontend (SendMailModal) pueda
    // habilitar el checkbox XML del pago timbrado. Antes venía como
    // payment_uuid y el modal siempre lo veía como null → XML deshabilitado.
    `SELECT id, folio, serie, payment_amount, payment_date, payment_form,
            notes AS reference, uuid, pac_timestamp, document_status
       FROM payments
      WHERE invoice_id = $1 AND deleted_at IS NULL
      ORDER BY payment_date ASC`,
    [invoiceId]
  );
  const ncR = await query<any>(
    `SELECT id, folio, serie, total, date_issued, tipo_relacion, motivo,
            uuid, pac_timestamp, status
       FROM credit_notes
      WHERE invoice_id = $1 AND deleted_at IS NULL AND status != 'CANCELLED'
      ORDER BY date_issued ASC`,
    [invoiceId]
  );

  // paymentsR trae TODOS los pagos (incluidos cancelados) para que el modal
  // Historia pueda mostrarlos con badge 'CANCELADO'. Pero al sumar 'paid'
  // hay que excluir los cancelados o el saldo queda descontando pagos
  // que ya no aplican.
  const paid = paymentsR.rows.reduce(
    (s: number, p: any) => (p.document_status === 'CANCELLED' ? s : s + Number(p.payment_amount)),
    0
  );
  const credited = ncR.rows.reduce((s, n) => s + Number(n.total), 0);
  const total    = Number(invoice.total);
  const remaining = Math.max(0, Math.round((total - paid - credited) * 100) / 100);

  return {
    invoice: {
      id: invoice.id,
      folio: `${invoice.serie}-${invoice.folio}`,
      total,
      currency: invoice.currency,
      status: invoice.status,
      // Timbre del CFDI padre (tipo I — Ingreso)
      cfdi_uuid: invoice.cfdi_uuid,
      is_stamped: invoice.is_stamped,
      pac_id: invoice.pac_id,
      pac_timestamp: invoice.pac_timestamp,
      date_issued: invoice.date_issued,
    },
    totals: {
      total,
      paid:      Math.round(paid * 100) / 100,
      credited:  Math.round(credited * 100) / 100,
      remaining,
    },
    counts: {
      payments:    paymentsR.rows.length,
      creditNotes: ncR.rows.length,
    },
    payments: paymentsR.rows,
    creditNotes: ncR.rows,
  };
}

export async function listCreditNotes(companyId: string, opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const r = await query(
    `SELECT cn.*, c.business_name AS customer_name, c.rfc AS customer_rfc,
            i.serie AS invoice_serie, i.folio AS invoice_folio
       FROM credit_notes cn
       LEFT JOIN customers c ON c.id = cn.customer_id
       LEFT JOIN invoices  i ON i.id = cn.invoice_id
      WHERE cn.company_id = $1 AND cn.deleted_at IS NULL
      ORDER BY cn.date_issued DESC
      LIMIT $2 OFFSET $3`,
    [companyId, limit, offset]
  );
  return { creditNotes: r.rows, total: r.rows.length };
}

export const MOTIVOS = MOTIVOS_NC;

/**
 * Cancela una nota de crédito y recalcula el status de la factura padre.
 * No borra el registro — marca status='CANCELLED' para auditoría.
 *
 * Al cancelar la NC, el saldo de la factura padre aumenta, así que puede
 * cambiar de PAID → PARTIAL_PAYMENT o STAMPED según pagos vigentes.
 */
export async function cancelCreditNote(companyId: string, creditNoteId: string, motivo?: string) {
  return transaction(async (client) => {
    const r = await transactionQuery<any>(
      client,
      `SELECT id, invoice_id, total, status, serie, folio, uuid
         FROM credit_notes WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [creditNoteId, companyId]
    );
    const nc = r.rows[0];
    if (!nc) throw new NotFoundError('Nota de crédito no encontrada');
    if (nc.status === 'CANCELLED') {
      throw new ValidationError('La nota de crédito ya está cancelada');
    }

    await transactionQuery(
      client,
      `UPDATE credit_notes
          SET status = 'CANCELLED',
              motivo = COALESCE(motivo, '') || $1,
              updated_at = NOW()
        WHERE id = $2`,
      [`\n[Cancelada ${new Date().toISOString().slice(0, 19)}]${motivo ? ' — ' + motivo : ''}`, creditNoteId]
    );

    // ALMACEN §9 — Reversa de la devolución automática: si esta NC metió
    // mercancía al inventario (CUSTOMER_RETURN), al cancelarla esa mercancía
    // sale de vuelta (ADJUSTMENT_OUT — no cuenta como venta para rotación).
    // Guard anti-doble-reversa por reference_type='credit_note_cancel'.
    const alreadyReversed = await transactionQuery(
      client,
      `SELECT 1 FROM inventory_movements
        WHERE reference_type = 'credit_note_cancel' AND reference_id = $1 LIMIT 1`,
      [creditNoteId]
    );
    if (alreadyReversed.rows.length === 0) {
      const returns = await transactionQuery<any>(
        client,
        `SELECT product_id, warehouse_to_id, SUM(quantity) AS quantity
           FROM inventory_movements
          WHERE reference_type = 'credit_note' AND reference_id = $1
            AND movement_type = 'CUSTOMER_RETURN'
          GROUP BY product_id, warehouse_to_id`,
        [creditNoteId]
      );
      for (const ret of returns.rows) {
        await applyMovementTx(client, {
          companyId,
          productId: ret.product_id,
          movementType: 'ADJUSTMENT_OUT',
          quantity: Number(ret.quantity),
          warehouseFromId: ret.warehouse_to_id,
          referenceType: 'credit_note_cancel',
          referenceId: creditNoteId,
          reason: `Reversa de devolución — NC ${nc.serie}-${nc.folio} cancelada`,
          userEmail: 'credit-note@system',
        });
      }
      if (returns.rows.length > 0) {
        logger.info(
          `[inventario] Cancelación de NC ${nc.serie}-${nc.folio} revirtió ` +
          `${returns.rows.length} devolución(es) de mercancía`
        );
      }
    }

    // Recalcular status de la factura padre
    if (nc.invoice_id) {
      const invR = await transactionQuery<any>(
        client,
        `SELECT id, total, status FROM invoices WHERE id = $1`,
        [nc.invoice_id]
      );
      const inv = invR.rows[0];
      if (inv && inv.status !== 'CANCELLED') {
        const sumR = await transactionQuery<{ paid: number; credited: number }>(
          client,
          `SELECT
             (SELECT COALESCE(SUM(payment_amount), 0) FROM payments
               WHERE invoice_id = $1 AND deleted_at IS NULL AND document_status != 'CANCELLED') AS paid,
             (SELECT COALESCE(SUM(total), 0) FROM credit_notes
               WHERE invoice_id = $1 AND deleted_at IS NULL AND status != 'CANCELLED') AS credited`,
          [nc.invoice_id]
        );
        const paid = Number(sumR.rows[0].paid) || 0;
        const credited = Number(sumR.rows[0].credited) || 0;
        const total = Number(inv.total);
        let newStatus: string;
        if (paid + credited >= total - 0.01) newStatus = 'PAID';
        else if (paid > 0)                   newStatus = 'PARTIAL_PAYMENT';
        else                                 newStatus = 'STAMPED';
        await transactionQuery(
          client,
          `UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2`,
          [newStatus, nc.invoice_id]
        );
      }
    }

    logger.info(`NC ${nc.serie}-${nc.folio} cancelada. Motivo: ${motivo || 'sin motivo'}`);
    return { id: nc.id, uuid: nc.uuid, status: 'CANCELLED' as const };
  });
}
