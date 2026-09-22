/**
 * Fecha en formato MEXICANO (DD/MM/AAAA) para TODOS los reportes que ve una
 * persona — CSV, Excel y PDF con encabezado de la casa— y cualquier salida
 * legible de NEXO. La base y el CFDI guardan y viajan en ISO (AAAA-MM-DD); la
 * conversión a DD/MM/AAAA ocurre aquí, en un solo lugar.
 *
 * OJO: NO usar en archivos de layout OFICIAL del SAT (DIOT .txt, Contabilidad
 * Electrónica XML, IDSE): esos exigen su propio formato y no se tocan.
 */

/** 'AAAA-MM-DD' | Date | ISO con hora → 'DD/MM/AAAA'. Vacío si no hay fecha. */
export function fechaMx(v: any): string {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v);
  // Camino directo y sin zona horaria para 'AAAA-MM-DD…' (lo más común en reportes).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(v);
  if (isNaN(d.getTime())) return s;            // ya venía formateada u otra cosa: se respeta
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** Fecha y hora de generación del reporte, en mexicano: 'DD/MM/AAAA HH:MM'. */
export function fechaHoraMx(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
