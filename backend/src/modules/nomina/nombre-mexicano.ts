/**
 * nombre-mexicano — partir un nombre completo usando la CURP como juez.
 *
 * EL PROBLEMA
 * El CFDI trae el nombre en una sola cadena, tal como el SAT lo tiene:
 * "MARIA DE LOS ANGELES DE LA TORRE GARCIA". Partirlo por espacios es una
 * lotería —¿son dos nombres y dos apellidos?, ¿tres y uno?— y equivocarse
 * significa dar de alta a alguien con los apellidos cambiados de lugar, que es
 * de las cosas más difíciles de notar y más molestas de corregir después.
 *
 * LA SALIDA
 * La CURP no se inventa: RENAPO la construye con reglas fijas a partir de los
 * apellidos y el nombre. Las cuatro primeras posiciones son
 *
 *     1ª  letra inicial del apellido paterno
 *     2ª  primera vocal INTERNA del apellido paterno
 *     3ª  letra inicial del apellido materno (X si no tiene)
 *     4ª  letra inicial del primer nombre — saltando MARIA o JOSÉ cuando hay
 *         un segundo nombre, porque son tan frecuentes que no distinguen
 *
 * Así que se prueban todos los cortes posibles del nombre y se conserva el que
 * REPRODUCE esas cuatro letras. Ya no es una adivinanza: es una comprobación.
 *
 * CUANDO NADA CUADRA
 * Puede pasar —un nombre mal capturado en el origen, una CURP con homonimia
 * resuelta a mano—. Entonces se devuelve el reparto más frecuente y se marca
 * `incierto`, para que la pantalla lo pida confirmar en vez de guardarlo como
 * si fuera un hecho. Vale más un campo señalado que un apellido equivocado.
 *
 * Este archivo NO importa nada a propósito: es una función pura y se puede
 * probar sin levantar base de datos.
 */

const VOCALES = 'AEIOU';

/** Partículas que la CURP ignora y que nunca son el apellido por sí solas. */
const PARTICULAS = new Set([
  'DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'MC', 'MAC', 'VAN', 'VON', 'DA', 'DI',
  'SAN', 'SANTA',
]);

/** Nombres que RENAPO salta cuando son el primero de dos o más. */
const NOMBRES_IGNORADOS = new Set(['MARIA', 'MA', 'JOSE', 'J']);

/** Se queda con la primera palabra que no sea partícula. */
export function palabraSignificativa(apellido: string): string {
  const partes = apellido.split(/\s+/).filter(Boolean);
  for (const p of partes) if (!PARTICULAS.has(p)) return p;
  return partes[partes.length - 1] || '';
}

/** Primera vocal a partir de la segunda letra. 'X' si no hay ninguna. */
export function vocalInterna(palabra: string): string {
  for (let i = 1; i < palabra.length; i++) {
    if (VOCALES.includes(palabra[i])) return palabra[i];
  }
  return 'X';
}

/** Las 4 primeras posiciones de la CURP que produciría este reparto. */
export function cuatroDeLaCurp(paterno: string, materno: string, nombres: string): string {
  const pat = palabraSignificativa(paterno);
  const mat = palabraSignificativa(materno);

  const lista = nombres.split(/\s+/).filter(Boolean);
  let util = lista[0] || '';
  if (lista.length > 1 && NOMBRES_IGNORADOS.has(util)) util = lista[1];

  return [pat[0] || 'X', vocalInterna(pat), mat[0] || 'X', util[0] || 'X'].join('');
}

export interface NombrePartido {
  nombre: string;
  apellido_pat: string;
  apellido_mat: string;
  /** true cuando ningún corte reprodujo la CURP: hay que confirmarlo a mano. */
  incierto: boolean;
}

export function partirNombre(nombreCompleto: string, curp?: string | null): NombrePartido {
  const palabras = String(nombreCompleto || '')
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (palabras.length === 0) {
    return { nombre: '', apellido_pat: '', apellido_mat: '', incierto: true };
  }
  if (palabras.length === 1) {
    return { nombre: palabras[0], apellido_pat: '', apellido_mat: '', incierto: true };
  }
  if (palabras.length === 2) {
    /* Con dos palabras no hay nada que decidir: nombre y un apellido. Se marca
     * incierto igual, porque también podría ser un nombre compuesto. */
    return { nombre: palabras[0], apellido_pat: palabras[1], apellido_mat: '', incierto: true };
  }

  const clave = curp ? String(curp).toUpperCase().slice(0, 4) : null;

  if (clave && /^[A-Z]{4}$/.test(clave)) {
    /* i = dónde empiezan los apellidos, j = dónde empieza el materno. */
    for (let i = 1; i < palabras.length - 1; i++) {
      for (let j = i + 1; j < palabras.length; j++) {
        const nombres = palabras.slice(0, i).join(' ');
        const pat = palabras.slice(i, j).join(' ');
        const mat = palabras.slice(j).join(' ');
        if (cuatroDeLaCurp(pat, mat, nombres) === clave) {
          return { nombre: nombres, apellido_pat: pat, apellido_mat: mat, incierto: false };
        }
      }
    }
    /* Sin apellido materno: existe, y su CURP lleva X en la tercera posición. */
    for (let i = 1; i < palabras.length; i++) {
      const nombres = palabras.slice(0, i).join(' ');
      const pat = palabras.slice(i).join(' ');
      if (cuatroDeLaCurp(pat, '', nombres) === clave) {
        return { nombre: nombres, apellido_pat: pat, apellido_mat: '', incierto: false };
      }
    }
  }

  return {
    nombre: palabras.slice(0, palabras.length - 2).join(' '),
    apellido_pat: palabras[palabras.length - 2],
    apellido_mat: palabras[palabras.length - 1],
    incierto: true,
  };
}
