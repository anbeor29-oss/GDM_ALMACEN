/**
 * Pruebas de la fecha de nacimiento derivada del RFC y la CURP.
 *
 * El "hoy" se pasa fijo en cada caso: si dependiera del reloj, la prueba del
 * siglo empezaría a fallar sola el 1 de enero, y ese es justo el día en que
 * nadie está mirando.
 */
import { deSeisDigitos, deRfc, deCurp, derivar, edad, avisoDeEdad } from './fecha-de-nacimiento';

const HOY = new Date('2026-08-17T12:00:00Z');

describe('deSeisDigitos', () => {
  it('arma la fecha en AAAA-MM-DD', () => {
    expect(deSeisDigitos('861218', HOY)).toBe('1986-12-18');
  });

  it('un año que ya pasó es de este siglo', () => {
    // En 2026: 01 → 2001, 02 → 2002, 08 → 2008.
    expect(deSeisDigitos('010101', HOY)).toBe('2001-01-01');
    expect(deSeisDigitos('020315', HOY)).toBe('2002-03-15');
    expect(deSeisDigitos('080720', HOY)).toBe('2008-07-20');
  });

  it('un año que todavía no llega es del siglo pasado', () => {
    // 27 aún no ocurre en 2026 → 1927, no 2027.
    expect(deSeisDigitos('270101', HOY)).toBe('1927-01-01');
    expect(deSeisDigitos('991231', HOY)).toBe('1999-12-31');
  });

  it('el límite se mueve solo con el calendario', () => {
    const en2030 = new Date('2030-06-01T00:00:00Z');
    // "28" ya pasó en 2030 → 2028. Con el HOY de 2026 habría sido 1928.
    expect(deSeisDigitos('280101', en2030)).toBe('2028-01-01');
    expect(deSeisDigitos('280101', HOY)).toBe('1928-01-01');
  });

  it('el año en curso cuenta como de este siglo', () => {
    expect(deSeisDigitos('260101', HOY)).toBe('2026-01-01');
  });

  it('rechaza seis dígitos que no son una fecha', () => {
    expect(deSeisDigitos('861301', HOY)).toBeNull();  // mes 13
    expect(deSeisDigitos('860230', HOY)).toBeNull();  // 30 de febrero
    expect(deSeisDigitos('860000', HOY)).toBeNull();  // día 0
    expect(deSeisDigitos('12345', HOY)).toBeNull();   // no son seis
    expect(deSeisDigitos('', HOY)).toBeNull();
  });

  it('acepta el 29 de febrero de un año bisiesto', () => {
    expect(deSeisDigitos('880229', HOY)).toBe('1988-02-29');
    // 1986 no fue bisiesto.
    expect(deSeisDigitos('860229', HOY)).toBeNull();
  });
});

describe('deRfc y deCurp', () => {
  /* El caso de la captura: HECTOR CAMPOS DIAZ. */
  it('saca la fecha del RFC de persona física', () => {
    expect(deRfc('CADH861218UX9', HOY)).toBe('1986-12-18');
  });

  it('saca la fecha de la CURP', () => {
    expect(deCurp('CADH861218HASMZC05', HOY)).toBe('1986-12-18');
  });

  it('no confunde un RFC de persona moral', () => {
    // 12 posiciones: las cifras están en otro lado y no es una persona.
    expect(deRfc('GHC1707275Y0', HOY)).toBeNull();
  });

  it('devuelve null con basura en vez de inventar una fecha', () => {
    expect(deRfc('', HOY)).toBeNull();
    expect(deCurp('CADH8612', HOY)).toBeNull();
    expect(deRfc('CADHXX1218UX9', HOY)).toBeNull();
  });
});

describe('derivar', () => {
  it('la CURP manda cuando están las dos', () => {
    const r = derivar({ rfc: 'CADH861218UX9', curp: 'CADH861218HASMZC05' }, HOY);
    expect(r).toEqual({ fecha: '1986-12-18', de: 'curp', discrepan: false });
  });

  it('usa el RFC cuando no hay CURP', () => {
    const r = derivar({ rfc: 'CADH861218UX9' }, HOY);
    expect(r).toEqual({ fecha: '1986-12-18', de: 'rfc', discrepan: false });
  });

  it('avisa cuando el RFC y la CURP no dicen lo mismo', () => {
    const r = derivar({ rfc: 'CADH861218UX9', curp: 'CADH870101HASMZC05' }, HOY);
    expect(r.discrepan).toBe(true);
    // Se queda con la de la CURP, que la asigna RENAPO del acta.
    expect(r.fecha).toBe('1987-01-01');
    expect(r.de).toBe('curp');
  });

  it('sin nada, no inventa', () => {
    expect(derivar({}, HOY)).toEqual({ fecha: null, de: null, discrepan: false });
  });
});

describe('edad y avisoDeEdad', () => {
  it('cuenta años cumplidos', () => {
    expect(edad('1986-12-18', HOY)).toBe(39);   // cumple en diciembre
    expect(edad('1986-08-17', HOY)).toBe(40);   // cumple hoy
    expect(edad('1986-08-18', HOY)).toBe(39);   // cumple mañana
  });

  it('no dice nada cuando la edad es normal', () => {
    expect(avisoDeEdad('1986-12-18', HOY)).toBeNull();
    expect(avisoDeEdad('2008-01-01', HOY)).toBeNull();  // 18 años
  });

  it('avisa por debajo de la edad mínima para trabajar', () => {
    expect(avisoDeEdad('2015-01-01', HOY)).toMatch(/edad mínima/);
  });

  it('avisa de una edad imposible — casi siempre es el siglo mal leído', () => {
    expect(avisoDeEdad('1910-01-01', HOY)).toMatch(/116 años/);
  });

  it('sin fecha no hay aviso', () => {
    expect(avisoDeEdad(null, HOY)).toBeNull();
  });
});
