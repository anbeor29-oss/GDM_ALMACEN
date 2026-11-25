import { decimalesDeMoneda, redondea, conDecimales, dentroDeTolerancia } from './decimales';

describe('decimalesDeMoneda', () => {
  it('las monedas que se facturan hoy son de 2 decimales', () => {
    expect(decimalesDeMoneda('MXN')).toBe(2);
    expect(decimalesDeMoneda('USD')).toBe(2);
    expect(decimalesDeMoneda('EUR')).toBe(2);
    expect(decimalesDeMoneda('GBP')).toBe(2);
  });

  it('no distingue mayúsculas ni espacios', () => {
    expect(decimalesDeMoneda(' mxn ')).toBe(2);
  });

  it('sin moneda, pesos', () => {
    expect(decimalesDeMoneda(null)).toBe(2);
    expect(decimalesDeMoneda(undefined)).toBe(2);
    expect(decimalesDeMoneda('')).toBe(2);
  });
});

describe('redondea', () => {
  it('el caso real: 400 piezas a 32.219827 cierra en 12,887.93', () => {
    expect(redondea(400 * 32.219827, 2)).toBe(12887.93);
  });

  it('y con el IVA el total cierra EXACTO en 14,950.00', () => {
    const sub = redondea(400 * 32.219827, 2);
    const iva = redondea(sub * 0.16, 2);
    expect(sub).toBe(12887.93);
    expect(iva).toBe(2062.07);
    expect(redondea(sub + iva, 2)).toBe(14950);
  });

  it('medio centavo sube, aunque en binario quede por debajo', () => {
    // Math.round(1.005 * 100) / 100 da 1.00: 1.005 es 1.00499999999999989.
    expect(redondea(1.005, 2)).toBe(1.01);
    expect(redondea(2.675, 2)).toBe(2.68);
    expect(redondea(0.615, 2)).toBe(0.62);
  });

  it('respeta los 6 decimales del precio unitario', () => {
    expect(redondea(32.2198274, 6)).toBe(32.219827);
    expect(redondea(32.2198276, 6)).toBe(32.219828);
  });

  it('los negativos redondean con la misma magnitud', () => {
    expect(redondea(-1.005, 2)).toBe(-1);   // medio hacia arriba = hacia cero
    expect(redondea(-1.006, 2)).toBe(-1.01);
  });

  it('un valor que no es número vale cero, no NaN', () => {
    expect(redondea(undefined)).toBe(0);
    expect(redondea(null)).toBe(0);
    expect(redondea('abc' as any)).toBe(0);
    expect(redondea(Infinity)).toBe(0);
  });

  it('lee números que vienen como texto (es lo que entrega pg con NUMERIC)', () => {
    expect(redondea('12887.9308', 2)).toBe(12887.93);
  });
});

describe('conDecimales', () => {
  it('rellena los decimales que pide el XML', () => {
    expect(conDecimales(12887.93, 2)).toBe('12887.93');
    expect(conDecimales(14950, 2)).toBe('14950.00');
    expect(conDecimales(32.219827, 6)).toBe('32.219827');
    expect(conDecimales(32.22, 6)).toBe('32.220000');
  });

  it('nunca entrega notación científica ni NaN', () => {
    expect(conDecimales(0, 2)).toBe('0.00');
    expect(conDecimales(NaN, 2)).toBe('0.00');
  });
});

describe('dentroDeTolerancia', () => {
  it('el arrastre del redondeo pasa: 12,887.9308 declarado como 12,887.93', () => {
    expect(dentroDeTolerancia(400 * 32.219827, 12887.93, 2)).toBe(true);
  });

  it('el centavo justo pasa', () => {
    expect(dentroDeTolerancia(100.01, 100.0, 2)).toBe(true);
  });

  it('SIETE centavos NO pasan — es el rechazo que veíamos', () => {
    // 400 x 32.22 (el precio truncado en la base) contra el importe guardado.
    expect(dentroDeTolerancia(400 * 32.22, 12887.93, 2)).toBe(false);
  });

  it('a 6 decimales la tolerancia se encoge a una millonésima', () => {
    expect(dentroDeTolerancia(12887.9308, 12887.93, 6)).toBe(false);
    expect(dentroDeTolerancia(12887.9308, 12887.930801, 6)).toBe(true);
  });
});
