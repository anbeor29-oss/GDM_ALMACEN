/**
 * pdf-impuestos — el desglose de impuestos que se IMPRIME, derivado de la
 * factura real.
 *
 * POR QUÉ EXISTE
 * Los formatos impresos tienden a traer la tasa escrita a mano («16.0000»)
 * porque casi todas las facturas son al 16%. Eso imprime una cifra FALSA en
 * cuanto aparece una factura de zona fronteriza al 8%, una exenta o una con
 * retención: el papel diría una cosa y el XML otra. Aquí se arma leyendo las
 * tasas de cada línea, que es de donde salen también las del comprobante.
 *
 * Claves del SAT (c_Impuesto): 001 = ISR, 002 = IVA, 003 = IEPS.
 */

import { redondea } from './decimales';

export interface Traslado {
  impuesto: string;        // '002' | '003'
  nombre: string;          // 'IVA' | 'IEPS'
  tipoFactor: 'Tasa' | 'Exento';
  tasa: number;            // 0.16, 0.08, 0 …
  base: number;
  importe: number;
}

export interface Retencion {
  impuesto: string;        // '001' (ISR) | '002' (IVA)
  nombre: string;
  tasa: number;
  base: number;
  importe: number;
}

/** Base gravable de la línea: el importe ya calculado, o cantidad × precio. */
export function baseDeLinea(it: any): number {
  if (it?.subtotal !== null && it?.subtotal !== undefined && it.subtotal !== '') return Number(it.subtotal) || 0;
  return redondea(Number(it?.quantity || 0) * Number(it?.unit_price || 0), 2);
}

/**
 * ¿La línea es objeto de impuesto? ObjetoImp del Anexo 20:
 *   01 = no objeto · 02 = sí objeto. Se decide igual que en el XML
 *   (build-cfdi-json): con base > 0 es objeto.
 */
export function objetoImpuesto(it: any): '01' | '02' {
  return baseDeLinea(it) > 0 ? '02' : '01';
}

/** Traslados de UNA línea (IVA y/o IEPS), con su tasa real. */
export function trasladosDeLinea(it: any): Traslado[] {
  const base = baseDeLinea(it);
  const out: Traslado[] = [];
  if (base <= 0) return out;

  const tasaIva = Number(it?.tax_rate) || 0;
  const exento = !!it?.is_exempt;
  if (exento) {
    // Exento: el Anexo 20 NO lleva tasa ni importe. Imprimir «0.160000» aquí
    // sería inventar; imprimir «0.00» también, porque exento no es tasa cero.
    out.push({ impuesto: '002', nombre: 'IVA', tipoFactor: 'Exento', tasa: 0, base, importe: 0 });
  } else {
    out.push({
      impuesto: '002', nombre: 'IVA', tipoFactor: 'Tasa', tasa: tasaIva,
      base, importe: redondea(base * tasaIva, 2),
    });
  }

  const ieps = Number(it?.ieps_rate) || 0;
  if (ieps > 0) {
    out.push({
      impuesto: '003', nombre: 'IEPS', tipoFactor: 'Tasa', tasa: ieps,
      base, importe: redondea(base * ieps, 2),
    });
  }
  return out;
}

/** Retenciones de UNA línea (IVA e ISR), con su tasa real. */
export function retencionesDeLinea(it: any): Retencion[] {
  const base = baseDeLinea(it);
  const out: Retencion[] = [];
  if (base <= 0) return out;

  const rIva = Number(it?.ret_iva_rate) || 0;
  if (rIva > 0) out.push({ impuesto: '002', nombre: 'IVA', tasa: rIva, base, importe: redondea(base * rIva, 2) });

  const rIsr = Number(it?.ret_isr_rate) || 0;
  if (rIsr > 0) out.push({ impuesto: '001', nombre: 'ISR', tasa: rIsr, base, importe: redondea(base * rIsr, 2) });

  return out;
}

/**
 * Traslados del COMPROBANTE: se agrupan por impuesto + tipo factor + tasa,
 * exactamente como los agrupa el XML. Dos líneas al 16% son UN renglón; una al
 * 16% y otra al 8% son DOS, y así es como tienen que verse en el papel.
 */
export function resumenTraslados(items: any[]): Traslado[] {
  const mapa = new Map<string, Traslado>();
  for (const it of items || []) {
    for (const tr of trasladosDeLinea(it)) {
      const k = `${tr.impuesto}|${tr.tipoFactor}|${tr.tasa.toFixed(6)}`;
      const cur = mapa.get(k);
      if (cur) { cur.base = redondea(cur.base + tr.base, 2); cur.importe = redondea(cur.importe + tr.importe, 2); }
      else mapa.set(k, { ...tr });
    }
  }
  return Array.from(mapa.values());
}

/** Retenciones del comprobante, agrupadas por impuesto + tasa. */
export function resumenRetenciones(items: any[]): Retencion[] {
  const mapa = new Map<string, Retencion>();
  for (const it of items || []) {
    for (const re of retencionesDeLinea(it)) {
      const k = `${re.impuesto}|${re.tasa.toFixed(6)}`;
      const cur = mapa.get(k);
      if (cur) { cur.base = redondea(cur.base + re.base, 2); cur.importe = redondea(cur.importe + re.importe, 2); }
      else mapa.set(k, { ...re });
    }
  }
  return Array.from(mapa.values());
}

/** «002   0.160000 %» / «002   Exento» — el renglón de tasa del bloque de totales. */
export function etiquetaTasa(t: Traslado | Retencion): string {
  const tipoFactor = (t as Traslado).tipoFactor;
  if (tipoFactor === 'Exento') return `${t.impuesto}   Exento`;
  return `${t.impuesto}   ${t.tasa.toFixed(6)} %`;
}
