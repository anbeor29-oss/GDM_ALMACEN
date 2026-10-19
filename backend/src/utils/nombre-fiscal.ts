/**
 * nombre-fiscal — normaliza la denominación de clientes/proveedores para el
 * catálogo comercial.
 *
 * A las personas MORALES se les quita el sufijo societario del final (S.A. DE
 * C.V., S. DE R.L. DE C.V., S.C., S.A.P.I. DE C.V., etc.) para conservar sólo la
 * denominación o razón social «limpia». A las personas FÍSICAS se les deja igual:
 * no traen sufijo societario, así que el nombre pasa sin tocar.
 *
 * Es un recorte conservador: sólo corta sufijos reconocidos al FINAL de la
 * cadena, con o sin puntos y comas. Si el nombre no termina en uno, no cambia.
 */

/* Sufijos societarios mexicanos. Van de MÁS largo a MÁS corto para que, anclados
 * al final, gane el más específico (S.A. DE C.V. antes que S.A.). */
const SUFIJOS = [
  'S\\.?A\\.?P\\.?I\\.?\\s+DE\\s+C\\.?V\\.?',
  'S\\.?A\\.?B\\.?\\s+DE\\s+C\\.?V\\.?',
  'S\\.?A\\.?\\s+DE\\s+C\\.?V\\.?',
  'S\\.?\\s+DE\\s+R\\.?L\\.?\\s+DE\\s+C\\.?V\\.?',
  'S\\.?\\s+DE\\s+R\\.?L\\.?',
  'S\\.?\\s+EN\\s+C\\.?(?:\\s+POR\\s+A\\.?)?',
  'S\\.?A\\.?S\\.?',
  'S\\.?A\\.?',
  'S\\.?C\\.?L\\.?',
  'S\\.?N\\.?C\\.?',
  'S\\.?C\\.?',
  'A\\.?C\\.?',
  'S\\.?\\s+DE\\s+P\\.?R\\.?\\s+DE\\s+R\\.?L\\.?',
];

const RE_SUFIJO = new RegExp('[,\\s]+(?:' + SUFIJOS.join('|') + ')\\s*$', 'i');

/** Quita el sufijo societario del final (morales) y deja intacto el nombre de las
 *  físicas. Colapsa espacios y recorta comas/espacios sobrantes. */
export function normalizarNombreFiscal(nombre: string | null | undefined): string {
  let s = String(nombre || '').trim().replace(/\s+/g, ' ');
  if (!s) return s;
  // Puede traer el sufijo repetido o con coma colgando; se recorta hasta estabilizar.
  let previo = '';
  while (s !== previo) {
    previo = s;
    s = s.replace(RE_SUFIJO, '').replace(/[,\s]+$/, '').trim();
  }
  return s || String(nombre || '').trim();
}
