/**
 * mascara-cuenta — LA REGLA para numerar una cuenta del catálogo.
 *
 * Un catálogo mexicano no numera «el siguiente número»: numera con una MÁSCARA de
 * segmentos de ancho fijo, p. ej. `#-##-##-###` →
 *
 *     1-10-25-001
 *     │ │  │  └── subcuenta de detalle (3 dígitos)
 *     │ │  └───── subcuenta        (2)
 *     │ └──────── mayor            (2)
 *     └────────── RUBRO            (1): 1 activo · 2 pasivo · 3 capital · 4 ingresos · 5/6 costos y gastos
 *
 * De ahí las dos reglas que pidió el usuario y que este módulo implementa:
 *
 *   1. FORMATO. Una cuenta nueva no lleva «un número»: lleva el código en la máscara
 *      de la empresa, con sus ceros a la izquierda y sus separadores. Nunca
 *      `1-10-25-000.1` ni `1-10-25-000-001` (un segmento de más): el hijo de
 *      `1-10-25-000` es `1-10-25-001`.
 *   2. HUECOS. Se ocupa el PRIMER número libre de la serie (001, 002, 003…), no el
 *      siguiente al mayor: así un alta nueva rellena el hueco que dejó una cuenta
 *      dada de baja y la serie sólo crece cuando ya no hay huecos.
 *
 * El RUBRO (primer segmento) es lo que amarra activo/pasivo/capital, así que el hijo
 * SIEMPRE conserva los segmentos del padre y sólo mueve el suyo: por construcción no
 * se puede colgar un pasivo de un activo.
 *
 * Es lógica PURA (sin base de datos) para poder probarla; quien la llama le pasa los
 * códigos ya ocupados. La numeración de clientes/proveedores vive en
 * catalogo-terceros.service y sigue esta misma regla bajo su cuenta de control.
 */

/** Anchos de cada segmento de la máscara: '#-##-##-###' → [1,2,2,3]. */
export function anchosDeMascara(m?: string | null): number[] | null {
  if (!m) return null;
  const a = (m.match(/#+/g) || []).map((g) => g.length);
  return a.length >= 2 ? a : null;
}

/** El separador que usa la máscara ('-', '.', ' ', '/'); '-' por omisión. */
export function separadorDeMascara(m?: string | null): string {
  const s = (m || '').replace(/#/g, '').trim();
  return s ? s[0] : '-';
}

/** El código sin separadores: '1-10-25-001' → '11025001'. */
export const soloDigitos = (codigo: string): string => String(codigo || '').replace(/\D/g, '');

/** Máscara por omisión cuando la empresa no fijó la suya (misma que el resto del motor). */
export const MASCARA_DEFAULT = '#-##-##-###';

/**
 * Pone los dígitos en la máscara: ('11025001', '#-##-##-###') → '1-10-25-001'.
 * Devuelve null si los dígitos no cuadran con el ancho total de la máscara.
 */
export function conMascara(digitos: string, mascara?: string | null): string | null {
  const anchos = anchosDeMascara(mascara);
  const d = soloDigitos(digitos);
  if (!anchos) return null;
  if (d.length !== anchos.reduce((a, b) => a + b, 0)) return null;
  const sep = separadorDeMascara(mascara);
  const partes: string[] = [];
  let i = 0;
  for (const w of anchos) { partes.push(d.slice(i, i + w)); i += w; }
  return partes.join(sep);
}

/** ¿El código ya está en el formato de la máscara (ancho total exacto)? */
export function esFormatoMascara(codigo: string, mascara?: string | null): boolean {
  const anchos = anchosDeMascara(mascara);
  if (!anchos) return false;
  return soloDigitos(codigo).length === anchos.reduce((a, b) => a + b, 0);
}

/**
 * Normaliza lo que el usuario escribió al formato de la máscara. Acepta con o sin
 * separadores ('11025001', '1-10-25-001', '1.10.25.001') y, si el código viene CORTO,
 * lo completa con ceros a la derecha —escribir `1-10-25` es escribir `1-10-25-000`—.
 * Devuelve null si sobran dígitos (no cabe en la máscara) o si no hay máscara.
 */
export function normalizarAMascara(codigo: string, mascara?: string | null): string | null {
  const anchos = anchosDeMascara(mascara);
  if (!anchos) return null;
  const total = anchos.reduce((a, b) => a + b, 0);
  const d = soloDigitos(codigo);
  if (!d || d.length > total) return null;
  return conMascara(d.padEnd(total, '0'), mascara);
}

/**
 * Índice (0-based) del ÚLTIMO segmento significativo: el último que no es todo ceros.
 * '1-10-25-000' → 2 (el «25»). '1-00-00-000' → 0. Un código todo ceros da -1.
 */
export function nivelDeSegmento(codigo: string, mascara?: string | null): number {
  const anchos = anchosDeMascara(mascara);
  const d = soloDigitos(codigo);
  if (!anchos || d.length !== anchos.reduce((a, b) => a + b, 0)) return -1;
  let i = 0, ultimo = -1;
  for (let s = 0; s < anchos.length; s++) {
    if (!/^0+$/.test(d.slice(i, i + anchos[s]))) ultimo = s;
    i += anchos[s];
  }
  return ultimo;
}

/**
 * El SIGUIENTE código libre para un hijo de `padreCodigo`, en el formato de la máscara
 * y rellenando huecos.
 *
 * El hijo conserva TODOS los segmentos del padre y numera el suyo —el que sigue al
 * último segmento significativo del padre—: de `1-10-25-000` nacen `1-10-25-001`,
 * `1-10-25-002`…; de `1-10-00-000` nacen `1-10-01-000`, `1-10-02-000`…
 *
 * `usados` son los códigos YA ocupados (en cualquier formato: se comparan por dígitos).
 * Devuelve null si no hay máscara utilizable, si el padre ya está en el último segmento
 * (no hay nivel más abajo) o si la serie se llenó; el llamador decide qué hacer.
 */
export function siguienteCodigoHijo(
  padreCodigo: string, mascara: string | null | undefined, usados: Iterable<string>,
): string | null {
  const anchos = anchosDeMascara(mascara);
  if (!anchos) return null;
  const total = anchos.reduce((a, b) => a + b, 0);
  const padre = soloDigitos(padreCodigo);
  if (padre.length !== total) return null;

  const nivelPadre = nivelDeSegmento(padre, mascara);
  const nivelHijo = nivelPadre + 1;                   // el segmento que le toca numerar
  if (nivelHijo < 0 || nivelHijo >= anchos.length) return null;   // ya no hay nivel más abajo

  const ini = anchos.slice(0, nivelHijo).reduce((a, b) => a + b, 0);
  const W = anchos[nivelHijo];
  const ocupados = new Set<string>();
  for (const u of usados) ocupados.add(soloDigitos(u));

  const maxN = Math.pow(10, W) - 1;
  for (let n = 1; n <= maxN; n++) {
    const d = padre.slice(0, ini) + String(n).padStart(W, '0') + padre.slice(ini + W);
    if (!ocupados.has(d)) return conMascara(d, mascara);
  }
  return null;                                        // serie llena
}

/** El RUBRO del código (primer segmento): '1' activo, '2' pasivo, '3' capital… */
export function rubroDe(codigo: string, mascara?: string | null): string {
  const anchos = anchosDeMascara(mascara);
  const d = soloDigitos(codigo);
  if (!anchos || !d) return '';
  return d.slice(0, anchos[0]);
}

/** ¿El hijo conserva los segmentos significativos del padre? (no cuelga un pasivo de un activo) */
export function cuelgaDeEnMascara(hijo: string, padre: string, mascara?: string | null): boolean {
  const anchos = anchosDeMascara(mascara);
  const h = soloDigitos(hijo), p = soloDigitos(padre);
  const total = anchos ? anchos.reduce((a, b) => a + b, 0) : 0;
  if (!anchos || h.length !== total || p.length !== total) return false;
  const nivelPadre = nivelDeSegmento(p, mascara);
  if (nivelPadre < 0) return true;                    // padre todo ceros: raíz, cuelga cualquiera
  const hasta = anchos.slice(0, nivelPadre + 1).reduce((a, b) => a + b, 0);
  return h.slice(0, hasta) === p.slice(0, hasta) && h !== p;
}
