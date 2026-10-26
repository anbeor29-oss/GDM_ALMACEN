/**
 * ec-mercadopago.service — adaptador de Mercado Pago (rebanada 5).
 *
 * Checkout ALOJADO: se crea una «preferencia» y el comprador paga en el sitio de
 * MP (NEXO nunca ve tarjeta ni CVV). El webhook avisa el resultado; se consulta
 * el pago a MP para confirmarlo (no se confía sólo en la notificación).
 *
 * Gated por `MP_ACCESS_TOKEN` (del env; sandbox o producción según el token). Sin
 * token, `mpConfigurado()` es false y el storefront cae al flujo sin línea (R4).
 */
import axios from 'axios';
import logger from '../../middleware/logger';

const MP_BASE = 'https://api.mercadopago.com';
const token = () => (process.env.MP_ACCESS_TOKEN || '').trim();

export function mpConfigurado(): boolean {
  return token().length > 0;
}

export interface ItemPref { nombre: string; cantidad: number; precioConIva: number; }

/** Crea la preferencia de checkout. Devuelve el init_point (URL de pago) y su id. */
export async function crearPreferencia(opts: {
  orderId: string; numero: string; moneda: string; items: ItemPref[];
  backUrls: { success: string; failure: string; pending: string };
  notificationUrl: string;
}): Promise<{ initPoint: string; preferenceId: string } | null> {
  if (!mpConfigurado()) return null;
  try {
    const body = {
      items: opts.items.map((i) => ({
        title: i.nombre.slice(0, 250), quantity: Math.max(1, Math.round(i.cantidad)),
        unit_price: Number(i.precioConIva), currency_id: opts.moneda || 'MXN',
      })),
      external_reference: opts.orderId,
      back_urls: opts.backUrls,
      auto_return: 'approved',
      notification_url: opts.notificationUrl,
      statement_descriptor: opts.numero,
    };
    const r = await axios.post(`${MP_BASE}/checkout/preferences`, body, {
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      timeout: 15_000,
    });
    return { initPoint: r.data?.init_point || r.data?.sandbox_init_point, preferenceId: r.data?.id };
  } catch (e: any) {
    logger.error(`[mercadopago] no se pudo crear la preferencia: ${e.response?.data?.message || e.message}`);
    return null;
  }
}

/** Consulta un pago en MP para confirmar su estatus (no confiar sólo en el webhook). */
export async function consultarPago(paymentId: string): Promise<{
  status: string; externalReference?: string; amount?: number; moneda?: string;
} | null> {
  if (!mpConfigurado()) return null;
  try {
    const r = await axios.get(`${MP_BASE}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${token()}` }, timeout: 15_000,
    });
    return {
      status: String(r.data?.status || ''),
      externalReference: r.data?.external_reference,
      amount: Number(r.data?.transaction_amount),
      moneda: r.data?.currency_id,
    };
  } catch (e: any) {
    logger.error(`[mercadopago] no se pudo consultar el pago ${paymentId}: ${e.response?.data?.message || e.message}`);
    return null;
  }
}
