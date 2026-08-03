/**
 * pagos20.builder.ts — arma el nodo `pago20:Pagos` del Complemento de Pago 2.0.
 *
 * POR QUÉ EXISTE
 * El complemento se armaba con IVA 16% fijo, escrito a mano dentro de
 * payments.service. Funcionaba porque todas las facturas eran al 16%, pero
 * bastaba una exenta, una a tasa 0% o una con retenciones para que el SAT la
 * rechazara — y el rechazo llega en el momento más caro, al timbrar.
 *
 * Aquí los impuestos se DERIVAN de la factura que se está pagando, leyendo las
 * tasas reales de sus partidas. Se cubren los casos del documento de referencia
 * de SW: sin impuestos, sólo traslados, sólo retenciones, traslados con
 * retenciones, exento, tasa 0%, y objeto de impuesto 01/02/03/06/07/08.
 *
 * LAS TRES REGLAS QUE MÁS SE ROMPEN
 *
 *  1. `BaseDR × TasaOCuotaDR` debe ser igual a `ImporteDR` con dos decimales.
 *     Por eso el importe se calcula SOBRE LA BASE YA REDONDEADA. Calcularlo
 *     sobre la base sin redondear desajusta un centavo en muchos montos.
 *
 *  2. En **Exento** NO van `TasaOCuotaDR` ni `ImporteDR`. Sólo la base y
 *     `TipoFactorDR: "Exento"`. Mandar tasa cero en vez de exento es un error
 *     distinto: son dos situaciones fiscales que se declaran aparte.
 *
 *  3. `ObjetoImpDR` y el nodo `ImpuestosDR` tienen que ser coherentes. Con
 *     "01" (no objeto de impuesto) el nodo NO debe existir; con "02" sí. Si se
 *     contradicen, el comprobante es inválido aunque los importes cuadren.
 *
 * Referencia: docs/complemento-pago-formas.md
 */

/** Una partida de la factura, con lo que hace falta para deducir sus impuestos. */
export interface PartidaFiscal {
  subtotal: number;        // base gravable de la línea
  tax_rate: number;        // tasa de IVA trasladado (0.16, 0.08, 0)
  is_exempt: boolean;      // exento: sin tasa, no es lo mismo que 0%
  ret_iva_rate: number;    // retención de IVA (0.106667, 0.04, …)
  ret_isr_rate: number;    // retención de ISR (0.10, 0.35, …)
  ieps_rate: number;       // IEPS trasladado
}

export interface DatosPago {
  partidas: PartidaFiscal[];
  totalFactura: number;    // total de la factura, para prorratear
  montoPago: number;       // lo que se está pagando ahora
  saldoAnterior: number;
  saldoInsoluto: number;
  parcialidad: number;
  uuidFactura: string;
  serieFactura?: string | null;
  folioFactura: string | number;
  metodoPagoFactura?: string | null;
  monedaDR: string;        // moneda de la factura
  monedaP: string;         // moneda en que se recibió el pago
  tipoCambioP?: number;    // pesos por unidad de monedaP
  equivalenciaDR?: number; // monedaDR por unidad de monedaP
  fechaPago: string;
  formaPago: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const f2 = (n: number) => n.toFixed(2);
/** Las tasas van con SEIS decimales: 0.106667, no 0.1067. */
const f6 = (n: number) => n.toFixed(6);

/** Agrupa por (impuesto, tipo de factor, tasa) sumando bases. */
function agrupar(
  claves: Array<{ impuesto: string; factor: 'Tasa' | 'Exento'; tasa: number; base: number }>
) {
  const mapa = new Map<string, { impuesto: string; factor: 'Tasa' | 'Exento'; tasa: number; base: number }>();
  for (const c of claves) {
    if (c.base <= 0) continue;
    const k = `${c.impuesto}|${c.factor}|${c.tasa}`;
    const prev = mapa.get(k);
    if (prev) prev.base += c.base;
    else mapa.set(k, { ...c });
  }
  return [...mapa.values()];
}

/**
 * Construye el nodo del complemento.
 *
 * El pago casi nunca cubre la factura completa, así que los impuestos se
 * PRORRATEAN: se declara la parte de cada base que corresponde a lo pagado. El
 * factor es `montoPago / totalFactura`, que es la interpretación que el SAT
 * espera en pagos en parcialidades.
 */
export function construirPagos20(d: DatosPago): Record<string, any> {
  const factor = d.totalFactura > 0 ? d.montoPago / d.totalFactura : 0;

  const traslados = agrupar(
    d.partidas.flatMap((p) => {
      const base = p.subtotal * factor;
      const out: Array<{ impuesto: string; factor: 'Tasa' | 'Exento'; tasa: number; base: number }> = [];
      // IVA: exento y tasa son excluyentes.
      if (p.is_exempt) out.push({ impuesto: '002', factor: 'Exento', tasa: 0, base });
      else out.push({ impuesto: '002', factor: 'Tasa', tasa: p.tax_rate || 0, base });
      if (p.ieps_rate > 0) out.push({ impuesto: '003', factor: 'Tasa', tasa: p.ieps_rate, base });
      return out;
    })
  );

  const retenciones = agrupar(
    d.partidas.flatMap((p) => {
      const base = p.subtotal * factor;
      const out: Array<{ impuesto: string; factor: 'Tasa' | 'Exento'; tasa: number; base: number }> = [];
      if (p.ret_iva_rate > 0) out.push({ impuesto: '002', factor: 'Tasa', tasa: p.ret_iva_rate, base });
      if (p.ret_isr_rate > 0) out.push({ impuesto: '001', factor: 'Tasa', tasa: p.ret_isr_rate, base });
      return out;
    })
  );

  /** Convierte un grupo en el nodo TrasladosDR/RetencionesDR del Anexo 20. */
  const nodoDR = (g: { impuesto: string; factor: 'Tasa' | 'Exento'; tasa: number; base: number }) => {
    const base = r2(g.base);
    if (g.factor === 'Exento') {
      // Sin TasaOCuotaDR ni ImporteDR: el esquema NO los admite en exento.
      return { BaseDR: f2(base), ImpuestoDR: g.impuesto, TipoFactorDR: 'Exento' };
    }
    return {
      BaseDR: f2(base),
      ImpuestoDR: g.impuesto,
      TipoFactorDR: 'Tasa',
      TasaOCuotaDR: f6(g.tasa),
      // Sobre la base YA redondeada, para que el producto cuadre a dos decimales.
      ImporteDR: f2(r2(base * g.tasa)),
    };
  };

  const hayImpuestos = traslados.length > 0 || retenciones.length > 0;

  /* ObjetoImpDR debe concordar con la presencia del nodo de impuestos.
   * '01' = no objeto de impuesto → sin ImpuestosDR.
   * '02' = sí objeto           → con ImpuestosDR. */
  const objetoImpDR = hayImpuestos ? '02' : '01';

  const docto: Record<string, any> = {
    IdDocumento: d.uuidFactura,
    ...(d.serieFactura ? { Serie: String(d.serieFactura) } : {}),
    Folio: String(d.folioFactura),
    MonedaDR: d.monedaDR,
    // Obligatorio cuando MonedaDR difiere de MonedaP; con la misma moneda vale 1.
    EquivalenciaDR: d.monedaDR === d.monedaP ? '1' : f6(d.equivalenciaDR ?? 1),
    NumParcialidad: String(d.parcialidad),
    ImpSaldoAnt: f2(d.saldoAnterior),
    ImpPagado: f2(d.montoPago),
    ImpSaldoInsoluto: f2(d.saldoInsoluto),
    ObjetoImpDR: objetoImpDR,
  };

  if (hayImpuestos) {
    docto.ImpuestosDR = {
      ...(retenciones.length ? { RetencionesDR: retenciones.map(nodoDR) } : {}),
      ...(traslados.length ? { TrasladosDR: traslados.map(nodoDR) } : {}),
    };
  }

  /* ImpuestosP resume los impuestos del PAGO. Los traslados repiten base, tasa
   * y factor; las retenciones llevan SÓLO impuesto e importe — asimetría del
   * esquema, no un olvido. */
  const trasladosP = traslados.map((g) => {
    const base = r2(g.base);
    if (g.factor === 'Exento') {
      return { BaseP: f2(base), ImpuestoP: g.impuesto, TipoFactorP: 'Exento' };
    }
    return {
      BaseP: f2(base),
      ImpuestoP: g.impuesto,
      TipoFactorP: 'Tasa',
      TasaOCuotaP: f6(g.tasa),
      ImporteP: f2(r2(base * g.tasa)),
    };
  });
  const retencionesP = retenciones.map((g) => ({
    ImpuestoP: g.impuesto,
    ImporteP: f2(r2(r2(g.base) * g.tasa)),
  }));

  /* TOTALES.
   * Los nombres son fijos por tasa —TotalTrasladosBaseIVA16, …IVA8, …IVA0,
   * …IVAExento— y NO hay un campo genérico: una tasa que el SAT no contempla
   * simplemente no tiene dónde declararse. Las retenciones sólo tienen importe,
   * sin contraparte de base. */
  const totales: Record<string, string> = {};
  const sufijoIVA = (factorTipo: 'Tasa' | 'Exento', tasa: number): string | null => {
    if (factorTipo === 'Exento') return 'Exento';
    if (Math.abs(tasa - 0.16) < 1e-9) return '16';
    if (Math.abs(tasa - 0.08) < 1e-9) return '8';
    if (Math.abs(tasa) < 1e-9) return '0';
    return null;
  };
  for (const g of traslados) {
    if (g.impuesto !== '002') continue;   // los totales por tasa son sólo de IVA
    const suf = sufijoIVA(g.factor, g.tasa);
    if (!suf) continue;
    const base = r2(g.base);
    const kBase = `TotalTrasladosBaseIVA${suf}`;
    totales[kBase] = f2(Number(totales[kBase] || 0) + base);
    if (suf !== 'Exento') {
      const kImp = `TotalTrasladosImpuestoIVA${suf}`;
      totales[kImp] = f2(Number(totales[kImp] || 0) + r2(base * g.tasa));
    }
  }
  for (const g of retenciones) {
    const k = g.impuesto === '001' ? 'TotalRetencionesISR'
            : g.impuesto === '002' ? 'TotalRetencionesIVA'
            : 'TotalRetencionesIEPS';
    totales[k] = f2(Number(totales[k] || 0) + r2(r2(g.base) * g.tasa));
  }
  totales.MontoTotalPagos = f2(d.montoPago);

  const pago: Record<string, any> = {
    FechaPago: d.fechaPago,
    FormaDePagoP: d.formaPago,
    MonedaP: d.monedaP,
    // Obligatorio salvo con MXN; se manda siempre porque con MXN vale 1.
    TipoCambioP: d.monedaP === 'MXN' ? '1' : f6(d.tipoCambioP ?? 1),
    Monto: f2(d.montoPago),
    DoctoRelacionado: [docto],
  };
  if (trasladosP.length || retencionesP.length) {
    pago.ImpuestosP = {
      ...(retencionesP.length ? { RetencionesP: retencionesP } : {}),
      ...(trasladosP.length ? { TrasladosP: trasladosP } : {}),
    };
  }

  return { Version: '2.0', Totales: totales, Pago: [pago] };
}

/**
 * Envoltura que espera el convertidor de SW.
 *
 * El arreglo se llama `Any` —se traduce a `<cfdi:Complemento>` con hijos
 * arbitrarios, igual que el xs:any del XSD— y la llave lleva el PREFIJO del
 * namespace. Sin el prefijo SW no identifica el complemento y lo descarta en
 * silencio: el comprobante sale tipo P sin complemento y el SAT responde
 * CFDI140230, que es un error engañoso porque parece que no se envió.
 */
export function envolverComplemento(pagos: Record<string, any>) {
  return { Any: [{ 'pago20:Pagos': pagos }] };
}
