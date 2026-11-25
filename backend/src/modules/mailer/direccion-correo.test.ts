/**
 * El caso real: un recibo de nómina a `anbeor@hotmail.ocm`.
 *
 * `hotmail.ocm` pasa cualquier validación de sintaxis —tiene @, tiene punto,
 * tiene letras después— y sólo se cae hasta que el servidor contesta un 550.
 * Lo que lo delata es la forma del dedazo: `ocm` son las letras de `com`
 * cambiadas de lugar.
 *
 * Aquí se prueba la parte PURA (sin red). El DNS, que es quien decide si se
 * bloquea el envío, no se prueba: depende de la red y esta suite corre sin ella.
 */
import { distancia, dominioSugerido, correoSugerido, revisarDireccion, dominioRecibeCorreo } from './direccion-correo';

describe('distancia con transposición', () => {
  it('cambiar dos letras de lugar cuesta 1, no 2', () => {
    // Con la distancia clásica esto daría 2 y se perdería entre dominios ajenos.
    expect(distancia('ocm', 'com')).toBe(1);
  });
  it('iguales = 0', () => expect(distancia('gmail.com', 'gmail.com')).toBe(0));
  it('una letra de más cuesta 1', () => expect(distancia('gmaill.com', 'gmail.com')).toBe(1));
});

describe('dominio sugerido', () => {
  it('hotmail.ocm → hotmail.com', () => {
    expect(dominioSugerido('hotmail.ocm')).toBe('hotmail.com');
  });
  it.each([
    ['gmial.com', 'gmail.com'],
    ['hotmial.com', 'hotmail.com'],
    ['yahoo.con', 'yahoo.com'],
    ['outlok.com', 'outlook.com'],
  ])('%s → %s', (malo, bueno) => expect(dominioSugerido(malo)).toBe(bueno));

  it('un dominio escrito bien no sugiere nada', () => {
    expect(dominioSugerido('gmail.com')).toBeNull();
    expect(dominioSugerido('hotmail.com')).toBeNull();
  });

  it('un dominio propio no se confunde con uno común', () => {
    // Lo importante: NO proponerle a nadie que su dominio real está mal escrito.
    expect(dominioSugerido('hcgm.com.mx')).toBeNull();
    expect(dominioSugerido('sat.gob.mx')).toBeNull();
    expect(dominioSugerido('contoso-industrial.mx')).toBeNull();
  });
});

describe('correo sugerido', () => {
  it('corrige el dominio y conserva el buzón', () => {
    expect(correoSugerido('alguien@hotmail.ocm')).toBe('alguien@hotmail.com');
  });
  it('respeta un correo bien escrito', () => {
    expect(correoSugerido('alguien@gmail.com')).toBeNull();
  });
  it('sin @ no hay nada que corregir', () => {
    expect(correoSugerido('alguien')).toBeNull();
  });
});

describe('revisión sin red', () => {
  it('rechaza lo que ni siquiera es una dirección', async () => {
    const r = await revisarDireccion('alguien@sinpunto', false);
    expect(r.ok).toBe(false);
  });
  it('acepta la sintaxis pero deja la corrección a la vista', async () => {
    const r = await revisarDireccion('alguien@hotmail.ocm', false);
    expect(r.ok).toBe(true);                       // sin DNS no se bloquea
    expect(r.sugerencia).toBe('alguien@hotmail.com');
  });
});

describe('dominio vacío', () => {
  it('no recibe correo', async () => {
    await expect(dominioRecibeCorreo('')).resolves.toBe('NO');
  });
});
