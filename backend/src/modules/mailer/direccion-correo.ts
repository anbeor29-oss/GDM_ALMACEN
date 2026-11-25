/**
 * ¿Esta dirección puede recibir correo? — revisión ANTES de gastar el envío.
 *
 * Caso que lo motivó: un recibo de nómina a `anbeor@hotmail.ocm`. El dominio
 * `hotmail.ocm` no existe (es `.com` con las letras cambiadas), así que el
 * servidor contestó un 550 de cuatro renglones que el usuario tenía que
 * descifrar:
 *
 *     Can't send mail - all recipients were rejected: 550-The mail server could
 *     not deliver mail to anbeor@hotmail.ocm. The account 550-or domain may not
 *     exist, they may be blacklisted, or missing the proper dns 550 entries.
 *
 * Tres cosas malas en una: el envío se gastó, el buzón de la empresa se comió un
 * rebote —y los rebotes le cuestan reputación al remitente, que es lo que decide
 * si los DEMÁS correos caen en bandeja o en spam— y el mensaje no dice lo único
 * que importaba: **le faltó una letra al dominio**.
 *
 * QUIÉN DECIDE QUÉ:
 * - **El DNS decide si se bloquea.** Un dominio sin servidores de correo y sin
 *   dirección IP no puede recibir nada; eso es un hecho, no una opinión. Sólo
 *   con esa certeza se detiene el envío.
 * - **La tabla de dedazos sólo SUGIERE.** Nunca bloquea: el día que alguien
 *   tenga un dominio parecido a `gmail.com` de verdad, su correo sale igual.
 *
 * Y ante la duda, PASA: si el DNS no contesta (red caída, tiempo agotado), se
 * manda. Un correo que quizá rebota es mejor que un recibo que nunca sale por
 * un tropiezo de red.
 */
import { promises as dns } from 'dns';

/** Sintaxis mínima: algo@algo.algo. La misma que ya usaba el módulo de nómina. */
const SINTAXIS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Dominios a los que escribe casi todo el mundo en México. Sólo para SUGERIR. */
const DOMINIOS_COMUNES = [
  'gmail.com', 'hotmail.com', 'hotmail.es', 'hotmail.com.mx',
  'outlook.com', 'outlook.es', 'outlook.com.mx',
  'yahoo.com', 'yahoo.com.mx', 'yahoo.es',
  'live.com', 'live.com.mx', 'msn.com', 'icloud.com', 'me.com',
  'prodigy.net.mx', 'aol.com', 'proton.me', 'protonmail.com',
];

/**
 * Distancia de edición con transposición (Damerau-Levenshtein restringida).
 *
 * La transposición cuenta **1**, no 2, y eso es justo lo que hace falta aquí:
 * `ocm` → `com` es cambiar dos letras de lugar, el dedazo más común de todos.
 * Con la distancia clásica saldría 2 y se confundiría con un dominio distinto.
 */
export function distancia(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);   // transposición
      }
    }
  }
  return d[m][n];
}

/** El dominio común que se parece al escrito, si hay uno a un dedazo o dos. */
export function dominioSugerido(dominio: string): string | null {
  const d = String(dominio || '').trim().toLowerCase();
  if (!d || DOMINIOS_COMUNES.includes(d)) return null;   // tal cual: no hay nada que sugerir
  let mejor: string | null = null;
  let mejorDist = Infinity;
  for (const cand of DOMINIOS_COMUNES) {
    const dist = distancia(d, cand);
    if (dist < mejorDist) { mejorDist = dist; mejor = cand; }
  }
  return mejorDist <= 2 ? mejor : null;
}

/** La dirección completa, ya corregida, si el dominio tiene un parecido claro. */
export function correoSugerido(correo: string): string | null {
  const c = String(correo || '').trim().toLowerCase();
  const i = c.lastIndexOf('@');
  if (i < 1) return null;
  const sug = dominioSugerido(c.slice(i + 1));
  return sug ? `${c.slice(0, i)}@${sug}` : null;
}

export type EstadoDominio = 'SI' | 'NO' | 'NO_SE';

/**
 * ¿El dominio tiene a dónde entregar? MX primero; si no hay, una A/AAAA sirve
 * (el RFC 5321 permite entregar al host del dominio cuando no hay MX).
 *
 * Devuelve 'NO' **sólo** cuando el DNS afirma que no existe —NXDOMAIN o cero
 * registros—. Cualquier otra cosa (tiempo agotado, servidor DNS caído, rechazo)
 * es 'NO_SE' y deja pasar el envío.
 */
export async function dominioRecibeCorreo(dominio: string, msTope = 4000): Promise<EstadoDominio> {
  const d = String(dominio || '').trim().toLowerCase();
  if (!d) return 'NO';

  const conTope = <T>(p: Promise<T>): Promise<T | 'TIMEOUT'> =>
    Promise.race([p, new Promise<'TIMEOUT'>((r) => setTimeout(() => r('TIMEOUT'), msTope))]);

  // 1) ¿Servidores de correo?
  try {
    const mx = await conTope(dns.resolveMx(d));
    if (mx === 'TIMEOUT') return 'NO_SE';
    if (Array.isArray(mx) && mx.some((r) => r.exchange)) return 'SI';
  } catch (e: any) {
    // ENODATA = el dominio existe pero no tiene MX → hay que mirar la A.
    // NXDOMAIN/ENOTFOUND = no existe → se confirma abajo con la A, por si acaso.
    if (!['ENODATA', 'ENOTFOUND', 'NXDOMAIN', 'NOTFOUND'].includes(String(e?.code))) return 'NO_SE';
  }

  // 2) Sin MX: ¿al menos resuelve a una IP?
  try {
    const a = await conTope(dns.resolve4(d));
    if (a === 'TIMEOUT') return 'NO_SE';
    if (Array.isArray(a) && a.length) return 'SI';
    return 'NO';
  } catch (e: any) {
    const code = String(e?.code);
    if (['ENOTFOUND', 'NXDOMAIN', 'NOTFOUND', 'ENODATA'].includes(code)) return 'NO';
    return 'NO_SE';   // ante la duda, que salga
  }
}

export interface RevisionCorreo {
  ok: boolean;
  /** Qué decirle a quien captura. Ya viene en español y con la corrección. */
  motivo?: string;
  /** La dirección corregida, cuando el dominio se parece a uno conocido. */
  sugerencia?: string;
}

/**
 * Revisión completa. `conDns=false` se queda en la sintaxis y el dedazo —útil
 * cuando no se quiere esperar a la red.
 */
export async function revisarDireccion(correo: string, conDns = true): Promise<RevisionCorreo> {
  const c = String(correo || '').trim().toLowerCase();
  if (!SINTAXIS.test(c)) {
    return { ok: false, motivo: 'No parece una dirección de correo (falta la @ o el dominio).' };
  }
  const dominio = c.slice(c.lastIndexOf('@') + 1);
  const sugerencia = correoSugerido(c) || undefined;

  if (!conDns) return { ok: true, sugerencia };

  const estado = await dominioRecibeCorreo(dominio);
  if (estado === 'NO') {
    return {
      ok: false,
      sugerencia,
      motivo: `El dominio «${dominio}» no existe, así que nadie puede recibir ahí.` +
        (sugerencia ? ` ¿Será «${sugerencia}»?` : ' Revisa cómo está escrito.'),
    };
  }
  return { ok: true, sugerencia };
}
