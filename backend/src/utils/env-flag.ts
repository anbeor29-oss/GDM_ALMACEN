/**
 * env-flag.ts — lee banderas booleanas de entorno con tolerancia.
 *
 * POR QUÉ EXISTE
 * Los crons se encendían con `process.env.X === 'true'`, comparación EXACTA. Si
 * en Render alguien escribía `TRUE`, `True`, o dejaba un espacio/enter al pegar
 * el valor, el reloj se quedaba apagado EN SILENCIO (sólo un log «Deshabilitado»)
 * y «no me baja/actualiza» se diagnosticaba a ciegas. Pasó de verdad: el barrido
 * de cumplimiento y la descarga del SAT estaban en `TRUE` y por eso no corrían.
 *
 * Aquí se normaliza —mayúsculas/minúsculas y espacios— para que `TRUE`, `true`
 * y ` true ` signifiquen lo mismo.
 */

/** true si la variable está ENCENDIDA ('true' sin importar may/min ni espacios). */
export function banderaEncendida(valor: string | undefined | null): boolean {
  return (valor ?? '').trim().toLowerCase() === 'true';
}

/** true si la variable está explícitamente APAGADA ('false'). Para banderas que
 *  vienen encendidas por defecto y sólo se apagan a propósito. */
export function banderaApagada(valor: string | undefined | null): boolean {
  return (valor ?? '').trim().toLowerCase() === 'false';
}
