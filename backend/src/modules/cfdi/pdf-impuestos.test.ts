/**
 * La tasa que se IMPRIME sale de la factura, nunca de un literal.
 *
 * El defecto que originó esto: dos formatos traían la tasa escrita a mano
 * —«IVA 16%», «Tasa o cuota: 16.0000»— porque casi todas las facturas son al
 * 16 %. Una de zona fronteriza al 8 %, una exenta o una con IEPS salía con la
 * tasa EQUIVOCADA impresa en el papel que recibe el cliente, mientras el XML
 * decía otra cosa. Estas pruebas existen para que no vuelva a pasar.
 */
import {
  baseDeLinea, objetoImpuesto, trasladosDeLinea, retencionesDeLinea,
  resumenTraslados, resumenRetenciones, porcentaje, etiquetaImpuesto, etiquetaTasa,
} from './pdf-impuestos';

const linea = (o: Partial<Record<string, any>> = {}) => ({
  quantity: 1, unit_price: 1000, subtotal: 1000, tax_rate: 0.16, ...o,
});

describe('base y objeto de impuesto', () => {
  it('la base es el importe guardado de la línea', () => {
    expect(baseDeLinea(linea({ subtotal: '12887.93' }))).toBe(12887.93);
  });

  it('sin importe guardado, se calcula cantidad × precio', () => {
    expect(baseDeLinea({ quantity: 400, unit_price: 32.219827, subtotal: null })).toBe(12887.93);
  });

  it('con base hay objeto de impuesto (02); sin base, no (01)', () => {
    expect(objetoImpuesto(linea())).toBe('02');
    expect(objetoImpuesto(linea({ subtotal: 0 }))).toBe('01');
  });
});

describe('traslados de una línea', () => {
  it('al 16 % da la tasa y el importe reales', () => {
    const [iva] = trasladosDeLinea(linea({ subtotal: 12887.93, tax_rate: 0.16 }));
    expect(iva.tasa).toBe(0.16);
    expect(iva.importe).toBe(2062.07);
    expect(iva.tipoFactor).toBe('Tasa');
  });

  it('ZONA FRONTERIZA al 8 %: NO dice 16', () => {
    const [iva] = trasladosDeLinea(linea({ subtotal: 74222.89, tax_rate: 0.08 }));
    expect(iva.tasa).toBe(0.08);
    expect(iva.importe).toBe(5937.83);
    expect(etiquetaImpuesto(iva)).toBe('IVA 8%');
    expect(etiquetaImpuesto(iva)).not.toContain('16');
  });

  it('EXENTA: tipo factor Exento, sin tasa ni importe', () => {
    const [iva] = trasladosDeLinea(linea({ subtotal: 1500, tax_rate: 0, is_exempt: true }));
    expect(iva.tipoFactor).toBe('Exento');
    expect(iva.importe).toBe(0);
    expect(etiquetaImpuesto(iva)).toBe('IVA Exento');
  });

  it('tasa 0 NO es lo mismo que exento', () => {
    const [iva] = trasladosDeLinea(linea({ subtotal: 1500, tax_rate: 0 }));
    expect(iva.tipoFactor).toBe('Tasa');
    expect(etiquetaImpuesto(iva)).toBe('IVA 0%');
  });

  it('el IEPS va como traslado aparte, con su propia tasa', () => {
    const tr = trasladosDeLinea(linea({ subtotal: 1000, tax_rate: 0.16, ieps_rate: 0.08 }));
    expect(tr).toHaveLength(2);
    expect(tr[1].impuesto).toBe('003');
    expect(tr[1].nombre).toBe('IEPS');
    expect(tr[1].importe).toBe(80);
  });

  it('una línea sin base no traslada nada', () => {
    expect(trasladosDeLinea(linea({ subtotal: 0 }))).toHaveLength(0);
  });
});

describe('retenciones de una línea', () => {
  it('honorarios: retención de IVA (2/3) e ISR (10 %)', () => {
    const ret = retencionesDeLinea(linea({ subtotal: 14000, ret_iva_rate: 0.106667, ret_isr_rate: 0.10 }));
    expect(ret).toHaveLength(2);
    expect(ret[0].impuesto).toBe('002');
    expect(ret[0].importe).toBe(1493.34);
    expect(ret[1].impuesto).toBe('001');
    expect(ret[1].importe).toBe(1400);
    expect(etiquetaImpuesto(ret[1], true)).toBe('Ret. ISR 10%');
  });

  it('sin tasas de retención, no hay renglones', () => {
    expect(retencionesDeLinea(linea())).toHaveLength(0);
  });
});

describe('resumen del comprobante — se agrupa como el XML', () => {
  it('dos líneas al 16 % son UN renglón, con las bases sumadas', () => {
    const r = resumenTraslados([
      linea({ subtotal: 12887.93, tax_rate: 0.16 }),
      linea({ subtotal: 14000, tax_rate: 0.16 }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].base).toBe(26887.93);
    expect(r[0].importe).toBe(4302.07);
  });

  it('una al 16 % y otra al 8 % son DOS renglones', () => {
    const r = resumenTraslados([
      linea({ subtotal: 12887.93, tax_rate: 0.16 }),
      linea({ subtotal: 74222.89, tax_rate: 0.08 }),
    ]);
    expect(r).toHaveLength(2);
    expect(r.map((x) => etiquetaImpuesto(x))).toEqual(['IVA 16%', 'IVA 8%']);
  });

  it('la exenta no se mezcla con la de tasa 0', () => {
    const r = resumenTraslados([
      linea({ subtotal: 1000, tax_rate: 0, is_exempt: true }),
      linea({ subtotal: 2000, tax_rate: 0 }),
    ]);
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.tipoFactor).sort()).toEqual(['Exento', 'Tasa']);
  });

  it('la factura de muestra completa cuadra con sus totales', () => {
    const items = [
      linea({ subtotal: 12887.93, tax_rate: 0.16 }),
      linea({ subtotal: 74222.89, tax_rate: 0.08 }),
      linea({ subtotal: 14000, tax_rate: 0.16, ret_iva_rate: 0.106667, ret_isr_rate: 0.10 }),
      linea({ subtotal: 1500, tax_rate: 0, is_exempt: true }),
    ];
    const trasladado = resumenTraslados(items).reduce((a, x) => a + x.importe, 0);
    const retenido = resumenRetenciones(items).reduce((a, x) => a + x.importe, 0);
    const subtotal = items.reduce((a, x) => a + Number(x.subtotal), 0);

    expect(subtotal).toBeCloseTo(102610.82, 2);
    expect(trasladado).toBeCloseTo(10239.90, 2);
    expect(retenido).toBeCloseTo(2893.34, 2);
    expect(subtotal + trasladado - retenido).toBeCloseTo(109957.38, 2);
  });
});

describe('cómo se escribe la tasa', () => {
  it('sin ceros de relleno para la persona que lee', () => {
    expect(porcentaje(0.16)).toBe('16');
    expect(porcentaje(0.08)).toBe('8');
    expect(porcentaje(0)).toBe('0');
    expect(porcentaje(0.106667)).toBe('10.6667');
    expect(porcentaje(0.165)).toBe('16.5');
  });

  it('con los seis decimales del Anexo 20 para el renglón técnico', () => {
    const [iva] = trasladosDeLinea(linea({ tax_rate: 0.08 }));
    expect(etiquetaTasa(iva)).toBe('002   0.080000 %');
  });

  it('el renglón técnico de una exenta no inventa una tasa', () => {
    const [iva] = trasladosDeLinea(linea({ tax_rate: 0, is_exempt: true }));
    expect(etiquetaTasa(iva)).toBe('002   Exento');
  });
});
