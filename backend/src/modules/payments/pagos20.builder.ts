/**
 * pagos20.builder.ts — arma el nodo `pago20:Pagos` del Complemento de Pago 2.0.
 *
 * POR QUÉ EXISTE
 * El complemento se armaba con IVA 16% fijo, escrito a mano dentro de
 * payments.service. Funcionaba porque todas las facturas eran al 16%, pero
 * bastaba una exenta, una a tasa 0% o una con retenciones para que el SAT la
 * rechazara — y el rechazo llega en el momento más caro, al timbrar.
 *
 * Aquí los impuestos se DERIVAN de las facturas que se están pagando, leyendo
 * las tasas reales de sus partidas.
 *
 * UN PAGO PUEDE LIQUIDAR VARIAS FACTURAS
 * `DoctoRelacionado` es un arreglo y el caso normal en cobranza es que un
 * depósito cubra más de una factura. Antes esta función recibía los datos de UNA
 * y emitía un arreglo de un elemento; ahora recibe la lista completa. De ahí se
 * siguen tres reglas que conviene tener presentes:
 *
 *   · `NumParcialidad` es POR FACTURA, no por pago. El mismo depósito puede ser
 *     la parcialidad 2 de una y la 1 de otra.
 *   · `Monto` del pago debe cuadrar con la suma de los `ImpPagado`.
 *   · `Totales` e `ImpuestosP` suman TODOS los documentos antes de redondear.
 *
 * LAS TRES REGLAS QUE MÁS SE ROMPEN
 *
 *  1. `BaseDR × TasaOCuotaDR` debe ser igual a `ImporteDR` con dos decimales.
 *     Por eso el importe se calcula SOBRE LA BASE YA REDONDEADA.
 *
 *  2. En **Exento** NO van `TasaOCuotaDR` ni `ImporteDR`. Sólo la base y
 *     `TipoFactorDR: "Exento"`. Mandar tasa cero en vez de exento es un error
 *     distinto: son dos situaciones fiscales que se declaran aparte.
 *
 *  3. `ObjetoImpDR` y el nodo `ImpuestosDR` tienen que ser coherentes. Con
 *     "01" (no objeto de impuesto) el nodo NO debe existir; con "02" sí.
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

/** Una factura que este pago abona, total o parcialmente. */
export interface DocumentoAPagar {
  partidas: PartidaFiscal[];
  /** Total de la factura, para prorratear los impuestos de lo pagado. */
  totalFactura: number;
  /** Cuánto abona ESTE pago a ESTA factura. */
  montoPagado: number;
  saldoAnterior: number;
  saldoInsoluto: number;
  /** Cuántos pagos van sobre esta factura, contando el actual. */
  parcialidad: number;
  uuid: string;
  serie?: string | null;
  folio: string | number;
  metodoPago?: string | null;
  monedaDR: string;
  /** Sólo si MonedaDR difiere de MonedaP. */
  equivalenciaDR?: number;
}

export interface DatosPago {
  documentos: DocumentoAPagar[];
  monedaP: string;
  /** Pesos por unidad de monedaP. Obligatorio fuera de MXN. */
  tipoCambioP?: number;
  fechaPago: string;
  formaPago: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const f2 = (n: number) => n.toFixed(2);
/** Las tasas van con SEIS decimales: 0.106667, no 0.1067. */
const f6 = (n: number) => n.toFixed(6);

interface Grupo {
  impuesto: string;
  factor: 'Tasa' | 'Exento';
  tasa: number;
  base: number;
}

/** Agrupa por (impuesto, tipo de factor, tasa) sumando bases. */
function agrupar(claves: Grupo[]): Grupo[] {
  const mapa = new Map<string, Grupo>();
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
 * Impuestos que corresponden a lo pagado de UNA factura.
 *
 * El pago casi nunca cubre la factura completa, así que las bases se PRORRATEAN
 * por `montoPagado / totalFactura`, que es la interpretación que el SAT espera
 * en pagos en parcialidades.
 */
function impuestosDelDocumento(doc: DocumentoAPagar) {
  const factor = doc.totalFactura > 0 ? doc.montoPagado / doc.totalFactura : 0;

  const traslados = agrupar(
    doc.partidas.flatMap((p) => {
      const base = p.subtotal * factor;
      const out: Grupo[] = [];
      // IVA: exento y tasa son excluyentes.
      if (p.is_exempt) out.push({ impuesto: '002', factor: 'Exento', tasa: 0, base });
      else out.push({ impuesto: '002', factor: 'Tasa', tasa: p.tax_rate || 0, base });
      if (p.ieps_rate > 0) out.push({ impuesto: '003', factor: 'Tasa', tasa: p.ieps_rate, base });
      return out;
    })
  );

  const retenciones = agrupar(
    doc.partidas.flatMap((p) => {
      const base = p.subtotal * factor;
      const out: Grupo[] = [];
      if (p.ret_iva_rate > 0) out.push({ impuesto: '002', factor: 'Tasa', tasa: p.ret_iva_rate, base });
      if (p.ret_isr_rate > 0) out.push({ impuesto: '001', factor: 'Tasa', tasa: p.ret_isr_rate, base });
      return out;
    })
  );

  return { traslados, retenciones };
}

/** Convierte un grupo en el nodo TrasladosDR/RetencionesDR del Anexo 20. */
function nodoDR(g: Grupo) {
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
}

/** Sufijo del campo de Totales según la tasa de IVA. */
function sufijoIVA(factorTipo: 'Tasa' | 'Exento', tasa: number): string | null {
  if (factorTipo === 'Exento') return 'Exento';
  if (Math.abs(tasa - 0.16) < 1e-9) return '16';
  if (Math.abs(tasa - 0.08) < 1e-9) return '8';
  if (Math.abs(tasa) < 1e-9) return '0';
  return null;
}

export function construirPagos20(d: DatosPago): Record<string, any> {
  if (!d.documentos.length) {
    throw new Error('Un complemento de pago necesita al menos una factura relacionada.');
  }

  const doctos: Record<string, any>[] = [];
  /* Los acumulados del PAGO. Se suman sobre las bases sin redondear de cada
   * documento y se redondea al final: redondear documento por documento y luego
   * sumar produce diferencias de centavos contra el total declarado. */
  const trasladosPago: Grupo[] = [];
  const retencionesPago: Grupo[] = [];
  let montoTotal = 0;

  for (const doc of d.documentos) {
    const { traslados, retenciones } = impuestosDelDocumento(doc);
    trasladosPago.push(...traslados.map((g) => ({ ...g })));
    retencionesPago.push(...retenciones.map((g) => ({ ...g })));
    montoTotal += doc.montoPagado;

    const hayImpuestos = traslados.length > 0 || retenciones.length > 0;

    /* ObjetoImpDR debe concordar con la presencia del nodo de impuestos.
     * '01' = no objeto de impuesto → sin ImpuestosDR.
     * '02' = sí objeto           → con ImpuestosDR. */
    const registro: Record<string, any> = {
      IdDocumento: doc.uuid,
      ...(doc.serie ? { Serie: String(doc.serie) } : {}),
      Folio: String(doc.folio),
      MonedaDR: doc.monedaDR,
      // Obligatorio cuando MonedaDR difiere de MonedaP; con la misma vale 1.
      EquivalenciaDR: doc.monedaDR === d.monedaP ? '1' : f6(doc.equivalenciaDR ?? 1),
      // Un complemento siempre se refiere a facturas PPD: una PUE se pagó al
      // emitirse y no admite complemento.
      MetodoDePagoDR: doc.metodoPago || 'PPD',
      NumParcialidad: String(doc.parcialidad),
      ImpSaldoAnt: f2(doc.saldoAnterior),
      ImpPagado: f2(doc.montoPagado),
      ImpSaldoInsoluto: f2(doc.saldoInsoluto),
      ObjetoImpDR: hayImpuestos ? '02' : '01',
    };

    if (hayImpuestos) {
      registro.ImpuestosDR = {
        ...(retenciones.length ? { RetencionesDR: retenciones.map(nodoDR) } : {}),
        ...(traslados.length ? { TrasladosDR: traslados.map(nodoDR) } : {}),
      };
    }
    doctos.push(registro);
  }

  // Se reagrupan los acumulados: dos facturas al 16% forman un solo renglón.
  const trasladosP = agrupar(trasladosPago);
  const retencionesP = agrupar(retencionesPago);

  /* ImpuestosP resume los impuestos del PAGO. Los traslados repiten base, tasa
   * y factor; las retenciones llevan SÓLO impuesto e importe — asimetría del
   * esquema, no un olvido. */
  const nodosTrasladoP = trasladosP.map((g) => {
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
  const nodosRetencionP = retencionesP.map((g) => ({
    ImpuestoP: g.impuesto,
    ImporteP: f2(r2(r2(g.base) * g.tasa)),
  }));

  /* TOTALES.
   * Los nombres son fijos por tasa —TotalTrasladosBaseIVA16, …IVA8, …IVA0,
   * …IVAExento— y NO hay un campo genérico: una tasa que el SAT no contempla
   * simplemente no tiene dónde declararse. Las retenciones sólo tienen importe,
   * sin contraparte de base. */
  const totales: Record<string, string> = {};
  for (const g of trasladosP) {
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
  for (const g of retencionesP) {
    const k = g.impuesto === '001' ? 'TotalRetencionesISR'
            : g.impuesto === '002' ? 'TotalRetencionesIVA'
            : 'TotalRetencionesIEPS';
    totales[k] = f2(Number(totales[k] || 0) + r2(r2(g.base) * g.tasa));
  }
  totales.MontoTotalPagos = f2(r2(montoTotal));

  const pago: Record<string, any> = {
    FechaPago: d.fechaPago,
    FormaDePagoP: d.formaPago,
    MonedaP: d.monedaP,
    // Obligatorio salvo con MXN; se manda siempre porque con MXN vale 1.
    TipoCambioP: d.monedaP === 'MXN' ? '1' : f6(d.tipoCambioP ?? 1),
    Monto: f2(r2(montoTotal)),
    DoctoRelacionado: doctos,
  };
  if (nodosTrasladoP.length || nodosRetencionP.length) {
    pago.ImpuestosP = {
      ...(nodosRetencionP.length ? { RetencionesP: nodosRetencionP } : {}),
      ...(nodosTrasladoP.length ? { TrasladosP: nodosTrasladoP } : {}),
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
