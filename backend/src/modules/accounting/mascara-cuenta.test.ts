/**
 * Pruebas de la REGLA de numeración del catálogo (lógica pura, sin base).
 *
 * Los casos son los que el usuario reportó a mano: el hijo de `1-10-25-000` es
 * `1-10-25-001` —NUNCA `1-10-25-000.1` ni `1-10-25-000-001`—, se rellena el HUECO
 * antes de crecer, y el rubro (activo/pasivo/capital) se conserva siempre.
 */
import {
  anchosDeMascara, separadorDeMascara, conMascara, esFormatoMascara, normalizarAMascara,
  nivelDeSegmento, siguienteCodigoHijo, rubroDe, cuelgaDeEnMascara, MASCARA_DEFAULT,
} from './mascara-cuenta';

const M = MASCARA_DEFAULT;   // '#-##-##-###'

describe('la máscara', () => {
  it('lee anchos y separador', () => {
    expect(anchosDeMascara(M)).toEqual([1, 2, 2, 3]);
    expect(anchosDeMascara('####-###')).toEqual([4, 3]);
    expect(anchosDeMascara('')).toBeNull();
    expect(anchosDeMascara('####')).toBeNull();      // un solo segmento no es máscara
    expect(separadorDeMascara(M)).toBe('-');
    expect(separadorDeMascara('#.##.##.###')).toBe('.');
  });

  it('formatea dígitos y rechaza los que no cuadran', () => {
    expect(conMascara('11025001', M)).toBe('1-10-25-001');
    expect(conMascara('21005001', M)).toBe('2-10-05-001');
    expect(conMascara('1102500', M)).toBeNull();     // falta un dígito
    expect(conMascara('110250011', M)).toBeNull();   // sobra
  });

  it('normaliza lo que se escriba, y completa con ceros a la derecha', () => {
    for (const x of ['11025001', '1-10-25-001', '1.10.25.001', '1 10 25 001']) {
      expect(normalizarAMascara(x, M)).toBe('1-10-25-001');
    }
    expect(normalizarAMascara('11025', M)).toBe('1-10-25-000');   // escribir 1-10-25 es 1-10-25-000
    expect(normalizarAMascara('1', M)).toBe('1-00-00-000');
    expect(normalizarAMascara('110250011', M)).toBeNull();        // no cabe
    expect(normalizarAMascara('', M)).toBeNull();
  });

  it('reconoce el formato y el rubro', () => {
    expect(esFormatoMascara('1-10-25-001', M)).toBe(true);
    expect(esFormatoMascara('1-10-25-000-001', M)).toBe(false);   // el segmento de más
    expect(rubroDe('1-10-25-001', M)).toBe('1');                  // activo
    expect(rubroDe('2-10-05-001', M)).toBe('2');                  // pasivo
    expect(rubroDe('3-10-30-000', M)).toBe('3');                  // capital
  });

  it('ubica el último segmento significativo', () => {
    expect(nivelDeSegmento('1-00-00-000', M)).toBe(0);
    expect(nivelDeSegmento('1-10-00-000', M)).toBe(1);
    expect(nivelDeSegmento('1-10-25-000', M)).toBe(2);
    expect(nivelDeSegmento('1-10-25-001', M)).toBe(3);
  });
});

describe('siguienteCodigoHijo', () => {
  it('numera el segmento que sigue, con ceros a la izquierda', () => {
    expect(siguienteCodigoHijo('1-10-25-000', M, [])).toBe('1-10-25-001');
    expect(siguienteCodigoHijo('1-10-00-000', M, [])).toBe('1-10-01-000');
    expect(siguienteCodigoHijo('1-00-00-000', M, [])).toBe('1-01-00-000');
    expect(siguienteCodigoHijo('2-10-05-000', M, [])).toBe('2-10-05-001');
  });

  it('NO inventa un segmento de más ni usa punto', () => {
    const hijo = siguienteCodigoHijo('1-10-25-000', M, ['1-10-25-001']);
    expect(hijo).toBe('1-10-25-002');
    expect(hijo).not.toContain('.');
    expect(hijo!.split('-')).toHaveLength(4);
  });

  it('RELLENA EL HUECO antes de crecer', () => {
    // Existen 001, 002 y 004 → el alta nueva ocupa el 003, no el 005.
    const usados = ['1-10-25-001', '1-10-25-002', '1-10-25-004'];
    expect(siguienteCodigoHijo('1-10-25-000', M, usados)).toBe('1-10-25-003');
  });

  it('compara por DÍGITOS: da igual cómo esté escrito lo ya usado', () => {
    expect(siguienteCodigoHijo('1-10-25-000', M, ['11025001', '1.10.25.002'])).toBe('1-10-25-003');
  });

  it('el padre de último nivel ya no tiene dónde colgar', () => {
    expect(siguienteCodigoHijo('1-10-25-001', M, [])).toBeNull();
  });

  it('sin máscara utilizable no adivina', () => {
    expect(siguienteCodigoHijo('1-10-25-000', null, [])).toBeNull();
    expect(siguienteCodigoHijo('ABC', M, [])).toBeNull();
  });

  it('serie llena devuelve null (no desborda al siguiente segmento)', () => {
    const todos = Array.from({ length: 999 }, (_, i) => `11025${String(i + 1).padStart(3, '0')}`);
    expect(siguienteCodigoHijo('1-10-25-000', M, todos)).toBeNull();
  });

  it('respeta máscaras distintas a la de omisión', () => {
    expect(siguienteCodigoHijo('1000-000', '####-###', [])).toBe('1000-001');
  });
});

describe('cuelgaDeEnMascara', () => {
  it('el hijo conserva los segmentos del padre', () => {
    expect(cuelgaDeEnMascara('1-10-25-001', '1-10-25-000', M)).toBe(true);
    expect(cuelgaDeEnMascara('1-10-26-001', '1-10-25-000', M)).toBe(false);
  });

  it('un pasivo NO cuelga de un activo', () => {
    expect(cuelgaDeEnMascara('2-10-05-001', '1-10-25-000', M)).toBe(false);
  });

  it('la cuenta no cuelga de sí misma', () => {
    expect(cuelgaDeEnMascara('1-10-25-000', '1-10-25-000', M)).toBe(false);
  });
});
