/**
 * Años contables disponibles en los combos.
 *
 * El respaldo más viejo que se migra arranca en 2017 (hay un respaldo con los
 * últimos meses de 2017 y otro de 2018 en adelante), así que los selectores de año
 * de contabilidad (periodos, pólizas de venta/compra, asignación, estados) deben
 * llegar HASTA 2017 —si no, las pólizas de 2017 quedan fuera del combo aunque estén
 * cargadas—. Del año actual hacia atrás, descendente.
 *
 *   aniosContables() -> [2026, 2025, …, 2018, 2017]
 *
 * Si algún día se migra un respaldo más viejo, se baja ANIO_MIN_CONTABLE y ya.
 */
export const ANIO_MIN_CONTABLE = 2017;

export function aniosContables(hasta: number = new Date().getFullYear()): number[] {
  const tope = Math.max(hasta, ANIO_MIN_CONTABLE);
  const n = tope - ANIO_MIN_CONTABLE + 1;
  return Array.from({ length: n }, (_, i) => tope - i);
}
