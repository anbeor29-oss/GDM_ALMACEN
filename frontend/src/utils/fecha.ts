/**
 * fecha — un solo formato de fecha en todo el sistema: DD/MM/AAAA.
 *
 * POR QUÉ EXISTE
 * Había tres formas de mostrar una fecha repartidas por la aplicación:
 *
 *   `new Date(d).toLocaleDateString('es-MX')` → "19/8/2026", sin ceros. Al
 *   listar, las columnas quedan disparejas y "1/8" y "11/8" no se leen a la
 *   misma velocidad.
 *
 *   El ISO crudo de la base → "2026-08-19".
 *
 *   `<input type="date">` → lo dibuja el NAVEGADOR con el formato del sistema
 *   operativo. En una máquina en inglés pide mm/dd/aaaa, y no hay CSS ni
 *   atributo que lo cambie. Para eso está `CampoFecha`.
 *
 * Tres formatos en la misma pantalla obligan a leer cada fecha dos veces para
 * saber cuál es el día y cuál el mes. Aquí hay uno.
 *
 * EL DETALLE QUE IMPORTA: LAS FECHAS SIN HORA
 * Una fecha de calendario que llega como "2026-08-19" se parte a mano y NO se
 * pasa por `new Date()`. Ese constructor la interpreta como medianoche UTC, y
 * en México —seis horas atrás— la convierte en el 18. Un vencimiento, una fecha
 * de ingreso o una baja se recorrerían un día entero.
 */

const MESES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

/**
 * DD/MM/AAAA. Devuelve el guión largo cuando no hay fecha, para que una celda
 * vacía se vea vacía a propósito y no como un error.
 */
export function fechaMx(v: any, vacio = '—'): string {
  if (v === null || v === undefined || v === '') return vacio;

  /* Fecha de calendario pura: se parte a mano. Pasarla por Date la recorrería
   * un día en cualquier huso al oeste de Greenwich. */
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;

  const d = v instanceof Date ? v : new Date(s);
  if (Number.isNaN(d.getTime())) return vacio;

  return `${String(d.getDate()).padStart(2, '0')}/` +
         `${String(d.getMonth() + 1).padStart(2, '0')}/` +
         `${d.getFullYear()}`;
}

/** DD/MM/AAAA HH:MM — para lo que sí es un instante: un timbrado, un envío. */
export function fechaHoraMx(v: any, vacio = '—'): string {
  if (v === null || v === undefined || v === '') return vacio;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return vacio;
  return `${fechaMx(d)} ${String(d.getHours()).padStart(2, '0')}:` +
         `${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * "19 ago 2026" — para encabezados y textos corridos, donde una fecha en
 * números interrumpe la lectura.
 */
export function fechaLargaMx(v: any, vacio = '—'): string {
  const corta = fechaMx(v, '');
  if (!corta) return vacio;
  const [d, m, a] = corta.split('/');
  return `${Number(d)} ${MESES[Number(m) - 1]} ${a}`;
}

/** AAAA-MM-DD en hora LOCAL, para mandar a la API. */
export function aIsoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
         `${String(d.getDate()).padStart(2, '0')}`;
}
