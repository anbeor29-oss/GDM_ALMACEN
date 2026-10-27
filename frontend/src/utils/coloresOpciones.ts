/**
 * Estilo de las OPCIONES de menú (pestañas) de las pantallas con submenús.
 *
 * La idea (a pedido del usuario): las páginas van en BLANCO; las OPCIONES se ven
 * como las PESTAÑAS DE HOJA DE EXCEL —todas las inactivas en VERDE CLARO y la
 * activa en AZUL— para saber de un vistazo en cuál estás parado. Es un esquema
 * uniforme de DOS colores: antes cada opción tomaba un color distinto, pero se
 * cambió a este (verde claro / azul) para que todas las pantallas se vean igual.
 *
 * Las clases van COMPLETAS y literales a propósito: Tailwind sólo genera las que
 * ve escritas en el código, así que un `bg-${x}` armado en runtime se purgaría.
 */

/** Pestaña ACTIVA: azul relleno. */
const OPCION_ACTIVA = 'bg-blue-600 text-white border-blue-600';
/** Pestaña INACTIVA: verde claro (como las hojas de Excel en reposo). */
const OPCION_INACTIVA = 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200';

/**
 * Se conserva para compatibilidad con quien aún importe la paleta: todas las
 * entradas son el MISMO par (verde claro / azul). Ya no se distingue por color.
 */
export const PALETA_OPCIONES = [{ on: OPCION_ACTIVA, off: OPCION_INACTIVA }];

/** Clase base de una «pastilla» de opción (sin color). */
export const PILL_OPCION = 'px-3 py-1.5 rounded-lg text-sm font-medium border whitespace-nowrap transition-colors';

/** Clases de color de la opción, según esté activa o no (el índice ya no influye:
 *  todas las inactivas van verde claro y la activa azul, como Excel). */
export function colorOpcion(_i: number, activa: boolean): string {
  return activa ? OPCION_ACTIVA : OPCION_INACTIVA;
}

/** Atajo: clase COMPLETA de una pastilla de opción (base + color). */
export function claseOpcion(i: number, activa: boolean): string {
  return `${PILL_OPCION} ${colorOpcion(i, activa)}`;
}
