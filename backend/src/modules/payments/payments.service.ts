/**
 * Complemento de Pago (CFDI 4.0 tipo P — Anexo 20).
 *
 * Reglas básicas implementadas:
 *  - Una factura con método de pago PPD obliga a emitir Complemento de Pago.
 *  - Cada pago se asocia a una factura. La suma de pagos vs total define el
 *    nuevo estado de la factura:
 *      pagado_acum >= total  → PAID
 *      pagado_acum >  0       → PARTIAL_PAYMENT
 *  - El complemento se TIMBRA con el PAC activo, por el mismo camino que las
 *    facturas (pac.timbrarXml). Si el PAC rechaza, el pago no se guarda.
 */

import { v4 as uuidv4 } from 'uuid';
import { construirPagos20, envolverComplemento, PartidaFiscal } from './pagos20.builder';
import { fmtFechaSAT } from '../cfdi/build-cfdi-json.service';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import { getExchangeRate } from '../exchange-rates/exchange-rate.service';
import * as pacService from '../pac/pac.service';

/**
 * Tipo de cambio del día en que entró el dinero.
 *
 * Se busca por la fecha del pago y no por la de hoy: un pago se puede
 * registrar días después de recibido, y lo que vale es el tipo de cambio del
 * día en que el banco lo acreditó.
 */
async function resolverTipoCambioPago(
  moneda: string,
  fechaPago: string,
): Promise<{ valor: number; fecha: string | null }> {
  if (moneda === 'MXN') return { valor: 1, fecha: null };
  const dia = String(fechaPago).slice(0, 10);
  try {
    const tc = await getExchangeRate(moneda, dia);
    return { valor: tc.valor, fecha: tc.fecha };
  } catch (e: any) {
    // Igual que en facturas: un servicio externo caído no detiene el cobro.
    logger.warn(`[payments] sin tipo de cambio ${moneda} al ${dia}: ${e.message}. Se guarda 1.`);
    return { valor: 1, fecha: null };
  }
}

export interface DocumentoPagado {
  invoiceId: string;
  /** Cuánto de este pago se abona a esta factura. */
  monto: number;
}

export interface PaymentInput {
  /* Forma antigua: una factura. Se conserva porque media docena de llamadas la
   * usan y porque el caso de una sola factura sigue siendo el más común. */
  invoiceId?: string;
  paymentAmount?: number;
  /* Forma nueva: varias facturas en un solo comprobante. El SAT admite varios
   * DoctoRelacionado en un CFDI tipo P, y un depósito que cubre tres facturas
   * debería consumir UN timbre, no tres. Si viene, manda sobre lo anterior. */
  documentos?: DocumentoPagado[];
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
/**
 * Cuántos complementos de pago vigentes lleva ya la factura.
 * El Anexo 20 pide NumParcialidad: este pago es el (previos + 1).
 */
async function contarPagosPrevios(client: any, invoiceId: string): Promise<number> {
  const r = await transactionQuery<{ n: string }>(
    client,
    `SELECT COUNT(*) AS n FROM payments
      WHERE invoice_id = $1 AND deleted_at IS NULL AND document_status != 'CANCELLED'`,
    [invoiceId]
  );
  return Number(r.rows[0]?.n) || 0;
}

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

/** Una factura ya validada, con todo lo que el complemento necesita de ella. */
interface DocumentoValidado {
  invoice: any;
  monto: number;
  saldoAnterior: number;
  saldoInsoluto: number;
  parcialidad: number;
  partidas: PartidaFiscal[];
  pagadoPrevio: number;
  acreditado: number;
  totalFactura: number;
}

export async function createPayment(companyId: string, data: PaymentInput) {
  if (!data.paymentForm) throw new ValidationError('La forma de pago es requerida');

  /* Se normalizan las dos formas de entrada a una sola lista. Todo lo que sigue
   * trabaja con `documentos`, así que el caso de una factura deja de ser un
   * camino aparte: es una lista de uno. */
  const documentos: DocumentoPagado[] = data.documentos?.length
    ? data.documentos
    : (data.invoiceId && data.paymentAmount
        ? [{ invoiceId: data.invoiceId, monto: data.paymentAmount }]
        : []);

  if (!documentos.length) {
    throw new ValidationError('Indica al menos una factura y su monto.');
  }
  for (const d of documentos) {
    if (!d.invoiceId) throw new ValidationError('Falta el identificador de una factura.');
    if (!d.monto || d.monto <= 0) {
      throw new ValidationError('El monto abonado a cada factura debe ser mayor que 0.');
    }
  }
  /* Una factura repetida serían dos DoctoRelacionado con el mismo IdDocumento,
   * y el SAT rechaza el comprobante entero. Mejor detenerlo aquí. */
  const vistos = new Set<string>();
  for (const d of documentos) {
    if (vistos.has(d.invoiceId)) {
      throw new ValidationError('Una misma factura no puede aparecer dos veces en el mismo pago.');
    }
    vistos.add(d.invoiceId);
  }

  const montoTotalPago = Math.round(documentos.reduce((a, d) => a + d.monto, 0) * 100) / 100;

  return transaction(async (client) => {
    /* 1) VALIDAR CADA FACTURA Y REUNIR SUS DATOS.
     *
     * Antes esto era una factura y una comprobación; ahora es un ciclo. Se
     * valida TODO antes de tocar el PAC: si la tercera factura de la lista está
     * cancelada, conviene enterarse antes de gastar el timbre, no después.
     *
     * Las validaciones son las mismas de siempre —existe, no cancelada, no
     * pagada, tiene folio fiscal, el monto cabe en el saldo— sólo que aplicadas
     * a cada una. */
    const docs: DocumentoValidado[] = [];
    let clienteDelPago: string | null = null;

    for (const d of documentos) {
      const invR = await transactionQuery<any>(
        client,
        `SELECT id, company_id, customer_id, folio, serie, total, status, currency,
                cfdi_uuid, payment_method
           FROM invoices
          WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [d.invoiceId, companyId]
      );
      const inv = invR.rows[0];
      if (!inv) throw new NotFoundError(`Factura no encontrada (${d.invoiceId})`);

      const etiqueta = `${inv.serie || ''}${inv.folio}`;
      if (inv.status === 'CANCELLED')
        throw new ValidationError(`La factura ${etiqueta} está cancelada y no se puede pagar.`);
      if (inv.status === 'PAID')
        throw new ValidationError(`La factura ${etiqueta} ya está pagada.`);

      /* SIN FOLIO FISCAL NO HAY COMPLEMENTO POSIBLE.
       * IdDocumento es el UUID de la factura, y el SAT lo valida contra un
       * patrón: si va vacío, el rechazo llega hasta el PAC con un mensaje sobre
       * "datatype String" que no dice nada del problema real. */
      if (!inv.cfdi_uuid) {
        throw new ValidationError(
          `La factura ${etiqueta} no tiene folio fiscal (UUID). ` +
          `Un complemento de pago solo puede referirse a una factura ya timbrada ante el SAT.`
        );
      }

      /* TODAS LAS FACTURAS DEBEN SER DEL MISMO CLIENTE.
       * Un CFDI tiene UN receptor. Mezclar facturas de dos clientes en un
       * comprobante no es una limitación del sistema: es imposible en el
       * Anexo 20, y el SAT lo rechazaría. */
      if (clienteDelPago && inv.customer_id !== clienteDelPago) {
        throw new ValidationError(
          'Todas las facturas de un mismo complemento de pago deben ser del mismo cliente: ' +
          'un CFDI tiene un solo receptor.'
        );
      }
      clienteDelPago = inv.customer_id;

      /* El monto abonado no puede exceder el saldo REAL de esa factura
       * (total − pagos − notas de crédito). Sin considerar las NC se aceptaría
       * un pago que la dejara sobre-cobrada en el sentido fiscal. */
      const pagado = await sumPaidForInvoice(client, inv.id);
      const acreditado = await sumCreditedForInvoice(client, inv.id);
      const totalInv = Number(inv.total);
      const restante = totalInv - pagado - acreditado;
      if (d.monto > restante + 0.01) {
        throw new ValidationError(
          `El abono a la factura ${etiqueta} ($${d.monto.toFixed(2)}) excede su saldo ` +
          `($${restante.toFixed(2)}).`
        );
      }

      const partidasR = await transactionQuery<PartidaFiscal>(
        client,
        `SELECT COALESCE(subtotal, 0)::float       AS subtotal,
                COALESCE(tax_rate, 0)::float       AS tax_rate,
                COALESCE(is_exempt, false)         AS is_exempt,
                COALESCE(ret_iva_rate, 0)::float   AS ret_iva_rate,
                COALESCE(ret_isr_rate, 0)::float   AS ret_isr_rate,
                COALESCE(ieps_rate, 0)::float      AS ieps_rate
           FROM invoice_items
          WHERE invoice_id = $1
          ORDER BY line_number`,
        [inv.id]
      );
      if (!partidasR.rows.length) {
        throw new ValidationError(
          `La factura ${etiqueta} no tiene partidas, así que no se puede determinar ` +
          `qué impuestos declarar en el complemento.`
        );
      }

      docs.push({
        invoice: inv,
        monto: d.monto,
        saldoAnterior: restante,
        saldoInsoluto: Math.max(0, restante - d.monto),
        parcialidad: (await contarPagosPrevios(client, inv.id)) + 1,
        partidas: partidasR.rows,
        pagadoPrevio: pagado,
        acreditado,
        totalFactura: totalInv,
      });
    }

    /* La factura "principal" es la primera. Se usa para la moneda del pago, para
     * payments.invoice_id —que se conserva por compatibilidad— y para el
     * receptor del comprobante, que es el mismo para todas. */
    const invoice = docs[0].invoice;
    const total = docs[0].totalFactura;
    const alreadyPaid = docs[0].pagadoPrevio;
    const alreadyCredited = docs[0].acreditado;

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
    /* FECHA EN HORA DEL LUGAR DE EXPEDICIÓN, NO EN UTC.
     * Render corre en UTC y el SAT valida contra hora de México: mandar
     * toISOString() nos ponía 6 horas en el futuro y el PAC rechazaba con "la
     * fecha de emisión no se encuentra en el rango permitido". Es la misma
     * función que usan las facturas —por eso ellas sí timbran— y ahora se
     * comparte en vez de duplicar el formateo.
     *
     * data.paymentDate es la fecha en que el cliente pagó (puede ser pasada) y
     * va en FechaPago; la fecha del comprobante es SIEMPRE la de emisión. Antes
     * se usaba la misma para las dos, así que un pago capturado días después
     * emitía un comprobante con fecha vieja. */
    const fechaEmision = fmtFechaSAT(new Date());
    const fechaISO = data.paymentDate
      ? fmtFechaSAT(new Date(data.paymentDate))
      : fechaEmision;
    const moneda = data.currency || invoice.currency || 'MXN';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:pago20="http://www.sat.gob.mx/Pagos20"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd http://www.sat.gob.mx/Pagos20 http://www.sat.gob.mx/sitio_internet/cfd/Pagos/Pagos20.xsd"
  Version="4.0" Serie="P" Folio="${folio}"
  Fecha="${fechaEmision}"
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
      <pago20:Pago FechaPago="${fechaISO}"
        FormaDePagoP="${data.paymentForm}" MonedaP="${moneda}"
        Monto="${montoTotalPago.toFixed(2)}">
        <pago20:DoctoRelacionado IdDocumento="${invoice.cfdi_uuid || ''}"
          MonedaDR="${moneda}" NumParcialidad="1"
          ImpSaldoAnt="${Number(total - alreadyPaid - alreadyCredited).toFixed(2)}"
          ImpPagado="${docs[0].monto.toFixed(2)}"
          ImpSaldoInsoluto="${docs[0].saldoInsoluto.toFixed(2)}"
          ObjetoImpDR="01"/>
      </pago20:Pago>
    </pago20:Pagos>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

    /* ── TIMBRADO REAL DEL COMPLEMENTO ────────────────────────────────────
     * Antes aquí había `const fakeUUID = uuidv4()`: se inventaba un folio
     * fiscal, la factura pasaba a PAID y el saldo a cero, pero el SAT nunca
     * recibía nada. En un CFDI PPD el complemento de pago es obligación legal
     * dentro de los primeros días del mes siguiente, así que el hueco no era
     * de presentación: era fiscal.
     *
     * Ahora pasa por el MISMO camino que las facturas (pac.timbrarXml), con el
     * PAC que digan las variables de entorno. Si falla, se lanza el error y la
     * transacción revierte: un pago que no se timbró NO puede quedar guardado
     * como timbrado ni bajar el saldo del cliente.
     */
    /* El MISMO comprobante en el payload JSON que espera la ruta de EMISIÓN.
     * Esto es lo que faltaba: el XML de arriba iba a /cfdi33/stamp/v4, que
     * exige un XML ya sellado, y el nuestro va sin sellar a propósito porque
     * SW sella con el CSD de su bóveda. El XML se conserva como respaldo para
     * el provider MOCK, que no implementa la ruta JSON. */
    /* Los saldos y la parcialidad de cada factura se calcularon en el ciclo de
     * validación; aquí sólo se usa el total del pago. */
    const montoPago = montoTotalPago;
    const parcialidad = (await contarPagosPrevios(client, invoice.id)) + 1;

    /* LOS IMPUESTOS SE LEEN DE LA FACTURA, NO SE SUPONEN.
     *
     * Antes se calculaba aquí un IVA del 16% fijo. Funcionaba porque todas las
     * facturas eran al 16%, pero una exenta, una a tasa 0% o una con retención
     * producía un complemento que el SAT rechaza — y el rechazo llega al
     * timbrar, que es el momento más caro para enterarse.
     *
     * Ahora se leen las tasas reales de las partidas y pagos20.builder deriva
     * de ellas el nodo completo: traslados, retenciones, exentos, ObjetoImpDR y
     * los totales por tasa. */
    const partidasR = await transactionQuery<PartidaFiscal>(
      client,
      `SELECT COALESCE(subtotal, 0)::float       AS subtotal,
              COALESCE(tax_rate, 0)::float       AS tax_rate,
              COALESCE(is_exempt, false)         AS is_exempt,
              COALESCE(ret_iva_rate, 0)::float   AS ret_iva_rate,
              COALESCE(ret_isr_rate, 0)::float   AS ret_isr_rate,
              COALESCE(ieps_rate, 0)::float      AS ieps_rate
         FROM invoice_items
        WHERE invoice_id = $1
        ORDER BY line_number`,
      [invoice.id]
    );
    if (!partidasR.rows.length) {
      throw new ValidationError(
        `La factura ${invoice.serie || ''}${invoice.folio} no tiene partidas, ` +
        `así que no se puede determinar qué impuestos declarar en el complemento.`
      );
    }
    const payloadPago: any = {
      Version: '4.0',
      Serie: 'P',
      Folio: String(folio),
      Fecha: fechaEmision,
      // En un CFDI tipo P el comprobante NO lleva importes ni forma de pago:
      // todo vive en el complemento. Moneda XXX y totales en cero (Anexo 20).
      SubTotal: '0',
      Moneda: 'XXX',
      Total: '0',
      TipoDeComprobante: 'P',
      Exportacion: '01',
      LugarExpedicion: emisor?.postal_code || '00000',
      Emisor: {
        Rfc: emisor?.rfc || '',
        Nombre: emisor?.business_name || '',
        RegimenFiscal: emisor?.fiscal_regime || '601',
      },
      Receptor: {
        Rfc: receptor?.rfc || '',
        Nombre: receptor?.business_name || '',
        DomicilioFiscalReceptor: receptor?.postal_code || '00000',
        RegimenFiscalReceptor: receptor?.fiscal_regime || '616',
        UsoCFDI: 'CP01',
      },
      Conceptos: [{
        ClaveProdServ: '84111506',
        Cantidad: '1',
        ClaveUnidad: 'ACT',
        Descripcion: 'Pago',
        ValorUnitario: '0',
        Importe: '0',
        ObjetoImp: '01',
      }],
      /* El complemento lo arma pagos20.builder a partir de los impuestos
       * reales de la factura. La envoltura —Complemento.Any[] con la llave
       * prefijada 'pago20:Pagos'— también vive ahí, junto a la explicación de
       * por qué sin el prefijo SW la descarta en silencio. */
      /* Se manda UN documento porque la pantalla registra el pago contra una
       * factura a la vez. El constructor acepta la lista completa: cuando la
       * interfaz permita seleccionar varias, aquí sólo cambia el arreglo. */
      /* TODAS las facturas del pago van en el mismo complemento. El SAT admite
       * varios DoctoRelacionado en un CFDI tipo P, así que un depósito que cubre
       * tres facturas consume UN timbre y el cliente recibe UN comprobante — no
       * tres, como antes. */
      Complemento: envolverComplemento(construirPagos20({
        documentos: docs.map((d) => ({
          partidas: d.partidas,
          totalFactura: d.totalFactura,
          montoPagado: d.monto,
          saldoAnterior: d.saldoAnterior,
          saldoInsoluto: d.saldoInsoluto,
          parcialidad: d.parcialidad,
          uuid: d.invoice.cfdi_uuid,
          serie: d.invoice.serie,
          folio: d.invoice.folio,
          metodoPago: d.invoice.payment_method,
          monedaDR: d.invoice.currency || 'MXN',
        })),
        monedaP: moneda,
        fechaPago: fechaISO,
        formaPago: data.paymentForm,
      })),
    };

    const timbre = await pacService.timbrarJson(companyId, payloadPago, xml);
    if (!timbre.success) {
      throw new ValidationError(
        `No se pudo timbrar el complemento de pago: ${timbre.errors.join('; ')}. ` +
        `El pago NO se registró — corrige y vuelve a intentar.`
      );
    }
    const uuidTimbrado = (timbre.uuid || '').toUpperCase();
    if (!uuidTimbrado) {
      throw new ValidationError(
        'El PAC no devolvió UUID para el complemento de pago. El pago NO se registró.'
      );
    }
    // El XML timbrado trae el Timbre Fiscal Digital; si el provider no lo
    // devuelve, se conserva el que armamos (caso de providers legacy).
    const xmlFinal = timbre.xml_stamped || xml;

    // Tipo de cambio del DÍA DEL PAGO, no el de la factura.
    //
    // Se facturaron 1 000 USD a 17.50 y cobran 15 días después a 18.00:
    // llegan los mismos 1 000 USD pero 500 pesos más. Esa diferencia es
    // utilidad cambiaria y solo se puede calcular si aquí queda guardado el
    // tipo de cambio de hoy en lugar de reusar el de la factura.
    const tcPago = await resolverTipoCambioPago(moneda, fechaISO);
    const montoMxn = Math.round(montoTotalPago * tcPago.valor * 100) / 100;

    const insR = await transactionQuery<any>(
      client,
      `INSERT INTO payments
         (company_id, invoice_id, customer_id, folio, serie,
          payment_amount, payment_date, payment_form, payment_method,
          currency, document_status, uuid, pac_timestamp, notes, xml_content,
          exchange_rate, exchange_rate_date, payment_amount_mxn)
       VALUES ($1,$2,$3,$4,'P',$5,$6,$7,$8,$9,'STAMPED',$10, NOW(), $11, $12,
               $13,$14,$15)
       RETURNING *`,
      [
        companyId, invoice.id, invoice.customer_id, folio,
        montoTotalPago, fechaISO, data.paymentForm,
        data.paymentMethod || 'PUE',
        moneda, uuidTimbrado, data.notes || null, xmlFinal,
        tcPago.valor, tcPago.fecha, montoMxn,
      ]
    );
    const payment = insR.rows[0];

    /* 4) EL DESGLOSE: qué facturas cubre este pago y cuánto a cada una.
     *
     * payments.invoice_id sigue apuntando a la primera por compatibilidad, pero
     * la verdad de un pago multi-factura vive aquí. Se guardan también los
     * saldos y la parcialidad TAL COMO SE ENVIARON al SAT: el comprobante ya se
     * timbró con esos valores, y recalcularlos después con los saldos de hoy
     * mostraría cifras distintas a las del CFDI. */
    for (const d of docs) {
      await transactionQuery(
        client,
        `INSERT INTO payment_invoices
           (payment_id, invoice_id, monto, parcialidad, saldo_anterior, saldo_insoluto)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [payment.id, d.invoice.id, d.monto, d.parcialidad, d.saldoAnterior, d.saldoInsoluto]
      );
    }

    /* 5) Estatus de CADA factura. Cubierto = pagos acumulados + notas de
     * crédito; con tolerancia de un centavo por redondeos. */
    const estados: Array<{ id: string; etiqueta: string; nuevo: string; restante: number }> = [];
    for (const d of docs) {
      const nuevoPagadoInv = d.pagadoPrevio + d.monto;
      const cubiertoInv = nuevoPagadoInv + d.acreditado;
      const nuevo = cubiertoInv >= d.totalFactura - 0.01 ? 'PAID' : 'PARTIAL_PAYMENT';
      await transactionQuery(
        client,
        `UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2`,
        [nuevo, d.invoice.id]
      );
      estados.push({
        id: d.invoice.id,
        etiqueta: `${d.invoice.serie || ''}${d.invoice.folio}`,
        nuevo,
        restante: Math.max(0, d.totalFactura - cubiertoInv),
      });
    }
    const nuevoStatus = estados[0].nuevo;
    const nuevoPagado = docs[0].pagadoPrevio + docs[0].monto;
    const cubierto = nuevoPagado + docs[0].acreditado;

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
      `Pago ${payment.serie}-${payment.folio} por $${montoTotalPago.toFixed(2)} sobre ` +
      `${docs.length} factura(s): ${estados.map((e) => `${e.etiqueta}→${e.nuevo}`).join(', ')}`
    );

    return {
      payment,
      // Quién timbró, para que la pantalla no tenga que suponerlo. El mensaje
      // decía "MODO SIMULACIÓN" con texto fijo aunque el PAC fuera real.
      provider: pacService.proveedorActivo(),
      is_mock: pacService.proveedorActivo() === 'MOCK',
      invoice: {
        id: invoice.id,
        new_status: nuevoStatus,
        paid_total: nuevoPagado,
        credited_total: alreadyCredited,
        remaining: Math.max(0, total - cubierto),
      },
      /* Detalle por factura, para cuando el pago cubre más de una. */
      facturas: estados,
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
 * SE CANCELA ANTE EL SAT, NO SOLO EN LA TABLA.
 *
 * Aquí decía "en producción con PAC real, aquí también invocaríamos el endpoint
 * de cancelación del PAC. Por ahora solo estado local" — y ese "por ahora" se
 * quedó. La función hacía únicamente UPDATE payments, así que el sistema
 * mostraba el complemento cancelado y el SAT lo seguía teniendo VIGENTE.
 *
 * Es el mismo defecto que tenían las notas de crédito, con la misma
 * consecuencia: el SAT no deja cancelar una factura que tiene comprobantes
 * vivos apuntándole, así que un complemento fantasma la deja "No cancelable"
 * para siempre y nada en la pantalla explica por qué.
 *
 * La llamada al PAC va ANTES de tocar la base y FUERA de la transacción: si el
 * SAT rechaza, no se escribe nada.
 */
export async function cancelPayment(
  companyId: string,
  paymentId: string,
  motivo?: string,
  /* Clave de c_MotivoCancelacion (Anexo 20). Distinta del `motivo` en texto
   * libre, que es la nota interna del registro. */
  motivoSat: string = '02',
  folioSustitucion?: string,
  /* Cancelar sólo en el sistema. Para reflejar aquí algo ya cancelado desde el
   * panel del PAC; no es el camino normal. */
  soloLocal = false,
) {
  const previaR = await query<any>(
    `SELECT id, document_status, uuid, serie, folio FROM payments
      WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
    [paymentId, companyId]
  );
  const previa = previaR.rows[0];
  if (!previa) throw new NotFoundError('Complemento de pago no encontrado');

  if (!soloLocal) {
    if (!previa.uuid) {
      throw new ValidationError(
        'Este complemento de pago no tiene folio fiscal, así que nunca se timbró ' +
        'ante el SAT. Usa la cancelación local para retirarlo del sistema.'
      );
    }
    const res = await pacService.cancelarComprobante(
      companyId, previa.uuid, motivoSat, folioSustitucion);
    if (!res.success) {
      throw new ValidationError(
        `El SAT no aceptó la cancelación de ${previa.serie}-${previa.folio}: ` +
        `${res.errors.join('; ')}. No se modificó nada en el sistema.`
      );
    }
  }

  return transaction(async (client) => {
    const r = await transactionQuery<any>(
      client,
      `SELECT id, invoice_id, payment_amount, document_status, uuid, serie, folio
         FROM payments WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [paymentId, companyId]
    );
    const pay = r.rows[0];
    if (!pay) throw new NotFoundError('Complemento de pago no encontrado');
    /* Ya no se aborta si el estado local dice CANCELLED: ese candado impedía
     * reparar un desajuste con el SAT, que es justo lo que hay que poder hacer. */
    if (pay.document_status === 'CANCELLED' && soloLocal) {
      throw new ValidationError('El complemento de pago ya está cancelado en el sistema.');
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
       /* Los JOIN también llevan la empresa.
        *
        * El WHERE de abajo ya impide que se cuele un pago ajeno, así que esto
        * no tapa una fuga: tapa una MEZCLA. Si por una carga mal hecha un pago
        * apuntara a una factura de otra empresa, sin esta condición la lista
        * mostraría el folio y el cliente de la otra junto al pago propio, y
        * nadie lo notaría. Con ella, la columna sale vacía —que es visible— en
        * vez de salir con el dato equivocado. */
       LEFT JOIN invoices  i ON i.id = p.invoice_id  AND i.company_id = p.company_id
       LEFT JOIN customers c ON c.id = p.customer_id AND c.company_id = p.company_id
      WHERE p.company_id = $1 AND p.deleted_at IS NULL
      /* Por fecha y, dentro del mismo día, por folio descendente.
       *
       * Sin el segundo criterio, los complementos del mismo día salían en el
       * orden en que Postgres los devolviera —P-000005, P-000006, P-000004— y
       * la lista parecía desordenada justo donde el folio es consecutivo. El
       * folio se ordena como NÚMERO y no como texto: "P-000010" iría antes que
       * "P-000009" en orden alfabético. */
      ORDER BY p.payment_date DESC,
               NULLIF(regexp_replace(COALESCE(p.folio, ''), '\D', '', 'g'), '')::bigint DESC NULLS LAST,
               p.created_at DESC
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
