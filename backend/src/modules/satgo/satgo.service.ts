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

/* ── JWT corto (caché en memoria) ── */
let tokenCache: { jwt: string; exp: number } | null = null;

export async function accessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.exp > now + 60_000) return tokenCache.jwt;
  const apiKey = await getApiKey();
  if (!apiKey) throw new ValidationError('SatGo no está configurado (falta la API key). Haz el bootstrap con el token del portal.');
  const base = await baseUrl();
  const r = await axios.post(`${base}/api/Auth/token`, { apiKey }, { timeout: T, validateStatus: () => true });
  if (r.status < 200 || r.status >= 300) throw new ValidationError(`SatGo Auth/token respondió ${r.status}.`);
  const jwt = pick(r.data, 'token', 'access_token', 'accessToken', 'jwt');
  if (!jwt) throw new ValidationError('SatGo no devolvió un token de acceso reconocible.');
  // Vigencia: si el JWT trae exp lo usamos; si no, 4 min por defecto.
  let exp = now + 4 * 60_000;
  try { const p = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8')); if (p?.exp) exp = p.exp * 1000; } catch { /* default */ }
  tokenCache = { jwt, exp };
  return jwt;
}

/** Consulta CIEC que devuelve un PDF (CSF / Opinión 32-D). rfc + clave CIEC (header Secret). */
export async function consultarPdfCiec(recurso: 'csf' | 'oc', rfc: string, secretCiec: string): Promise<Buffer> {
  const jwt = await accessToken();
  const base = await baseUrl();
  const r = await axios.get(`${base}/api/v2/Consultar/${recurso}`, {
    params: { rfc },
    headers: { Authorization: `Bearer ${jwt}`, Secret: secretCiec, Rfc: rfc },
    responseType: 'arraybuffer', timeout: T, validateStatus: () => true,
  });
  if (r.status < 200 || r.status >= 300) {
    const msg = Buffer.isBuffer(r.data) ? r.data.toString('utf8').slice(0, 300) : '';
    throw new ValidationError(`SatGo ${recurso} respondió ${r.status}. ${msg}`);
  }
  return Buffer.isBuffer(r.data) ? r.data : Buffer.from(r.data || []);
}

/** Información fiscal (JSON) por RFC (CIEC). */
export async function infoFiscalCiec(rfc: string, secretCiec: string, requestId?: string): Promise<any> {
  const jwt = await accessToken();
  const base = await baseUrl();
  const r = await axios.get(`${base}/api/v2/Consultar/informacionfiscal`, {
    params: { rfc, requestId: requestId || undefined },
    headers: { Authorization: `Bearer ${jwt}`, Secret: secretCiec, Rfc: rfc },
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
    headers: { Authorization: `Bearer ${jwt}`, Secret: secretCiec, Rfc: rfc },
    responseType: 'arraybuffer', timeout: T, validateStatus: () => true,
  });
  if (r.status < 200 || r.status >= 300) throw new ValidationError(`SatGo declaraciones respondió ${r.status}.`);
  return Buffer.isBuffer(r.data) ? r.data : Buffer.from(r.data || []);
}
