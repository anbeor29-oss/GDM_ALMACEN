/**
 * Complemento de Pago (CFDI 4.0 tipo P — Anexo 20).
 *
 * Reglas básicas implementadas:
 *  - Una factura con método de pago PPD obliga a emitir Complemento de Pago.
 *  - Cada pago se asocia a una factura. La suma de pagos vs total define el
 *    nuevo estado de la factura:
 *      pagado_acum >= total  → PAID
 *      pagado_acum >  0       → PARTIAL_PAYMENT
 *  - Se simula timbrado vía MockPACProvider (mismo flujo que el CFDI normal).
 */

import { v4 as uuidv4 } from 'uuid';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

export interface PaymentInput {
  invoiceId: string;
  paymentAmount: number;
  paymentDate?: string;       // ISO; default = hoy
  paymentForm: string;        // c_FormaPago (01 efectivo, 03 transferencia, etc.)
  paymentMethod?: string;     // PUE/PPD — opcional, se hereda de la factura
  currency?: string;          // ISO 4217 (default = la moneda de la factura)
  notes?: string;
}

/* ─────────────── helpers ─────────────── */

async function getNextPaymentFolio(client: any, companyId: string): Promise<number> {
  const r = await transactionQuery<{ folio: number }>(
    client,
    `SELECT COALESCE(MAX(folio), 0) + 1 AS folio
       FROM payments
      WHERE company_id = $1`,
    [companyId]
  );
  return r.rows[0]?.folio || 1;
}

async function sumPaidForInvoice(client: any, invoiceId: string): Promise<number> {
  const r = await transactionQuery<{ paid: number }>(
    client,
    `SELECT COALESCE(SUM(payment_amount), 0) AS paid
       FROM payments
      WHERE invoice_id = $1 AND deleted_at IS NULL
        AND document_status != 'CANCELLED'`,
    [invoiceId]
  );
  return Number(r.rows[0]?.paid) || 0;
}

/**
 * Suma el total de NCs vigentes (no canceladas) contra la factura.
 * Necesario para calcular el saldo REAL: total - pagos - NC. Sin esto una
 * factura como FAC-000006 (total 5,204.16) con una NC de 260.21 y un pago
 * de 4,943.95 quedaba en PARTIAL_PAYMENT porque solo se comparaba el pago
 * con el total, ignorando la NC ya aplicada.
 */
async function sumCreditedForInvoice(client: any, invoiceId: string): Promise<number> {
  const r = await transactionQuery<{ credited: number }>(
    client,
    `SELECT COALESCE(SUM(total), 0) AS credited
       FROM credit_notes
      WHERE invoice_id = $1
        AND deleted_at IS NULL
        AND status != 'CANCELLED'`,
    [invoiceId]
  );
  return Number(r.rows[0]?.credited) || 0;
}

/* ─────────────── crear complemento de pago ─────────────── */

export async function createPayment(companyId: string, data: PaymentInput) {
  if (!data.invoiceId) throw new ValidationError('invoiceId es requerido');
  if (!data.paymentAmount || data.paymentAmount <= 0)
    throw new ValidationError('El monto del pago debe ser mayor que 0');
  if (!data.paymentForm) throw new ValidationError('La forma de pago es requerida');

  return transaction(async (client) => {
    // 1) Validar factura
    const invR = await transactionQuery<any>(
      client,
      `SELECT id, company_id, customer_id, folio, serie, total, status, currency
         FROM invoices
        WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [data.invoiceId, companyId]
    );
    const invoice = invR.rows[0];
    if (!invoice) throw new NotFoundError('Factura no encontrada');
    if (invoice.status === 'CANCELLED')
      throw new ValidationError('No se puede pagar una factura cancelada');
    if (invoice.status === 'PAID')
      throw new ValidationError('Esta factura ya está pagada');

    // 2) Validar que no excedamos el saldo REAL (total − pagos − NC).
    //    Sin considerar NC podríamos aceptar un pago que dejara la factura
    //    "sobre-cobrada" en el sentido fiscal.
    const alreadyPaid = await sumPaidForInvoice(client, invoice.id);
    const alreadyCredited = await sumCreditedForInvoice(client, invoice.id);
    const total = Number(invoice.total);
    const restante = total - alreadyPaid - alreadyCredited;
    if (data.paymentAmount > restante + 0.01) {
      throw new ValidationError(
        `El pago ($${data.paymentAmount.toFixed(2)}) excede el saldo restante ($${restante.toFixed(2)}).`
      );
    }

    // 3) Insertar pago + simular timbrado (con XML CFDI 4.0 + Pagos 2.0)
    //    Necesitamos datos del emisor y receptor para que el XML del
    //    complemento de pago quede consistente con la representación
    //    impresa (NoCertificado, RFCs, etc.). En sandbox SW usamos el
    //    cert de prueba si el CSD del emisor aún no está cargado en BD.
    const compEmisorR = await transactionQuery<{ rfc: string; business_name: string; fiscal_regime: string; postal_code: string; csd_no_certificado: string | null }>(
      client,
      `SELECT rfc, business_name, fiscal_regime, postal_code, csd_no_certificado
         FROM companies WHERE id = $1`,
      [companyId]
    );
    const emisor = compEmisorR.rows[0];
    const custR = await transactionQuery<{ rfc: string; business_name: string; postal_code: string; fiscal_regime: string }>(
      client,
      `SELECT rfc, business_name, postal_code, fiscal_regime
         FROM customers WHERE id = $1`,
      [invoice.customer_id]
    );
    const receptor = custR.rows[0];
    const noCertEmisor = emisor?.csd_no_certificado || '00001000000506430009';

    const folio = await getNextPaymentFolio(client, companyId);
    const fakeUUID = uuidv4().toUpperCase(); // simulación MOCK
    const fechaISO = data.paymentDate || new Date().toISOString();
    const moneda = data.currency || invoice.currency || 'MXN';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:pago20="http://www.sat.gob.mx/Pagos20"
  Version="4.0" Serie="P" Folio="${folio}"
  Fecha="${fechaISO.slice(0, 19)}"
  NoCertificado="${noCertEmisor}"
  TipoDeComprobante="P" Moneda="XXX" SubTotal="0" Total="0" Exportacion="01"
  LugarExpedicion="${emisor?.postal_code || '00000'}">
  <cfdi:Emisor Rfc="${emisor?.rfc || ''}" Nombre="${(emisor?.business_name || '').replace(/"/g, '&quot;')}"
    RegimenFiscal="${emisor?.fiscal_regime || '601'}"/>
  <cfdi:Receptor Rfc="${receptor?.rfc || ''}" Nombre="${(receptor?.business_name || '').replace(/"/g, '&quot;')}"
    DomicilioFiscalReceptor="${receptor?.postal_code || '00000'}"
    RegimenFiscalReceptor="${receptor?.fiscal_regime || '616'}" UsoCFDI="CP01"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" ClaveUnidad="ACT"
      Descripcion="Pago" ValorUnitario="0" Importe="0" ObjetoImp="01"/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <pago20:Pagos Version="2.0">
      <pago20:Pago FechaPago="${fechaISO.slice(0, 19)}"
        FormaDePagoP="${data.paymentForm}" MonedaP="${moneda}"
        Monto="${Number(data.paymentAmount).toFixed(2)}">
        <pago20:DoctoRelacionado IdDocumento="${invoice.cfdi_uuid || ''}"
          MonedaDR="${moneda}" NumParcialidad="1"
          ImpSaldoAnt="${Number(total - alreadyPaid - alreadyCredited).toFixed(2)}"
          ImpPagado="${Number(data.paymentAmount).toFixed(2)}"
          ImpSaldoInsoluto="${Math.max(0, total - alreadyPaid - alreadyCredited - data.paymentAmount).toFixed(2)}"
          ObjetoImpDR="01"/>
      </pago20:Pago>
    </pago20:Pagos>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

    const insR = await transactionQuery<any>(
      client,
      `INSERT INTO payments
         (company_id, invoice_id, customer_id, folio, serie,
          payment_amount, payment_date, payment_form, payment_method,
          currency, document_status, uuid, pac_timestamp, notes, xml_content)
       VALUES ($1,$2,$3,$4,'P',$5,$6,$7,$8,$9,'STAMPED',$10, NOW(), $11, $12)
       RETURNING *`,
      [
        companyId, invoice.id, invoice.customer_id, folio,
        data.paymentAmount, fechaISO, data.paymentForm,
        data.paymentMethod || 'PUE',
        moneda, fakeUUID, data.notes || null, xml,
      ]
    );
    const payment = insR.rows[0];

    // 4) Actualizar estatus de la factura. Cubierto = pagos acumulados + NC.
    //    Si cubierto ≥ total (con tolerancia de 1 centavo por redondeos)
    //    la factura queda PAID; si no, PARTIAL_PAYMENT.
    const nuevoPagado = alreadyPaid + data.paymentAmount;
    const cubierto = nuevoPagado + alreadyCredited;
    const nuevoStatus = cubierto >= total - 0.01 ? 'PAID' : 'PARTIAL_PAYMENT';
    await transactionQuery(
      client,
      `UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2`,
      [nuevoStatus, invoice.id]
    );

    // 5) Recalcular saldo del cliente (best-effort)
    await transactionQuery(
      client,
      `UPDATE customers SET balance = COALESCE((
          SELECT SUM(i.total) - COALESCE(SUM(p.payment_amount), 0)
            FROM invoices i
            LEFT JOIN payments p ON p.invoice_id = i.id
              AND p.deleted_at IS NULL
              AND p.document_status != 'CANCELLED'
           WHERE i.customer_id = customers.id
             AND i.status IN ('SENT','STAMPED','PARTIAL_PAYMENT')
             AND i.deleted_at IS NULL
        ), 0)
        WHERE id = $1`,
      [invoice.customer_id]
    );

    logger.info(
      `Pago ${payment.serie}-${payment.folio} creado para factura ${invoice.serie}-${invoice.folio} ` +
      `($${data.paymentAmount}). Estatus ahora: ${nuevoStatus}.`
    );

    return {
      payment,
      invoice: {
        id: invoice.id,
        new_status: nuevoStatus,
        paid_total: nuevoPagado,
        credited_total: alreadyCredited,
        remaining: Math.max(0, total - cubierto),
      },
    };
  });
}

/* ─────────────── cancelación ─────────────── */

/**
 * Cancela un complemento de pago (marca document_status='CANCELLED') y
 * recalcula el status de la factura padre (PAID / PARTIAL_PAYMENT / STAMPED
 * según pagos vigentes + NC vigentes). No borra el registro — mantiene la
 * huella para auditoría/SAT.
 *
 * En producción con PAC real, aquí también invocaríamos el endpoint de
 * cancelación del PAC. Por ahora solo estado local.
 */
export async function cancelPayment(companyId: string, paymentId: string, motivo?: string) {
  return transaction(async (client) => {
    const r = await transactionQuery<any>(
      client,
      `SELECT id, invoice_id, payment_amount, document_status, uuid, serie, folio
         FROM payments WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [paymentId, companyId]
    );
    const pay = r.rows[0];
    if (!pay) throw new NotFoundError('Complemento de pago no encontrado');
    if (pay.document_status === 'CANCELLED') {
      throw new ValidationError('El complemento de pago ya está cancelado');
    }

    await transactionQuery(
      client,
      `UPDATE payments
          SET document_status = 'CANCELLED',
              notes = COALESCE(notes, '') || $1,
              updated_at = NOW()
        WHERE id = $2`,
      [`\n[Cancelado ${new Date().toISOString().slice(0, 19)}]${motivo ? ' — ' + motivo : ''}`, paymentId]
    );

    // Recalcular status de la factura padre (excluyendo pagos cancelados)
    const invR = await transactionQuery<any>(
      client,
      `SELECT id, total, status FROM invoices WHERE id = $1`,
      [pay.invoice_id]
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
        [pay.invoice_id]
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
        [newStatus, pay.invoice_id]
      );
    }

    logger.info(`Complemento de pago ${pay.serie}-${pay.folio} cancelado. Motivo: ${motivo || 'sin motivo'}`);
    return { id: pay.id, uuid: pay.uuid, status: 'CANCELLED' as const };
  });
}

/* ─────────────── lectura ─────────────── */

export async function listPayments(companyId: string, opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const r = await query(
    `SELECT p.*, i.serie AS invoice_serie, i.folio AS invoice_folio,
            c.business_name AS customer_name, c.rfc AS customer_rfc
       FROM payments p
       LEFT JOIN invoices  i ON i.id = p.invoice_id
       LEFT JOIN customers c ON c.id = p.customer_id
      WHERE p.company_id = $1 AND p.deleted_at IS NULL
      ORDER BY p.payment_date DESC
      LIMIT $2 OFFSET $3`,
    [companyId, limit, offset]
  );
  return { payments: r.rows, total: r.rows.length };
}

export async function getPaymentsByInvoice(companyId: string, invoiceId: string) {
  const r = await query(
    `SELECT * FROM payments
      WHERE company_id = $1 AND invoice_id = $2 AND deleted_at IS NULL
      ORDER BY payment_date ASC`,
    [companyId, invoiceId]
  );
  return r.rows;
}
