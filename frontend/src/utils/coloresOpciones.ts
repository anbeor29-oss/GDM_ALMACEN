/**
 * Paleta para las OPCIONES de menú (pestañas) de las pantallas con submenús.
 *
 * La idea (a pedido del usuario): las páginas van en BLANCO; sólo las OPCIONES
 * llevan color —varios de los que ya usa el sistema— para distinguir de un
 * vistazo qué tiene cada pantalla, como las hojas de colores de Excel. La opción
 * activa se rellena con su color; las demás quedan como pastilla de contorno.
 *
 * Las clases van COMPLETAS y literales a propósito: Tailwind sólo genera las que
 * ve escritas en el código, así que un `bg-${x}` armado en runtime se purgaría.
 */
export const PALETA_OPCIONES = [
  { on: 'bg-blue-600 text-white border-blue-600',       off: 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50' },
  { on: 'bg-emerald-600 text-white border-emerald-600', off: 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50' },
  { on: 'bg-violet-600 text-white border-violet-600',   off: 'bg-white text-violet-700 border-violet-200 hover:bg-violet-50' },
  { on: 'bg-amber-500 text-white border-amber-500',     off: 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50' },
  { on: 'bg-rose-600 text-white border-rose-600',       off: 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50' },
  { on: 'bg-cyan-600 text-white border-cyan-600',       off: 'bg-white text-cyan-700 border-cyan-200 hover:bg-cyan-50' },
  { on: 'bg-indigo-600 text-white border-indigo-600',   off: 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50' },
  { on: 'bg-teal-600 text-white border-teal-600',       off: 'bg-white text-teal-700 border-teal-200 hover:bg-teal-50' },
  { on: 'bg-orange-500 text-white border-orange-500',   off: 'bg-white text-orange-700 border-orange-200 hover:bg-orange-50' },
  { on: 'bg-fuchsia-600 text-white border-fuchsia-600', off: 'bg-white text-fuchsia-700 border-fuchsia-200 hover:bg-fuchsia-50' },
];

/** Clase base de una «pastilla» de opción (sin color). */
export const PILL_OPCION = 'px-3 py-1.5 rounded-lg text-sm font-medium border whitespace-nowrap transition-colors';

/** Clases de color de la opción i (cíclico), según esté activa o no. */
export function colorOpcion(i: number, activa: boolean): string {
  const n = PALETA_OPCIONES.length;
  const c = PALETA_OPCIONES[((i % n) + n) % n];
  return activa ? c.on : c.off;
}

/** Atajo: clase COMPLETA de una pastilla de opción (base + color). */
export function claseOpcion(i: number, activa: boolean): string {
  return `${PILL_OPCION} ${colorOpcion(i, activa)}`;
}
