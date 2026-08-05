/**
 * cobro-prepago.service — el aviso de cobro y el CFDI de HCGM del prepago.
 *
 * DÓNDE ENCAJA
 * El cierre mensual (`issue-invoice.service`) cobra lo YA consumido. Esto cobra
 * POR ADELANTADO, al contratar. Son dos momentos y dos tablas distintas, pero
 * el CFDI es la misma máquina —mismo emisor, mismo cliente, mismo producto de
 * servicio—, así que reusa los ayudantes de aquel módulo en vez de duplicarlos:
 * una segunda copia se desincronizaría a la primera corrección fiscal.
 *
 * EL ORDEN IMPORTA, Y ES EL DEL DINERO
 *   contratar → aviso de cobro (sin CFDI) → entra el pago → CFDI + servicio
 *
 * La factura NO se emite al avisar. Al ser prepago, un CFDI emitido antes de
 * cobrar queda vigente ante el SAT si el cliente nunca paga, y hay que
 * cancelarlo — con el trámite y la ventana de 72 horas que eso implica.
 */

import { query } from '../../config/database';
import logger from '../../middleware/logger';
import * as invoicesService from '../invoices/invoices.service';
import * as pacService from '../pac/pac.service';
import { sendInvoiceMail, sendPlainMail } from '../mailer/mailer.service';
import {
  getPlatformCompany,
  upsertPlatformCustomer,
  upsertPlatformProduct,
  IssueResult,
} from './issue-invoice.service';

/** Cargo prepago con los datos fiscales del cliente ya resueltos. */
async function cargarCargo(chargeId: string) {
  const r = await query<any>(
    `SELECT pc.*, c.rfc AS client_rfc, c.business_name AS client_name,
            c.fiscal_regime AS client_regime, c.postal_code AS client_cp,
            c.contact_email AS client_email
       FROM plan_charges pc
       JOIN companies c ON c.id = pc.company_id
      WHERE pc.id = $1`,
    [chargeId]
  );
  return r.rows[0] || null;
}

const f2 = (n: any) => Number(n).toFixed(2);
const dia = (d: any) => String(d).slice(0, 10);

/**
 * Manda el aviso de cobro: cuánto, por qué días, y qué pasa al pagar.
 *
 * Correo simple, sin CFDI adjunto — ver la nota de arriba sobre el orden.
 *
 * NUNCA LANZA. Un cargo que se creó bien no debe deshacerse porque el servidor
 * de correo esté caído. Pero `notified_at` se marca sólo si el envío salió, de
 * modo que la lista de pendientes distinga "ya le avisé" de "creí que le avisé"
 * — que es la diferencia entre un cliente que no ha pagado y uno que nunca se
 * enteró de que debía pagar.
 */
export async function enviarAvisoDeCobro(chargeId: string): Promise<{ enviado: boolean; detalle: string }> {
  const ch = await cargarCargo(chargeId);
  if (!ch) return { enviado: false, detalle: 'Cargo no encontrado' };
  if (!ch.client_email) {
    return { enviado: false, detalle: 'La empresa no tiene correo de contacto — avísale por otra vía' };
  }

  const platform = await getPlatformCompany();
  const periodo = String(ch.billing_period).slice(0, 7);
  const emisor = platform?.business_name || 'GRUPO HCGM, S.A. DE C.V.';

  /* El desglose del prorrateo va en el cuerpo porque es LA pregunta de quien
   * recibe el aviso: por qué $218.81 y no $399. Si no viene escrito, la
   * respuesta la tiene que dar alguien por teléfono. */
  const proporcional = Number(ch.days_charged) < Number(ch.days_in_month);
  const cuerpo =
    `Gracias por contratar el servicio de facturación electrónica.\n\n` +
    `Plan: ${ch.package_code}\n` +
    `Periodo: del ${dia(ch.starts_on)} al ${dia(ch.ends_on)}\n\n` +
    (proporcional
      ? `Se cobran ${ch.days_charged} de los ${ch.days_in_month} días del mes, así que el ` +
        `precio y los timbres van en esa misma proporción:\n` +
        `  · Importe: $${f2(ch.amount_mxn)} + IVA  (mes completo: $${f2(ch.full_price_mxn)})\n` +
        `  · Timbres: ${ch.stamps_granted}  (mes completo: ${ch.full_stamps})\n\n` +
        `A partir del mes siguiente aplica el paquete completo.\n\n`
      : `  · Importe: $${f2(ch.amount_mxn)} + IVA\n` +
        `  · Timbres: ${ch.stamps_granted}\n\n`) +
    `El servicio es de prepago: en cuanto registremos tu pago se habilita el ` +
    `timbrado y te enviamos tu factura.\n\n` +
    `Quedamos atentos.\n${emisor}`;

  try {
    await sendPlainMail({
      companyId: platform?.id,
      to: ch.client_email,
      subject: `Tu contratación de ${periodo} — $${f2(ch.amount_mxn)} + IVA`,
      message: cuerpo,
    });
    await query(`UPDATE plan_charges SET notified_at = NOW(), updated_at = NOW() WHERE id = $1`, [chargeId]);
    logger.info(`[cobro] aviso enviado a ${ch.client_email} por $${f2(ch.amount_mxn)}`);
    return { enviado: true, detalle: `Aviso enviado a ${ch.client_email}` };
  } catch (e) {
    const msg = (e as Error).message;
    logger.warn(`[cobro] no se pudo avisar a ${ch.client_email}: ${msg}`);
    return { enviado: false, detalle: `No se pudo enviar el aviso: ${msg}` };
  }
}

/**
 * Emite y timbra el CFDI de HCGM por un cargo prepago YA PAGADO.
 *
 * Se llama después de registrar el pago y FUERA de su transacción: timbrar
 * habla con el PAC por red. Si viviera dentro, un PAC lento mantendría abierta
 * la transacción que libera el servicio, y un PAC caído impediría cobrar.
 *
 * Por lo mismo tampoco lanza: si el timbrado falla, el pago sigue registrado y
 * el cliente ya puede trabajar. La factura se reintenta.
 *
 * Idempotente por `invoice_id`: sin eso, dos clics en "registrar pago"
 * gastarían dos timbres y le mandarían al cliente dos facturas del mismo cobro.
 */
export async function emitirCfdiDeCargo(chargeId: string): Promise<IssueResult> {
  const ch = await cargarCargo(chargeId);
  if (!ch) return { invoicingId: chargeId, status: 'ERROR', detail: 'Cargo no encontrado' };

  if (ch.invoice_id) {
    return { invoicingId: chargeId, status: 'SKIPPED', detail: 'Este cargo ya tiene su CFDI emitido' };
  }
  if (ch.status !== 'PAID') {
    return {
      invoicingId: chargeId, status: 'SKIPPED',
      detail: 'El cargo no está pagado. Al ser prepago, el CFDI se emite cuando entra el dinero.',
    };
  }
  if (Number(ch.amount_mxn) <= 0) {
    return { invoicingId: chargeId, status: 'SKIPPED', detail: 'Importe 0 — no se emite CFDI' };
  }

  const platform = await getPlatformCompany();
  if (!platform) {
    return {
      invoicingId: chargeId, status: 'SKIPPED',
      detail: 'PLATFORM_COMPANY_RFC no está configurado — la factura se hace a mano',
    };
  }
  if (platform.id === ch.company_id) {
    return { invoicingId: chargeId, status: 'SKIPPED', detail: 'La plataforma no se factura a sí misma' };
  }

  const periodo = String(ch.billing_period).slice(0, 7);
  try {
    const customerId = await upsertPlatformCustomer(platform.id, {
      rfc: ch.client_rfc,
      business_name: ch.client_name,
      fiscal_regime: ch.client_regime,
      postal_code: ch.client_cp,
      contact_email: ch.client_email,
    });
    const productId = await upsertPlatformProduct(platform.id);

    /* La descripción deja escrito el prorrateo. Dentro de un año, la única
     * explicación de por qué esa factura no es del monto de lista tiene que
     * estar en el CFDI mismo y no en una tabla que hay que ir a consultar. */
    const proporcional = Number(ch.days_charged) < Number(ch.days_in_month);
    const desc =
      `Servicio de facturación electrónica ${periodo} — plan ${ch.package_code}` +
      (proporcional
        ? ` (proporcional: ${ch.days_charged} de ${ch.days_in_month} días, ${ch.stamps_granted} timbres)`
        : ` (${ch.stamps_granted} timbres)`);

    const invoice = await invoicesService.createInvoice(platform.id, {
      customerId,
      cfdiType: 'I',
      /* PUE, no PPD: es prepago y el dinero YA entró. Marcarlo PPD obligaría a
       * emitir después un complemento de pago por algo que se cobró antes de
       * facturar. */
      paymentForm: '03',        // transferencia electrónica de fondos
      paymentMethod: 'PUE',
      cfdiUse: 'G03',
      items: [{
        productId,
        quantity: 1,
        unitPrice: Number(ch.amount_mxn),
        taxPresetId: 'iva16',
        description: desc,
      } as any],
    });

    const stamp = await pacService.stampInvoice(platform.id, invoice.id);
    const folio = `${invoice.serie || 'FAC'}-${String(invoice.folio).padStart(6, '0')}`;

    await query(
      `UPDATE plan_charges SET invoice_id = $2, updated_at = NOW() WHERE id = $1`,
      [chargeId, invoice.id]
    );

    if (ch.client_email) {
      try {
        await sendInvoiceMail({
          companyId: platform.id,
          to: ch.client_email,
          subject: `Tu factura ${folio} — ${platform.business_name}`,
          message:
            `Recibimos tu pago. Tu servicio ya está habilitado y aquí va tu factura.\n\n` +
            `Plan: ${ch.package_code}\n` +
            `Periodo: del ${dia(ch.starts_on)} al ${dia(ch.ends_on)}\n` +
            `Timbres: ${ch.stamps_granted}\n` +
            `Importe: $${f2(ch.amount_mxn)} + IVA\n\n` +
            `Gracias por tu confianza.\n${platform.business_name}`,
          attachments: [
            { kind: 'invoice_pdf', id: invoice.id },
            { kind: 'invoice_xml', id: invoice.id },
          ],
        });
      } catch (mailErr) {
        logger.warn(`CFDI ${folio} emitido pero el correo a ${ch.client_email} falló: ${(mailErr as Error).message}`);
      }
    }

    logger.info(`[cobro] CFDI ${folio} (${stamp.uuid}) → ${ch.client_rfc} por $${f2(ch.amount_mxn)}`);
    return {
      invoicingId: chargeId, status: 'INVOICED',
      detail: `CFDI ${folio} timbrado y enviado`,
      invoiceFolio: folio, invoiceUuid: stamp.uuid,
    };
  } catch (e) {
    const msg = (e as Error).message || 'Error desconocido al emitir el CFDI';
    /* El motivo se anota en la nota del pago y no en un campo de error: el
     * cargo NO está en estado inválido —está pagado y el cliente ya trabaja—,
     * sólo le falta la factura. */
    await query(
      `UPDATE plan_charges
          SET payment_note = COALESCE(payment_note || ' · ', '') || $2, updated_at = NOW()
        WHERE id = $1`,
      [chargeId, `CFDI pendiente: ${msg}`.slice(0, 250)]
    ).catch(() => {});
    logger.error(`[cobro] no se pudo emitir el CFDI de ${chargeId}: ${msg}`);
    return { invoicingId: chargeId, status: 'ERROR', detail: msg };
  }
}
