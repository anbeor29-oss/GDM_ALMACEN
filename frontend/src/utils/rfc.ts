/**
 * Motor RFC para personas físicas — control de consistencia, no autoridad.
 *
 * QUÉ HACE Y QUÉ NO
 * Calcula el RFC ESPERADO a partir de nombre, apellidos y fecha, y lo compara
 * con el que se capturó. Ante una diferencia AVISA; nunca sustituye ni bloquea:
 * el RFC oficial lo asigna el SAT, y su homoclave no se puede reproducir con
 * certeza. Por eso la homoclave NO se compara —sólo las 4 letras del nombre, la
 * fecha, la estructura y el dígito verificador, que sí son deterministas—.
 *
 * CUÁNDO APLICARLO
 * Sólo en captura MANUAL. Un RFC que viene de un XML timbrado o de la CIF ya es
 * oficial —si no estuviera registrado no se habría timbrado—, así que ahí no se
 * cuestiona.
 *
 * Ref: GDM_NEXO_MOTOR_RFC_PERSONA_FISICA.md (§4, §8, §13–§16, §24).
 */

const PARTICULAS_APELLIDO = new Set(['DE', 'LA', 'LAS', 'MC', 'VON', 'DEL', 'LOS', 'Y', 'MAC', 'VAN', 'MI']);
const NOMBRES_COMUNES = new Set(['MARIA', 'JOSE', 'MA', 'MA.', 'J', 'J.']);

/* Si las 4 letras forman una palabra altisonante, el SAT cambia la última por X.
 * Sin esta tabla, esos casos darían un falso aviso de "no coincide". */
const ALTISONANTES = new Set([
  'BACA', 'BAKA', 'BUEI', 'BUEY', 'CACA', 'CACO', 'CAGA', 'CAGO', 'CAKA', 'CAKO', 'COGE', 'COGI',
  'COJA', 'COJE', 'COJI', 'COJO', 'COLA', 'CULO', 'FALO', 'FETO', 'GETA', 'GUEI', 'GUEY', 'JOTO',
  'KACA', 'KACO', 'KAGA', 'KAGO', 'KAKA', 'KAKO', 'KOGE', 'KOJO', 'KAKA', 'KULO', 'LILO', 'LOCA',
  'LOCO', 'LOKA', 'LOKO', 'MAME', 'MAMO', 'MEAR', 'MEAS', 'MEON', 'MIAR', 'MION', 'MOCO', 'MOKO',
  'MULA', 'MECO', 'PEDA', 'PEDO', 'PENE', 'PIPI', 'PITO', 'POPO', 'PUTA', 'PUTO', 'QULO', 'RATA',
  'ROBA', 'ROBE', 'ROBO', 'RUIN', 'SENO', 'TETA', 'VACA', 'VAGA', 'VAGO', 'VAKA', 'VUEI', 'VUEY',
  'WUEI', 'WUEY',
]);

/** Mayúsculas, sin acentos, conservando la Ñ y el &, sólo letras y espacios. */
function normalizar(s: string): string {
  return (s || '')
    .toUpperCase()
    .replace(/[ÁÀÄÂ]/g, 'A').replace(/[ÉÈËÊ]/g, 'E').replace(/[ÍÌÏÎ]/g, 'I')
    .replace(/[ÓÒÖÔ]/g, 'O').replace(/[ÚÙÜÛ]/g, 'U')
    .replace(/[^A-ZÑ& ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quita las partículas iniciales del apellido y junta lo que quede. */
function apellidoUtil(ap: string): string {
  const palabras = normalizar(ap).split(' ').filter(Boolean);
  while (palabras.length > 1 && PARTICULAS_APELLIDO.has(palabras[0])) palabras.shift();
  return palabras.join('');
}

/** Primer nombre "de pila" descartando MARIA/JOSE/MA. cuando hay más nombres. */
function primerNombre(nombre: string): string {
  const palabras = normalizar(nombre).split(' ').filter(Boolean);
  while (palabras.length > 1 && NOMBRES_COMUNES.has(palabras[0])) palabras.shift();
  return palabras[0] || '';
}

/** Primera vocal DESPUÉS de la inicial (para la 2ª letra del RFC). */
function vocalInterna(p: string): string {
  for (let i = 1; i < p.length; i++) if ('AEIOU'.includes(p[i])) return p[i];
  return 'X';
}

/**
 * Las 4 primeras letras del RFC según el nombre y los apellidos. Cubre los casos
 * de la guía del SAT: general, sin materno, sin paterno, apellido corto, y el
 * ajuste por palabra altisonante. Devuelve '' si faltan datos.
 */
export function primeras4Letras(apPat: string, apMat: string, nombre: string): string {
  const P = apellidoUtil(apPat);
  const M = apellidoUtil(apMat);
  const N = primerNombre(nombre);
  if (!N || (!P && !M)) return '';

  let c: string;
  if (P && P.length >= 3 && M) {
    c = P[0] + vocalInterna(P) + M[0] + (N[0] || 'X');       // regla general
  } else if (P && P.length < 3 && M) {
    c = (P[0] || 'X') + (M[0] || 'X') + (N[0] || 'X') + (N[1] || 'X'); // paterno corto
  } else if (P && !M) {
    c = P[0] + vocalInterna(P) + (N[0] || 'X') + (N[1] || 'X');        // sin materno
  } else if (!P && M) {
    c = M[0] + vocalInterna(M) + (N[0] || 'X') + (N[1] || 'X');        // sin paterno
  } else {
    return '';
  }

  c = (c + 'XXXX').slice(0, 4);
  if (ALTISONANTES.has(c)) c = c.slice(0, 3) + 'X';
  return c;
}

/** Fecha ISO (AAAA-MM-DD) → AAMMDD, o null. */
function aammdd(fechaISO?: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaISO || '');
  return m ? m[1].slice(2) + m[2] + m[3] : null;
}

const RE_PERSONA_FISICA =
  /^[A-ZÑ&]{4}[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[A-Z0-9]{3}$/;
const RE_PERSONA_MORAL =
  /^[A-ZÑ&]{3}[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[A-Z0-9]{3}$/;

/** Limpia el RFC SIN borrar los dígitos: mayúsculas y sólo caracteres válidos de
 *  RFC (letras, Ñ, & y números). `normalizar` no sirve aquí —quita los dígitos—. */
function limpiarRfc(rfc: string): string {
  return (rfc || '').toUpperCase().replace(/[^A-ZÑ&0-9]/g, '');
}

export function esPersonaFisica(rfc: string): boolean {
  return limpiarRfc(rfc).length === 13;
}
export function estructuraValida(rfc: string): boolean {
  const r = (rfc || '').toUpperCase().trim();
  return RE_PERSONA_FISICA.test(r) || RE_PERSONA_MORAL.test(r);
}

/* Dígito verificador (§8): diccionario oficial, suma ponderada 13..2, mod 11. */
const DIC = '0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ';
function valor(ch: string): number {
  if (ch === 'Ñ') return 38;
  if (ch === ' ') return 37;
  const i = DIC.indexOf(ch);
  return i < 0 ? 0 : i;
}
export function digitoVerificador(rfc12: string): string {
  const r = rfc12.toUpperCase().padEnd(12, ' ').slice(0, 12);
  let suma = 0;
  for (let i = 0; i < 12; i++) suma += valor(r[i]) * (13 - i);
  const mod = suma % 11;
  const dv = mod === 0 ? 0 : 11 - mod;
  return dv === 10 ? 'A' : String(dv);
}

export interface RevisionRfc {
  aplica: boolean;       // era un RFC de persona física para revisar
  ok: boolean;           // sin observaciones
  problemas: string[];
  rfcCalculado4: string; // las 4 letras esperadas (para mostrar)
}

/**
 * Revisa un RFC de persona física capturado. Devuelve las observaciones —nunca
 * corrige—. Si no es un RFC de 13 posiciones, no aplica (morales y genéricos se
 * dejan pasar: este motor es sólo para personas físicas).
 */
export function revisarRfcPersonaFisica(datos: {
  rfc: string;
  nombre?: string;
  apellidoPat?: string;
  apellidoMat?: string;
  fechaNacimiento?: string;
}): RevisionRfc {
  const rfc = limpiarRfc(datos.rfc);
  if (rfc.length !== 13) return { aplica: false, ok: true, problemas: [], rfcCalculado4: '' };

  const problemas: string[] = [];
  const estructura = RE_PERSONA_FISICA.test(rfc);
  if (!estructura) {
    problemas.push('La estructura no corresponde a un RFC de persona física (4 letras, 6 de fecha y 3 de homoclave).');
  }

  // Fecha del RFC vs. fecha de nacimiento capturada
  const fechaRfc = rfc.slice(4, 10);
  const fechaDato = aammdd(datos.fechaNacimiento);
  if (fechaDato && /^\d{6}$/.test(fechaRfc) && fechaDato !== fechaRfc) {
    problemas.push(`La fecha del RFC (${fechaRfc}) no coincide con la fecha de nacimiento capturada (${fechaDato}).`);
  }

  // Primeras 4 letras vs. nombre + apellidos (si hay con qué calcularlas)
  const calc4 = primeras4Letras(datos.apellidoPat || '', datos.apellidoMat || '', datos.nombre || '');
  if (calc4) {
    const doc4 = rfc.slice(0, 4);
    if (calc4 !== doc4) {
      problemas.push(`Las primeras 4 letras (${doc4}) no coinciden con las calculadas del nombre (${calc4}). Revisa el nombre, los apellidos o el RFC.`);
    }
  }

  // Dígito verificador (sólo si la estructura permite leerlo)
  if (estructura) {
    const dv = digitoVerificador(rfc.slice(0, 12));
    if (dv !== rfc[12]) {
      problemas.push(`El dígito verificador (${rfc[12]}) no cuadra; por los otros 12 caracteres debería ser ${dv}. Suele ser un error de captura.`);
    }
  }

  return { aplica: true, ok: problemas.length === 0, problemas, rfcCalculado4: calc4 };
}
