/**
 * ec-fulfillment.service — al pagar un pedido web: pedido → CFDI → póliza.
 *
 * Reutiliza el motor existente: crea una factura (tipo I) con los productos del
 * pedido y la TIMBRA con pac.service (que a su vez indexa el XML en la bóveda y
 * genera la póliza de venta — ver postTimbradoEmitido). Consume las reservas de
 * stock. Todo idempotente por pedido (si ya tiene invoice_id, lo devuelve).
 */
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import * as customersService from '../customers/customers.service';
import * as invoicesService from '../invoices/invoices.service';
import * as pacService from '../pac/pac.service';
import { consultarPago } from './ec-mercadopago.service';

const RFC_PUBLICO = 'XAXX010101000';

/** Cliente «Público en general» de la empresa (lo crea si no existe). */
async function clientePublicoGeneral(companyId: string, cpEmpresa?: string): Promise<string> {
  try {
    const c = await customersService.getCustomerByRFC(companyId, RFC_PUBLICO);
    if ((c as any)?.id) return (c as any).id;
  } catch { /* no existe: se crea abajo */ }
  const nuevo = await customersService.createCustomer(companyId, {
    rfc: RFC_PUBLICO, businessName: 'PUBLICO EN GENERAL', fiscalRegime: '616',
    defaultCfdiUse: 'S01', postalCode: cpEmpresa || undefined,
  });
  return (nuevo as any).id;
}

/**
 * Factura un pedido web. Idempotente: si ya está facturado, devuelve su factura.
 * Si el timbrado falla (p. ej. empresa en PRUEBAS / sin CSD en el vault), la
 * factura queda creada en DRAFT y ligada al pedido para timbrarla a mano.
 */
export async function facturarPedido(
  companyId: string, orderId: string,
): Promise<{ invoiceId: string; uuid?: string; timbrada: boolean; yaExistia: boolean }> {
  const ordR = await query<any>(`SELECT * FROM ec_order WHERE id=$1 AND company_id=$2`, [orderId, companyId]);
  const order = ordR.rows[0];
  if (!order) throw new ValidationError('Pedido no encontrado.');
  if (order.invoice_id) {
    const inv = await query<any>(`SELECT cfdi_uuid FROM invoices WHERE id=$1`, [order.invoice_id]);
    return { invoiceId: order.invoice_id, uuid: inv.rows[0]?.cfdi_uuid || undefined, timbrada: !!inv.rows[0]?.cfdi_uuid, yaExistia: true };
  }

  const itemsR = await query<any>(
    `SELECT product_id, cantidad, precio_unit FROM ec_order_item WHERE order_id=$1`, [orderId]);
  if (!itemsR.rows.length) throw new ValidationError('El pedido no tiene renglones.');

  const compR = await query<any>(`SELECT postal_code FROM companies WHERE id=$1`, [companyId]);
  const customerId = await clientePublicoGeneral(companyId, compR.rows[0]?.postal_code);

  // Renglones del CFDI: los productos del pedido y, si hubo envío cobrado, un
  // renglón de FLETE (texto libre, IVA 16%). ClaveProdServ/Unidad configurables.
  const items: any[] = itemsR.rows.map((r: any) => ({
    productId: r.product_id, quantity: Number(r.cantidad), unitPrice: Number(r.precio_unit),
  }));
  const envioBase = Number(order.envio_base) || 0;
  if (envioBase > 0) {
    items.push({
      quantity: 1, unitPrice: envioBase, taxPresetId: 'iva16',
      claveSat: process.env.EC_CLAVE_ENVIO || '78102200',   // servicios de transporte/paquetería
      unitCode: process.env.EC_UNIDAD_ENVIO || 'E48',        // unidad de servicio
      description: `Envío${order.envio_metodo ? ` — ${order.envio_metodo}` : ''}`,
    });
  }

  // Venta web ya cobrada → PUE. Forma de pago genérica (03 transferencia); el
  // merchant puede ajustar antes de timbrar si quedó en DRAFT.
  const factura = await invoicesService.createInvoice(companyId, {
    customerId, cfdiType: 'I', paymentForm: '03', paymentMethod: 'PUE', cfdiUse: 'S01',
    items,
    notes: `Pedido web ${order.numero}`,
  });

  // Timbrar — stampInvoice ya indexa en la bóveda y genera la póliza de venta.
  let uuid: string | undefined;
  let timbrada = false;
  try {
    const r = await pacService.stampInvoice(companyId, factura.id);
    uuid = r.uuid; timbrada = !!r.uuid;
  } catch (e: any) {
    logger.warn(`[ec-fulfillment] pedido ${order.numero}: factura ${factura.id} creada pero no timbró: ${e.message}`);
  }

  // Ligar la factura al pedido, consumir reservas y marcar el estado.
  await transaction(async (client) => {
    await transactionQuery(client,
      `UPDATE ec_order
          SET invoice_id=$1, facturado_at=NOW(), updated_at=NOW(),
              estado = CASE WHEN estado='PENDIENTE_PAGO' THEN 'PAGADO' ELSE estado END
        WHERE id=$2`, [factura.id, orderId]);
    await transactionQuery(client,
      `UPDATE ec_inventory_reservation SET estado='CONSUMIDA'
        WHERE order_id=$1 AND estado='ACTIVA'`, [orderId]);
  });

  return { invoiceId: factura.id, uuid, timbrada, yaExistia: false };
}

/** Marca el pedido PAGADO (si no lo estaba) y lo factura. */
export async function marcarPagadoYFacturar(companyId: string, orderId: string) {
  await query(
    `UPDATE ec_order SET estado='PAGADO', pagado_at=COALESCE(pagado_at, NOW()), updated_at=NOW()
      WHERE id=$1 AND company_id=$2 AND estado <> 'CANCELADO'`, [orderId, companyId]);
  return facturarPedido(companyId, orderId);
}

/**
 * Procesa un pago de Mercado Pago (desde el webhook). Confirma el estatus con MP
 * (no confía sólo en la notificación), registra el pago de forma IDEMPOTENTE
 * (unique por payment_id) y, si fue aprobado, marca el pedido pagado y lo factura.
 */
export async function procesarPagoMP(paymentId: string): Promise<void> {
  const pago = await consultarPago(paymentId);
  if (!pago || !pago.externalReference || pago.status !== 'approved') return;
  const orderId = pago.externalReference;
  const ordR = await query<any>(
    `SELECT company_id, store_id, total, moneda FROM ec_order WHERE id=$1`, [orderId]);
  const order = ordR.rows[0];
  if (!order) return;
  // Idempotencia: el unique por payment_id evita re-facturar el mismo pago.
  const ins = await query(
    `INSERT INTO ec_payment_transaction
       (company_id, store_id, order_id, proveedor, estado, monto, moneda, payment_id)
     VALUES ($1,$2,$3,'mercadopago','APROBADO',$4,$5,$6)
     ON CONFLICT (payment_id) DO NOTHING RETURNING id`,
    [order.company_id, order.store_id, orderId, pago.amount || order.total, pago.moneda || order.moneda, String(paymentId)]);
  if (!ins.rowCount) { logger.info(`[mercadopago] pago ${paymentId} ya procesado; no se re-factura.`); return; }
  await marcarPagadoYFacturar(order.company_id, orderId)
    .catch((e) => logger.error(`[mercadopago] facturar pedido del pago ${paymentId} falló: ${e.message}`));
}

/**
 * Avanza el surtido de un pedido: SURTIDO → ENVIADO (captura paquetería + guía) →
 * ENTREGADO, con su fecha. También permite corregir la guía sin cambiar el estado.
 * No toca pedidos cancelados. No altera el cobro ni la factura.
 */
const ESTADOS_ENVIO = ['SURTIDO', 'ENVIADO', 'ENTREGADO'];
export async function actualizarEnvioPedido(
  companyId: string, orderId: string, d: { estado?: string; paqueteria?: string; guia?: string },
) {
  const ordR = await query<any>(`SELECT id, estado FROM ec_order WHERE id=$1 AND company_id=$2`, [orderId, companyId]);
  const o = ordR.rows[0];
  if (!o) throw new ValidationError('Pedido no encontrado.');
  if (o.estado === 'CANCELADO') throw new ValidationError('El pedido está cancelado.');

  const sets: string[] = []; const vals: any[] = [orderId, companyId]; let i = 3;
  const estado = String(d?.estado || '').toUpperCase();
  if (estado) {
    if (!ESTADOS_ENVIO.includes(estado)) throw new ValidationError('Estado de envío no válido (surtido, enviado o entregado).');
    sets.push(`estado=$${i++}`); vals.push(estado);
    const campo = estado === 'SURTIDO' ? 'surtido_at' : estado === 'ENVIADO' ? 'enviado_at' : 'entregado_at';
    sets.push(`${campo}=COALESCE(${campo}, NOW())`);
  }
  if (d?.paqueteria !== undefined) { sets.push(`paqueteria=$${i++}`); vals.push(String(d.paqueteria || '').trim().slice(0, 80) || null); }
  if (d?.guia !== undefined) { sets.push(`guia=$${i++}`); vals.push(String(d.guia || '').trim().slice(0, 120) || null); }
  if (!sets.length) return { actualizado: false };
  const r = await query<any>(
    `UPDATE ec_order SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$1 AND company_id=$2
     RETURNING id, estado, paqueteria, guia`, vals);
  return r.rows[0];
}

/** Lista de pedidos de la empresa (cockpit). */
export async function listarPedidos(companyId: string) {
  const r = await query<any>(
    `SELECT o.id, o.numero, o.estado, o.cliente_nombre, o.cliente_email, o.total, o.moneda,
            o.created_at, o.pagado_at, o.facturado_at, o.invoice_id,
            o.envio_metodo, (o.envio_base + o.envio_iva)::float AS envio_total,
            o.cupon_codigo, o.descuento::float AS descuento,
            o.paqueteria, o.guia, o.surtido_at, o.enviado_at, o.entregado_at,
            i.cfdi_uuid, i.serie, i.folio,
            s.nombre AS tienda
       FROM ec_order o
       JOIN ec_store s ON s.id = o.store_id
       LEFT JOIN invoices i ON i.id = o.invoice_id
      WHERE o.company_id = $1
      ORDER BY o.created_at DESC
      LIMIT 200`, [companyId]);
  return r.rows;
}
