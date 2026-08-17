/**
 * Pruebas del importe con letra.
 *
 * Es el renglón que un cliente lee para verificar que el papel dice lo mismo
 * que la cifra, así que aquí importa cada palabra: la moneda, la fracción y el
 * cierre. Y es donde ya se coló un error antes —"M.N." detrás de una cifra en
 * euros—, que es decir a la vez que son euros y que son pesos mexicanos.
 */
import { montoEnLetra, sufijoMoneda, palabraMoneda } from './pdf-helpers';

describe('sufijoMoneda', () => {
  it('sólo el peso cierra con M.N. — es la abreviatura de moneda nacional', () => {
    expect(sufijoMoneda('MXN')).toBe('M.N.');
  });

  it('las divisas cierran con su clave ISO, la misma que va en el XML', () => {
    expect(sufijoMoneda('USD')).toBe('USD');
    expect(sufijoMoneda('EUR')).toBe('EUR');
    expect(sufijoMoneda('GBP')).toBe('GBP');
    expect(sufijoMoneda('JPY')).toBe('JPY');
  });
});

describe('palabraMoneda', () => {
  it('nombra la moneda en plural y en español', () => {
    expect(palabraMoneda('MXN')).toBe('PESOS');
    expect(palabraMoneda('JPY')).toBe('YENES');
    expect(palabraMoneda('GBP')).toBe('LIBRAS ESTERLINAS');
  });

  it('una moneda que no está en el catálogo sale con su clave, no inventada', () => {
    expect(palabraMoneda('SEK')).toBe('SEK');
  });
});

describe('montoEnLetra — monedas con centésimos', () => {
  it('el peso lleva la fracción y cierra con M.N.', () => {
    expect(montoEnLetra(1234.56, 'MXN')).toBe('MIL DOSCIENTOS TREINTA Y CUATRO PESOS 56/100 M.N.');
  });

  it('los euros NO cierran con M.N.', () => {
    const t = montoEnLetra(1234.56, 'EUR');
    expect(t).toContain('EUROS 56/100 EUR');
    expect(t).not.toContain('M.N.');
  });

  it('la fracción en cero se escribe 00/100, no se omite', () => {
    expect(montoEnLetra(100, 'MXN')).toBe('CIEN PESOS 00/100 M.N.');
  });

  it('"UN MILLÓN DE PESOS" sólo en millones exactos', () => {
    expect(montoEnLetra(1_000_000, 'MXN')).toContain('UN MILLÓN DE PESOS');
    expect(montoEnLetra(1_200_000, 'MXN')).toContain('MIL PESOS');
    expect(montoEnLetra(1_200_000, 'MXN')).not.toContain(' DE PESOS');
  });
});

describe('montoEnLetra — el yen no tiene centavos', () => {
  /* El sen se abolió en 1953 y el c_Moneda del SAT le asigna 0 decimales.
   * "MIL YENES 00/100" declara una fracción que no existe. */
  it('omite el /100 por completo', () => {
    expect(montoEnLetra(1200, 'JPY')).toBe('MIL DOSCIENTOS YENES JPY');
  });

  it('no deja rastro de la fracción ni siquiera con decimales de entrada', () => {
    const t = montoEnLetra(1200.4, 'JPY');
    expect(t).not.toContain('/100');
    expect(t).toBe('MIL DOSCIENTOS YENES JPY');
  });

  /* "UNO" y no "UN": es como escribe numeroALetras desde siempre, y así salen
   * ya todas las facturas en pesos. Se fija aquí tal cual para que se note si
   * alguien lo cambia — cambiarlo movería la redacción de TODOS los
   * comprobantes, no sólo los de yenes. */
  it('redondea en vez de truncar — truncar perdería hasta un yen del total', () => {
    expect(montoEnLetra(1200.6, 'JPY')).toBe('MIL DOSCIENTOS UNO YENES JPY');
  });

  it('el redondeo se refleja en el "DE" de los millones', () => {
    // 999,999.6 redondea a un millón: tiene que decir "UN MILLÓN DE YENES".
    expect(montoEnLetra(999_999.6, 'JPY')).toBe('UN MILLÓN DE YENES JPY');
  });

  it('el peso chileno se comporta igual (ISO 4217, cero decimales)', () => {
    expect(montoEnLetra(5000, 'CLP')).toContain('PESOS CHILENOS CLP');
    expect(montoEnLetra(5000, 'CLP')).not.toContain('/100');
  });

  it('el peso mexicano NO se ve afectado', () => {
    expect(montoEnLetra(1200, 'MXN')).toContain('00/100 M.N.');
  });
});
