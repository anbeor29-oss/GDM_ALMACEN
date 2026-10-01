/**
 * satgo.service — cliente de la API de SatGo (proveedor fiscal).
 *
 * Auth en dos pasos (contrato del cliente Python de SatGo):
 *   1) CreateKey: token del portal (web.sat-go.com) → API Key PERMANENTE.
 *   2) Auth/token: API Key → JWT de corta duración (Bearer) para cada consulta.
 * Por RFC: header `Secret` (CIEC) o FIEL (pendiente el multipart de .cer/.key).
 *
 * La API Key permanente se guarda CIFRADA en satgo_config; el JWT corto se cachea
 * en memoria y se regenera al expirar (sirve para el cron desatendido). La URL base
 * es configurable (prod/preprod) porque el README no la fija.
 *
 * NOTA: el README de SatGo lista los ENDPOINTS pero no todos los esquemas de
 * request/response; el parseo es DEFENSIVO (prueba varios nombres de campo) y se
 * afina con la primera prueba en vivo o con services/*.py del cliente de SatGo.
 */
import axios from 'axios';
import { query } from '../../config/database';
import { cifrar, descifrarTexto, bovedaLista } from '../sat-descarga/boveda';
import { ValidationError } from '../../middleware/errorHandler';

const DEFAULT_BASE = (process.env.SATGO_BASE_URL || 'https://api.sat-go.com').replace(/\/+$/, '');
const T = 45000;

/** Config visible (sin secretos): URL base, si ya hay API key, ambiente. */
export async function getConfig() {
  const r = await query<any>(`SELECT base_url, (api_key IS NOT NULL) AS tiene_key, ambiente FROM satgo_config WHERE id = 1`);
  const row = r.rows[0] || {};
  return { baseUrl: row.base_url || DEFAULT_BASE, tieneKey: row.tiene_key === true, ambiente: row.ambiente || 'PRUEBAS', bovedaLista: bovedaLista() };
}

async function baseUrl(): Promise<string> {
  const r = await query<any>(`SELECT base_url FROM satgo_config WHERE id = 1`);
  return String(r.rows[0]?.base_url || DEFAULT_BASE).replace(/\/+$/, '');
}

async function getApiKey(): Promise<string | null> {
  const r = await query<any>(`SELECT api_key FROM satgo_config WHERE id = 1`);
  const enc = r.rows[0]?.api_key;
  return enc && bovedaLista() ? descifrarTexto(enc) : null;
}

/** Guarda URL base / ambiente / (opcional) API key en claro → se cifra. */
export async function setConfig(d: { baseUrl?: string; apiKey?: string; ambiente?: string }) {
  if (d.apiKey && !bovedaLista()) throw new ValidationError('Falta SAT_VAULT_KEY para cifrar la API key de SatGo.');
  const enc = d.apiKey ? cifrar(String(d.apiKey)) : null;
  await query(
    `INSERT INTO satgo_config (id, base_url, api_key, ambiente, updated_at) VALUES (1, $1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       base_url = COALESCE($1, satgo_config.base_url),
       api_key  = COALESCE($2, satgo_config.api_key),
       ambiente = COALESCE($3, satgo_config.ambiente),
       updated_at = NOW()`,
    [d.baseUrl?.trim() || null, enc, d.ambiente || null]);
  return getConfig();
}

/**
 * Convierte un cuerpo de error de SatGo en un mensaje claro para el usuario.
 * SatGo devuelve JSON como {"success":false,"message":"Límite mensual excedido",
 * "featureCode":"imssoc","monthlyLimit":3,"monthlyUsage":6}; detectamos el tope de
 * cuota (plan de pruebas) y lo explicamos, en vez de mostrar el JSON crudo.
 */
function mensajeErrorSatgo(status: number, body: string): string {
  let j: any = null;
  try { j = JSON.parse(body); } catch { /* texto plano */ }
  if (j && typeof j === 'object') {
    const base = String(j.message || j.error || j.title || `código ${status}`);
    if (j.monthlyLimit != null || j.dailyLimit != null) {
      const lim = j.monthlyLimit != null
        ? `${j.monthlyUsage ?? '?'} de ${j.monthlyLimit} al mes`
        : `${j.dailyUsage ?? '?'} de ${j.dailyLimit} al día`;
      return `Límite del plan excedido (${lim}). Amplía el plan para subir el tope; mientras, usa el asistente.`;
    }
    return `No se pudo obtener en línea: ${base}`;
  }
  return `No se pudo obtener en línea (código ${status}).`;
}

/** Extrae el primer valor de una lista de posibles nombres de campo. */
function pick(obj: any, ...keys: string[]): string | null {
  if (typeof obj === 'string') return obj;
  for (const k of keys) {
    const v = obj?.[k] ?? obj?.data?.[k];
    if (v) return String(v);
  }
  return null;
}

/**
 * BOOTSTRAP: con el token del portal de SatGo obtiene la API Key PERMANENTE y la
 * guarda cifrada. Se hace UNA vez; después NEXO ya no necesita el token del portal.
 */
export async function bootstrapApiKey(portalToken: string) {
  if (!portalToken?.trim()) throw new ValidationError('Falta el token del portal de SatGo.');
  if (!bovedaLista()) throw new ValidationError('Falta SAT_VAULT_KEY para guardar la API key cifrada.');
  const base = await baseUrl();
  const r = await axios.post(`${base}/api/v1/Users/CreateKey`, {}, {
    headers: { Authorization: `Bearer ${portalToken.trim()}` }, timeout: T, validateStatus: () => true,
  });
  if (r.status < 200 || r.status >= 300) throw new ValidationError(`SatGo CreateKey respondió ${r.status}. Revisa la URL base y el token del portal.`);
  const apiKey = pick(r.data, 'apiKey', 'apikey', 'key', 'apiKeyValue');
  if (!apiKey) throw new ValidationError('SatGo no devolvió una API key reconocible (revisa el esquema de CreateKey).');
  await setConfig({ apiKey });
  return { ok: true };
}

/**
 * Bootstrap por VARIABLE DE ENTORNO: si `SATGO_PORTAL_TOKEN` está puesto y aún no
 * hay API key guardada, canjea el token del portal por la API Key PERMANENTE al
 * arrancar. Pensado para PRODUCCIÓN: se pone el token en Render (una vez) y NEXO se
 * configura solo, sin pegar nada en la UI. No tumba el server si falla.
 */
export async function bootstrapDesdeEnv(): Promise<'sin-token' | 'sin-boveda' | 'ya-configurado' | 'ok' | 'error'> {
  const token = (process.env.SATGO_PORTAL_TOKEN || '').trim();
  if (!token) return 'sin-token';
  if (!bovedaLista()) return 'sin-boveda';
  try {
    if ((await getConfig()).tieneKey) return 'ya-configurado';
    await bootstrapApiKey(token);
    return 'ok';
  } catch { return 'error'; }
}

/* ── JWT corto (caché en memoria) ── */
let tokenCache: { jwt: string; exp: number } | null = null;

export async function accessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.exp > now + 60_000) return tokenCache.jwt;
  const apiKey = await getApiKey();
  if (!apiKey) throw new ValidationError('SatGo no está configurado (falta la API key). Haz el bootstrap con el token del portal.');
  const base = await baseUrl();
  // Contrato SatGo: POST /api/Auth/token?key=<API Key> → { token }
  // (alterno: /api/Auth/token-json con body {key} → tokens.access.value)
  const r = await axios.post(`${base}/api/Auth/token?key=${encodeURIComponent(apiKey)}`, {}, { timeout: T, validateStatus: () => true });
  if (r.status < 200 || r.status >= 300) throw new ValidationError(`SatGo Auth/token respondió ${r.status}.`);
  const jwt = pick(r.data, 'token', 'access_token', 'accessToken', 'jwt') || r.data?.tokens?.access?.value || null;
  if (!jwt) throw new ValidationError('SatGo no devolvió un token de acceso reconocible.');
  // Vigencia: si el JWT trae exp lo usamos; si no, 4 min por defecto.
  let exp = now + 4 * 60_000;
  try { const p = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8')); if (p?.exp) exp = p.exp * 1000; } catch { /* default */ }
  tokenCache = { jwt, exp };
  return jwt;
}

export type RecursoPdf = 'csf' | 'oc' | 'ocpublico' | 'imssoc';

/**
 * Consulta que devuelve un PDF. Contrato SatGo (GET /api/v2/Consultar/<recurso>):
 *   - `csf`, `oc`            → header `RFC` + header `Secret` (clave CIEC).
 *   - `ocpublico`, `imssoc`  → SOLO header `RFC` (sin CIEC): pública / IMSS por RFC.
 * `Authorization: Bearer <JWT>` siempre.
 */
export async function consultarPdf(recurso: RecursoPdf, rfc: string, secretCiec?: string): Promise<Buffer> {
  const jwt = await accessToken();
  const base = await baseUrl();
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}`, RFC: rfc };
  if (secretCiec) headers.Secret = secretCiec;   // sólo csf/oc lo requieren
  const r = await axios.get(`${base}/api/v2/Consultar/${recurso}`, {
    params: { rfc },
    headers,
    responseType: 'arraybuffer', timeout: T, validateStatus: () => true,
  });
  if (r.status < 200 || r.status >= 300) {
    const msg = Buffer.isBuffer(r.data) ? r.data.toString('utf8').slice(0, 400) : '';
    throw new ValidationError(mensajeErrorSatgo(r.status, msg));
  }
  return Buffer.isBuffer(r.data) ? r.data : Buffer.from(r.data || []);
}

/** @deprecated usa consultarPdf. */
export const consultarPdfCiec = (recurso: 'csf' | 'oc', rfc: string, secretCiec: string) =>
  consultarPdf(recurso, rfc, secretCiec);

/** Información fiscal (JSON) por RFC (CIEC). */
export async function infoFiscalCiec(rfc: string, secretCiec: string, requestId?: string): Promise<any> {
  const jwt = await accessToken();
  const base = await baseUrl();
  const r = await axios.get(`${base}/api/v2/Consultar/informacionfiscal`, {
    params: { rfc, requestId: requestId || undefined },
    headers: { Authorization: `Bearer ${jwt}`, Secret: secretCiec, RFC: rfc },
    timeout: T, validateStatus: () => true,
  });
  if (r.status < 200 || r.status >= 300) throw new ValidationError(`SatGo info fiscal respondió ${r.status}.`);
  return r.data;
}

/** Declaraciones (ZIP) por RFC (CIEC). */
export async function declaracionesCiec(rfc: string, secretCiec: string, ejercicio: number, mes = 0): Promise<Buffer> {
  const jwt = await accessToken();
  const base = await baseUrl();
  const r = await axios.get(`${base}/api/v2/Consultar/dec`, {
    params: { rfc, ejercicio, mes },
    headers: { Authorization: `Bearer ${jwt}`, Secret: secretCiec, RFC: rfc },
    responseType: 'arraybuffer', timeout: T, validateStatus: () => true,
  });
  if (r.status < 200 || r.status >= 300) throw new ValidationError(`SatGo declaraciones respondió ${r.status}.`);
  return Buffer.isBuffer(r.data) ? r.data : Buffer.from(r.data || []);
}

/**
 * Validación de un CFDI ante el SAT (SatWebService/consulta-cfdi). NO usa CIEC:
 * sólo Bearer + header `RFC` (el del consultante) + los datos del comprobante:
 *   re = RFC emisor, rr = RFC receptor, tt = total, id = UUID, fe = 8 últimos del sello.
 * Devuelve el estado del comprobante (Vigente / Cancelado / No encontrado).
 */
export async function consultaCfdi(
  rfcConsultante: string,
  d: { re: string; rr: string; tt: string | number; id: string; fe?: string },
): Promise<any> {
  const jwt = await accessToken();
  const base = await baseUrl();
  const r = await axios.get(`${base}/api/v2/SatWebService/consulta-cfdi`, {
    params: { re: d.re, rr: d.rr, tt: d.tt, id: d.id, fe: d.fe || undefined },
    headers: { Authorization: `Bearer ${jwt}`, RFC: rfcConsultante },
    timeout: T, validateStatus: () => true,
  });
  if (r.status < 200 || r.status >= 300) {
    const msg = typeof r.data === 'string' ? r.data.slice(0, 300) : (r.data?.message || '');
    throw new ValidationError(`SatGo consulta-cfdi respondió ${r.status}. ${msg}`);
  }
  return r.data;
}
