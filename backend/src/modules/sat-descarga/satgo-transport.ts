/**
 * satgo-transport.ts — las MISMAS cuatro operaciones del motor de descarga
 * (autenticar/solicitar/verificar/descargar) pero por **SatGo** (SatWebService:
 * solicita → verifica → descarga), usando la e.firma de la empresa en multipart.
 *
 * Sustituye a `soap.ts` cuando `SAT_DESCARGA_VIA=satgo`. **Conserva TODO el motor
 * de NEXO** (partición, reanudable, dedupe, bóveda, calendario): aquí sólo cambia
 * el TRANSPORTE. Firmas idénticas a soap.ts para que `descarga.service` no cambie.
 *
 * SatGo es un intermediario **medido por cuota** (ver README / Fase C). Se activa a
 * conciencia por la bandera. El JWT (API Key) lo maneja/cachea `satgo.service`; la
 * e.firma (.cer/.key/clave) viaja en el cuerpo multipart de cada llamada; el RFC va
 * en header. SatGo devuelve los MISMOS códigos del SAT (CodEstatus 5000/5003/5004…
 * y EstadoSolicitud 1-6), así que el mapeo al motor es directo.
 *
 * Node 18+: FormData/Blob son globales y axios 1.x los serializa como multipart.
 */
import axios from 'axios';
import logger from '../../middleware/logger';
import { accessToken } from '../satgo/satgo.service';
import { ESTADO_SOLICITUD } from './soap';
import type { Credencial, Token, DatosSolicitud, RespuestaSat, Verificacion } from './soap';

const BASE = (process.env.SATGO_BASE_URL || 'https://api.sat-go.com').replace(/\/+$/, '');
const T = 120_000;

/** multipart con la e.firma que piden solicita/verifica/descarga de SatGo. */
function efirmaForm(cred: Credencial): FormData {
  const form = new FormData();
  form.append('Certificado', new Blob([cred.cer]), 'efirma.cer');
  form.append('llavePrivada', new Blob([cred.key]), 'efirma.key');
  form.append('Contrasena', String(cred.password || ''));
  return form;
}

function errTxt(r: any): string {
  try { return typeof r.data === 'string' ? r.data.slice(0, 300) : JSON.stringify(r.data).slice(0, 300); }
  catch { return ''; }
}

/** Traduce un error de SatGo (incl. el candado de PLAN) a algo legible, en vez del JSON crudo. */
function mensajeSatgo(r: any): string {
  let j: any = r?.data;
  if (typeof j === 'string') { try { j = JSON.parse(j); } catch { j = null; } }
  if (j && typeof j === 'object') {
    if (j.featureCode || /no tiene acceso/i.test(String(j.message || ''))) {
      return `SatGo: tu plan no incluye «${j.featureCode || 'esta función'}» (${j.message || 'sin acceso'}). ` +
             'Contrata/actualiza el plan de SatGo con descarga masiva.';
    }
    if (j.monthlyLimit != null || j.dailyLimit != null) {
      return `SatGo: límite del plan (${j.dailyUsage ?? '?'}/${j.dailyLimit ?? '?'} al día · ${j.monthlyUsage ?? '?'}/${j.monthlyLimit ?? '?'} al mes).`;
    }
    if (j.message || j.error) return `SatGo: ${j.message || j.error}`;
  }
  return `HTTP ${r.status}: ${errTxt(r)}`.slice(0, 300);
}

async function post(pathUrl: string, cred: Credencial, params: Record<string, any>): Promise<any> {
  const jwt = await accessToken();
  return axios.post(`${BASE}${pathUrl}`, efirmaForm(cred), {
    params,
    headers: { Authorization: `Bearer ${jwt}`, RFC: cred.rfc },
    timeout: T, validateStatus: () => true, maxBodyLength: Infinity, maxContentLength: Infinity,
  });
}

/* ── 1 · Autenticación ──
 * En SatGo el "token" es el JWT del API Key (lo obtiene/cachea satgo.service). El
 * motor sólo necesita un Token no vencido; solicitar/verificar/descargar piden el
 * JWT por su cuenta, así que el valor aquí es informativo. */
export async function autenticar(_cred: Credencial): Promise<Token> {
  const jwt = await accessToken();
  return { valor: jwt, expira: new Date(Date.now() + 50 * 60_000) };
}

/* ── 2 · Solicitud ── */
export async function solicitar(
  cred: Credencial, _token: Token, d: DatosSolicitud
): Promise<RespuestaSat & { idSolicitud?: string; atributos?: string }> {
  const iso = (x: Date) => x.toISOString().slice(0, 19).replace('T', ' ');   // SatGo: yyyy-MM-dd HH:mm:ss
  const estadoComprobante = d.estadoComprobante || (d.tipo === 'CFDI' ? 'Vigente' : 'Todos');
  const r = await post('/api/v2/SatWebService/solicita', cred, {
    tipo: d.direccion,            // emitidos | recibidos
    tipoBusqueda: d.tipo,         // CFDI | Metadata
    fecha_inicial: iso(d.desde),
    fecha_final: iso(d.hasta),
    estadoComprobante,
  });
  if (r.status < 200 || r.status >= 300) {
    const m = mensajeSatgo(r);
    logger.warn(`[satgo-descarga] solicita ${d.direccion}: ${m}`);
    return { codigo: '', mensaje: m };
  }
  const data = r.data || {};
  const id = data.idSolicitud || data.IdSolicitud || undefined;
  const cod = data.codEstatus != null ? String(data.codEstatus) : '';
  // Si SatGo no trae CodEstatus pero sí IdSolicitud (aceptada), se trata como 5000.
  const codigo = cod || (id ? '5000' : (data.success === false ? '' : '5000'));
  return { codigo, mensaje: data.errorMessage || data.mensaje || '', idSolicitud: id, crudo: undefined };
}

/* ── 3 · Verificación ── */
export async function verificar(
  cred: Credencial, _token: Token, idSolicitud: string
): Promise<Verificacion> {
  const r = await post('/api/v2/SatWebService/verifica', cred, { IdSolicitud: idSolicitud });
  if (r.status < 200 || r.status >= 300) {
    const m = mensajeSatgo(r);
    logger.warn(`[satgo-descarga] verifica: ${m}`);
    return { codigo: '', mensaje: m, estadoSolicitud: 'EN_PROCESO', codigoSolicitud: '', numeroCfdis: 0, paquetes: [] };
  }
  const d = r.data || {};
  const estNum = String(d.estadoSolicitud ?? d.EstadoSolicitud ?? '');
  return {
    codigo: d.codEstatus != null ? String(d.codEstatus) : '',
    mensaje: d.errorMessage || '',
    estadoSolicitud: ESTADO_SOLICITUD[estNum] || `DESCONOCIDO(${estNum})`,
    codigoSolicitud: d.codigoEstadoSolicitud != null ? String(d.codigoEstadoSolicitud)
      : (d.codEstatus != null ? String(d.codEstatus) : ''),
    numeroCfdis: Number(d.numeroCFDIs ?? d.numeroCfdis ?? 0),
    paquetes: d.idsPaquetes || d.IdsPaquetes || [],
  };
}

/* ── 4 · Descarga ── */
export async function descargar(
  cred: Credencial, _token: Token, idPaquete: string
): Promise<RespuestaSat & { zip?: Buffer }> {
  const r = await post('/api/v2/SatWebService/descarga', cred, { IdPaquete: idPaquete });
  if (r.status < 200 || r.status >= 300) {
    return { codigo: '', mensaje: mensajeSatgo(r) };
  }
  const d = r.data || {};
  const b64 = d.paqueteBase64 || d.PaqueteBase64 || '';
  return {
    codigo: d.codEstatus != null ? String(d.codEstatus) : '5000',
    mensaje: d.errorMessage || '',
    zip: b64 ? Buffer.from(b64, 'base64') : undefined,
  };
}
