/**
 * Años contables disponibles en los combos.
 *
 * El respaldo de CONTPAQi que se migra arranca en 2018, así que los selectores
 * de año de contabilidad (periodos, pólizas de venta/compra, asignación, estados)
 * deben llegar HASTA 2018 —no sólo los últimos 6 años, que dejaban fuera 2018-2020
 * y hacían empezar las listas en 2021—. Del año actual hacia atrás, descendente.
 *
 *   aniosContables() -> [2026, 2025, …, 2019, 2018]
 *
 * Si algún día se migra un respaldo más viejo, se baja ANIO_MIN_CONTABLE y ya.
 */
export const ANIO_MIN_CONTABLE = 2018;

export function aniosContables(hasta: number = new Date().getFullYear()): number[] {
  const tope = Math.max(hasta, ANIO_MIN_CONTABLE);
  const n = tope - ANIO_MIN_CONTABLE + 1;
  return Array.from({ length: n }, (_, i) => tope - i);
}
