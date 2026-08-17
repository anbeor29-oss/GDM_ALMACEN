/**
 * Pruebas del reparto de nombre contra la CURP.
 *
 * Los casos NO son inventos: son las formas en que realmente vienen escritos
 * los nombres en los CFDI mexicanos, y cada una rompe una suposición distinta
 * de "partir por espacios".
 *
 * Las CURP que aparecen aquí son sintéticas —se construyen con la regla, no
 * pertenecen a nadie— porque lo que se prueba es la regla.
 */
import {
  partirNombre, cuatroDeLaCurp, vocalInterna, palabraSignificativa,
} from './nombre-mexicano';

describe('vocalInterna', () => {
  it('toma la primera vocal a partir de la segunda letra', () => {
    expect(vocalInterna('PEREZ')).toBe('E');
    expect(vocalInterna('GARCIA')).toBe('A');
    // La vocal inicial NO cuenta: es la regla que más se equivoca a mano.
    expect(vocalInterna('ORTIZ')).toBe('I');
  });

  it('devuelve X cuando no hay vocal interna', () => {
    expect(vocalInterna('NG')).toBe('X');
    expect(vocalInterna('A')).toBe('X');
  });
});

describe('palabraSignificativa', () => {
  it('salta las partículas', () => {
    expect(palabraSignificativa('DE LA TORRE')).toBe('TORRE');
    expect(palabraSignificativa('DEL VALLE')).toBe('VALLE');
    expect(palabraSignificativa('VAN DER BERG')).toBe('DER');
  });

  it('deja intacto un apellido normal', () => {
    expect(palabraSignificativa('HERNANDEZ')).toBe('HERNANDEZ');
  });
});

describe('cuatroDeLaCurp', () => {
  it('arma las cuatro posiciones con la regla de RENAPO', () => {
    // PEREZ → P + E ; LOPEZ → L ; JUAN → J
    expect(cuatroDeLaCurp('PEREZ', 'LOPEZ', 'JUAN')).toBe('PELJ');
  });

  it('salta MARIA y JOSE cuando hay un segundo nombre', () => {
    expect(cuatroDeLaCurp('TORRE', 'GARCIA', 'MARIA DE LOS ANGELES')).toBe('TOGD');
    expect(cuatroDeLaCurp('RAMIREZ', 'SOTO', 'JOSE LUIS')).toBe('RASL');
  });

  it('NO los salta cuando son el único nombre', () => {
    expect(cuatroDeLaCurp('RAMIREZ', 'SOTO', 'JOSE')).toBe('RASJ');
  });

  it('pone X cuando no hay apellido materno', () => {
    expect(cuatroDeLaCurp('PEREZ', '', 'JUAN')).toBe('PEXJ');
  });
});

describe('partirNombre', () => {
  it('reparte el caso simple usando la CURP', () => {
    const r = partirNombre('JUAN PEREZ LOPEZ', 'PELJ800101HDFRPN00');
    expect(r).toEqual({
      nombre: 'JUAN', apellido_pat: 'PEREZ', apellido_mat: 'LOPEZ', incierto: false,
    });
  });

  it('resuelve un nombre compuesto sin confundirlo con un apellido', () => {
    // "JOSE LUIS" son dos nombres. Partir por los dos últimos tokens acertaría
    // aquí de casualidad; la CURP lo confirma.
    const r = partirNombre('JOSE LUIS RAMIREZ SOTO', 'RASL750315HDFMTS09');
    expect(r.nombre).toBe('JOSE LUIS');
    expect(r.apellido_pat).toBe('RAMIREZ');
    expect(r.apellido_mat).toBe('SOTO');
    expect(r.incierto).toBe(false);
  });

  it('resuelve apellidos con partícula, donde partir por espacios falla', () => {
    // Seis palabras: "MARIA DE LOS ANGELES" + "DE LA TORRE" + "GARCIA".
    // El reparto ingenuo daría apellidos "LA TORRE" y "GARCIA" — mal.
    const r = partirNombre('MARIA DE LOS ANGELES DE LA TORRE GARCIA', 'TOGD900520MDFRRN05');
    expect(r.nombre).toBe('MARIA DE LOS ANGELES');
    expect(r.apellido_pat).toBe('DE LA TORRE');
    expect(r.apellido_mat).toBe('GARCIA');
    expect(r.incierto).toBe(false);
  });

  it('reconoce a quien no tiene apellido materno (X en la CURP)', () => {
    const r = partirNombre('ANA SOFIA MENDOZA', 'MEXA880714MDFNNN02');
    expect(r.apellido_pat).toBe('MENDOZA');
    expect(r.apellido_mat).toBe('');
    expect(r.nombre).toBe('ANA SOFIA');
    expect(r.incierto).toBe(false);
  });

  it('marca INCIERTO cuando la CURP no cuadra, en vez de fingir certeza', () => {
    const r = partirNombre('JUAN PEREZ LOPEZ', 'XXXX800101HDFRPN00');
    expect(r.incierto).toBe(true);
    // Aun así devuelve el reparto más frecuente, para no dejar el formulario vacío.
    expect(r.apellido_pat).toBe('PEREZ');
    expect(r.apellido_mat).toBe('LOPEZ');
  });

  it('marca INCIERTO cuando no hay CURP con qué comprobar', () => {
    expect(partirNombre('JUAN PEREZ LOPEZ', null).incierto).toBe(true);
    expect(partirNombre('JUAN PEREZ LOPEZ', '').incierto).toBe(true);
  });

  /* ── Bordes ── */

  it('no truena con una cadena vacía', () => {
    expect(partirNombre('', 'PELJ800101HDFRPN00')).toEqual({
      nombre: '', apellido_pat: '', apellido_mat: '', incierto: true,
    });
  });

  it('no truena con una sola palabra', () => {
    const r = partirNombre('MADONNA', 'MAXX800101MDFDDN00');
    expect(r.nombre).toBe('MADONNA');
    expect(r.incierto).toBe(true);
  });

  it('normaliza mayúsculas, comas y espacios de más', () => {
    const r = partirNombre('  juan,  perez   lopez ', 'PELJ800101HDFRPN00');
    expect(r).toEqual({
      nombre: 'JUAN', apellido_pat: 'PEREZ', apellido_mat: 'LOPEZ', incierto: false,
    });
  });
});
