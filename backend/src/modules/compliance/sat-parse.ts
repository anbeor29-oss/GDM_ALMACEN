/**
 * sat-parse — funciones PURAS para interpretar lo que devuelve el origen de la
 * consulta SAT (Opinión 32-D / CSF). Se aíslan aquí para poder probarlas sin red
 * ni base de datos, y para que el adaptador quede delgado.
 *
 * Principio: un error técnico NUNCA se traduce a un sentido fiscal, y si la
 * respuesta parece un login/CAPTCHA se marca para acción del usuario — jamás se
 * evade ni se inventa una opinión.
 */
import type { OrganismoTipo, ProviderResult, Sentido } from './types';

/** RFC mexicano: persona moral (3 letras) o física (4) + 6 dígitos + homoclave. */
export const RX_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/;

/** Traduce el texto del SAT al SENTIDO fiscal. undefined si no lo reconoce. */
export function mapearSentido(texto: string): Sentido | undefined {
  const t = (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/positiv/.test(t)) return 'POSITIVA';
  if (/negativ/.test(t)) return 'NEGATIVA';
  if (/sin adeud/.test(t)) return 'SIN_ADEUDOS';
  if (/suspendid/.test(t)) return 'SUSPENDIDA';
  if (/vigente/.test(t)) return 'VIGENTE';
  return undefined;
}

/** ¿La respuesta parece una página de login o un CAPTCHA (no un documento)? */
export function pareceLoginOCaptcha(texto: string): boolean {
  const t = (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /captcha|recaptcha|g-recaptcha|introduce el codigo|clave dinamica|iniciar sesion|inicio de sesion/.test(t);
}

/** Mapea códigos HTTP de error a un resultado terminal; null si no es error. */
export function clasificarHttpError(status: number): ProviderResult | null {
  if (status === 401 || status === 403)
    return { estado: 'ERROR', httpStatus: status, mensaje: 'El origen SAT rechazó las credenciales (401/403).' };
  if (status === 404)
    return { estado: 'NO_DISPONIBLE', httpStatus: status, mensaje: 'El origen no tiene la opinión/constancia para ese RFC (404).' };
  if (status === 408 || status === 504)
    return { estado: 'TIMEOUT', httpStatus: status, mensaje: 'El origen SAT no respondió a tiempo.' };
  if (status === 429)
    return { estado: 'BLOCKED', httpStatus: status, mensaje: 'El origen SAT limitó las consultas (429). Reintentar más tarde.' };
  if (status >= 500)
    return { estado: 'ERROR', httpStatus: status, mensaje: `Error del origen SAT (${status}).` };
  return null;
}

/** Asegura el prefijo data-URL de un PDF en base64 (no lo duplica). */
export function envolverPdf(b64: string): string {
  const s = String(b64 || '').trim();
  if (!s) return '';
  return s.startsWith('data:application/pdf') ? s : `data:application/pdf;base64,${s.replace(/^data:.*?,/, '')}`;
}

/** Interpreta la respuesta JSON de un origen configurado (liberal en los nombres). */
export function interpretarJson(tipo: OrganismoTipo, obj: any): ProviderResult {
  if (!obj || typeof obj !== 'object')
    return { estado: 'NO_DISPONIBLE', mensaje: 'El origen SAT no devolvió datos.' };

  // El origen puede marcar explícitamente que no hay opinión.
  const estadoTxt = String(obj.estado || obj.status || '').toUpperCase();
  if (/NO_?DISPONIBLE|SIN[_ ]?OPINION|NOT_?FOUND/.test(estadoTxt))
    return { estado: 'NO_DISPONIBLE', mensaje: 'El origen SAT indica que no hay opinión para ese RFC.' };

  const sentidoTxt = String(obj.sentido ?? obj.resultado ?? obj.opinion ?? obj.sense ?? '');
  const sentido: Sentido | undefined = mapearSentido(sentidoTxt) ?? (tipo === 'CSF' ? 'VIGENTE' : undefined);
  const pdfRaw = obj.pdfBase64 ?? obj.pdf_base64 ?? obj.pdf ?? obj.documento ?? '';
  const pdf = pdfRaw ? envolverPdf(String(pdfRaw)) : undefined;

  if (!sentido && !pdf)
    return { estado: 'NO_DISPONIBLE', mensaje: 'El origen SAT respondió sin sentido ni documento reconocibles.' };

  return {
    estado: 'SUCCESS',
    sentido: sentido ?? 'OTRO',
    fechaOpinion: String(obj.fecha ?? obj.fechaOpinion ?? obj.date ?? '').slice(0, 10) || undefined,
    folio: obj.folio ?? obj.id ?? obj.identificador ?? undefined,
    observaciones: obj.observaciones ?? obj.mensaje ?? undefined,
    pdfBase64: pdf,
    mensaje: 'Opinión obtenida del origen configurado.',
  };
}
