/**
 * Reconstrucción de la CARTERA (cobranza) desde los XML — sin depender de que las
 * pólizas estén generadas. Para un cliente del que ya tenemos TODOS sus XML:
 *   · acumula sus facturas PPD emitidas (lo que se le facturó a crédito), y
 *   · descuenta los «timbres de pago» (complementos de pago tipo P) que las
 *     liquidaron, por `DoctoRelacionado@ImpPagado`.
 * El neto por factura es el SALDO por cobrar; se agrupa por cliente con su
 * antigüedad. PUE queda fuera (ya pagada, no es cuenta por cobrar — [[pue-ppd-cobranza-regla]]).
 *
 * Reutiliza la tabla `cfdi_pago_relacion` (pago→factura) que puebla
 * `reconstruirRelacionPagos` leyendo los tipo P del respaldo.
 */
import { query } from '../../config/database';
import { reconstruirRelacionPagos } from '../sat-descarga/descarga.service';

const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

export interface CarteraFactura {
  uuid: string; folio: string; fecha: string; moneda: string;
  total: number; pagado: number; saldo: number; dias: number;
  rfc: string; cliente: string;
}
export interface CarteraCliente {
  rfc: string; cliente: string; facturas: number; saldo: number;
  b0_30: number; b31_60: number; b61_90: number; b90: number;
}

/**
 * Reconstruye la cartera de cobranza del emisor (toda, o filtrada por RFC de
 * cliente). Primero asegura las relaciones pago→factura desde los XML tipo P.
 */
export async function reconstruirCartera(companyId: string, rfcCliente?: string): Promise<{
  total: number; clientes: CarteraCliente[]; facturas: CarteraFactura[]; sinPago: number;
}> {
  // 1) Pobla/actualiza pago→factura desde los complementos (idempotente).
  await reconstruirRelacionPagos(companyId).catch(() => { /* si falla, seguimos con lo que haya */ });

  // 2) Facturas PPD emitidas (lo que se debe) con lo ya pagado.
  const cond: string[] = [
    `c.company_id = $1`, `c.direccion = 'emitidos'`, `c.tipo_comprobante = 'I'`,
    `c.metodo_pago = 'PPD'`, `(c.estado_sat IS NULL OR c.estado_sat <> 'Cancelado')`,
  ];
  const par: any[] = [companyId];
  if (rfcCliente) { par.push(rfcCliente.trim().toUpperCase()); cond.push(`UPPER(c.rfc_receptor) = $${par.length}`); }

  const r = await query<any>(
    `SELECT c.uuid, c.serie, c.folio, c.rfc_receptor, c.nombre_receptor, c.moneda,
            TO_CHAR(c.fecha_emision, 'YYYY-MM-DD') AS fecha, c.total::float AS total,
            COALESCE((SELECT SUM(pr.imp_pagado) FROM cfdi_pago_relacion pr
                       WHERE pr.company_id = c.company_id
                         AND pr.factura_uuid = UPPER(c.uuid)), 0)::float AS pagado
       FROM cfdi_recibidos c
      WHERE ${cond.join(' AND ')}
      ORDER BY c.rfc_receptor, c.fecha_emision`, par);

  const hoy = new Date();
  const diasDe = (f: string) => Math.max(0, Math.floor((hoy.getTime() - new Date(f + 'T12:00:00').getTime()) / 86400000));

  const clientes = new Map<string, CarteraCliente>();
  const facturas: CarteraFactura[] = [];
  let total = 0, sinPago = 0;

  for (const f of r.rows) {
    const saldo = r2(f.total - f.pagado);
    if (saldo <= 0.01) continue;                 // ya liquidada → fuera de la cartera
    if (f.pagado <= 0.01) sinPago++;
    const dias = diasDe(f.fecha);
    total += saldo;
    facturas.push({
      uuid: f.uuid, folio: [f.serie, f.folio].filter(Boolean).join('-') || String(f.uuid).slice(0, 8),
      fecha: f.fecha, moneda: f.moneda || 'MXN', total: r2(f.total), pagado: r2(f.pagado), saldo, dias,
      rfc: f.rfc_receptor || '', cliente: f.nombre_receptor || f.rfc_receptor || '—',
    });
    const key = String(f.rfc_receptor || '—').toUpperCase();
    if (!clientes.has(key)) {
      clientes.set(key, { rfc: f.rfc_receptor || '', cliente: f.nombre_receptor || f.rfc_receptor || '—', facturas: 0, saldo: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90: 0 });
    }
    const c = clientes.get(key)!;
    c.facturas++; c.saldo = r2(c.saldo + saldo);
    if (dias <= 30) c.b0_30 = r2(c.b0_30 + saldo);
    else if (dias <= 60) c.b31_60 = r2(c.b31_60 + saldo);
    else if (dias <= 90) c.b61_90 = r2(c.b61_90 + saldo);
    else c.b90 = r2(c.b90 + saldo);
  }

  return {
    total: r2(total), sinPago,
    clientes: Array.from(clientes.values()).sort((a, b) => b.saldo - a.saldo),
    facturas,
  };
}
