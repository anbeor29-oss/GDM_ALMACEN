/**
 * SW Sapien (Smarter Web) — provider REST.
 *   Docs:      https://developers.sw.com.mx/
 *   Sandbox:   https://services.test.sw.com.mx
 *   Producción: https://services.sw.com.mx
 *
 * Autenticación:
 *   El TOKEN de API se genera en swpanel.mx (Configuración → Tokens).
 *   Es un JWT largo. Se manda en cada request como `Authorization: bearer <TOKEN>`.
 *   Se rota desde el panel sin tocar código; nunca se guarda tu password
 *   personal — solo el token en `.env` cifrado.
 *
 * Endpoints usados:
 *   POST /cfdi33/stamp/v4    Timbrado (soporta XML CFDI 4.0)
 *   POST /cfdi33/cancel/{rfc} Cancelación
 *   GET  /account/balance    Estado de cuenta (timbres restantes)
 *   POST /security/authenticate Login opcional (si usas user/pwd)
 *
 * Notas:
 *   · Todos los responses son JSON (no SOAP).
 *   · Timeouts: default 30s. En prod usar retry con backoff exponencial.
 *   · Los errores del SAT vienen en `messageDetail`, no en `message`.
 */

import axios, { AxiosError, AxiosInstance } from 'axios';
import logger from '../../../middleware/logger';
import {
  IPACProvider,
  PACCredentials,
  PACAccountStatus,
  StampResult,
  CancelResult,
} from '../pac.interface';

const SW_ENDPOINTS = {
  sandbox:    'https://services.test.sw.com.mx',
  production: 'https://services.sw.com.mx',
} as const;

interface SWTokenSource {
  token: string;      // JWT del panel SW Sapien
  env: 'sandbox' | 'production';
}

/**
 * Lee las credenciales SW desde variables de entorno.
 * Nunca vienen del cliente ni del body del request.
 */
function readEnvConfig(): SWTokenSource | null {
  const token = process.env.SW_SAPIEN_TOKEN?.trim();
  const env   = (process.env.SW_SAPIEN_ENV || 'sandbox').toLowerCase();
  if (!token) return null;
  if (env !== 'sandbox' && env !== 'production') {
    throw new Error(`SW_SAPIEN_ENV inválido: ${env} — usa 'sandbox' o 'production'`);
  }
  return { token, env };
}

export class SWSapienProvider implements IPACProvider {
  readonly name = 'SW_SAPIEN';
  private client: AxiosInstance | null = null;
  private lastConfigKey = '';

  /** Reconstruye el cliente axios si cambió el env o el token. */
  private http(): AxiosInstance {
    const cfg = readEnvConfig();
    if (!cfg) {
      throw new Error(
        'SW_SAPIEN_TOKEN no configurado en .env — genera un token en ' +
        'https://swpanel.mx (Configuración → Tokens) y agrégalo al backend.'
      );
    }
    const key = `${cfg.env}:${cfg.token.slice(0, 20)}`;
    if (this.client && this.lastConfigKey === key) return this.client;

    this.client = axios.create({
      baseURL: SW_ENDPOINTS[cfg.env],
      timeout: 30_000,
      headers: {
        Authorization: `bearer ${cfg.token}`,
        'Content-Type': 'application/jsontoxml',
      },
    });
    this.lastConfigKey = key;
    logger.info(`SW Sapien provider inicializado (env=${cfg.env})`);
    return this.client;
  }

  /* ─────────────── TIMBRADO ─────────────── */

  async stamp(xmlContent: string, _credentials: PACCredentials): Promise<StampResult> {
    try {
      const http = this.http();
      // POST /cfdi33/stamp/v4 acepta el XML CFDI 4.0 en JSON envuelto en 'xml'
      const r = await http.post('/cfdi33/stamp/v4', xmlContent, {
        headers: { 'Content-Type': 'application/xml' },
      });
      const d = r.data?.data;
      if (r.data?.status !== 'success' || !d?.uuid) {
        return {
          success: false,
          errors: [r.data?.messageDetail || r.data?.message || 'Respuesta SW inválida'],
        };
      }
      return {
        success: true,
        uuid: d.uuid,
        xml_stamped: d.cfdi,
        sello_sat:   d.selloSAT,
        sello_cfd:   d.selloCFD,
        no_certificado_sat: d.noCertificadoSAT,
        fecha_timbrado: d.fechaTimbrado,
        cadena_original_sat: d.cadenaOriginalSAT,
        qr_code: d.qrCode,
        errors: [],
      };
    } catch (e) {
      return this.handleAxiosError(e, 'timbrado');
    }
  }

  /* ─────────────── TIMBRADO JSON (Emisión SW) ─────────────── */

  /**
   * Endpoint /v3/cfdi33/issue/json/v4
   *   · Aceptamos un JSON (SW arma el XML, lo sella con nuestra .key subida al
   *     vault, y timbra ante SAT).
   *   · Content-Type: application/jsontoxml
   *   · Respuesta idéntica a stamp(): data.uuid, data.cfdi, sellos, qrCode.
   *   · Ventaja: no manejamos CSD/.key en nuestro backend, solo en el vault SW.
   */
  async stampFromJson(payload: any, _credentials: PACCredentials): Promise<StampResult> {
    try {
      const http = this.http();
      const r = await http.post('/v3/cfdi33/issue/json/v4', payload, {
        headers: { 'Content-Type': 'application/jsontoxml' },
      });
      const d = r.data?.data;
      if (r.data?.status !== 'success' || !d?.uuid) {
        return {
          success: false,
          errors: [r.data?.messageDetail || r.data?.message || 'Respuesta SW inválida'],
        };
      }
      return {
        success: true,
        uuid: d.uuid,
        xml_stamped: d.cfdi,
        sello_sat: d.selloSAT,
        sello_cfd: d.selloCFD,
        no_certificado_sat: d.noCertificadoSAT,
        fecha_timbrado: d.fechaTimbrado,
        cadena_original_sat: d.cadenaOriginalSAT,
        qr_code: d.qrCode,
        errors: [],
      };
    } catch (e) {
      return this.handleAxiosError(e, 'timbrado-json');
    }
  }

  /* ─────────────── CANCELACIÓN ─────────────── */

  async cancel(
    uuid: string,
    rfcEmisor: string,
    motivo: string,
    _credentials: PACCredentials
  ): Promise<CancelResult> {
    try {
      const http = this.http();
      // Endpoint v4 real: /v4/cfdi/cancel/{rfc} — SIN el "33" en el path.
      // (El legacy /cfdi33/cancel/{rfc} sigue funcionando pero SW recomienda
      // v4 y devuelve mensajes de error más útiles.)
      // Body JSON: { uuid, motivo, folioSustitucion }.
      // El CSD/PFX vive en el vault de SW asociado al RFC del emisor;
      // aquí solo mandamos el UUID a cancelar.
      const path = `/v4/cfdi/cancel/${rfcEmisor}`;
      logger.info(`SW cancel → POST ${path} uuid=${uuid} motivo=${motivo}`);
      const r = await http.post(path, {
        uuid,
        motivo,
        folioSustitucion: '',
      }, {
        headers: { 'Content-Type': 'application/json' },
      });
      logger.info(
        `SW cancel ← status=${r.data?.status || 'unknown'} ` +
        `msg=${r.data?.message || ''} detail=${r.data?.messageDetail || ''}`
      );
      const d = r.data?.data;
      if (r.data?.status !== 'success') {
        return {
          success: false,
          uuid,
          status: 'REJECTED',
          errors: [r.data?.messageDetail || r.data?.message || 'Cancelación rechazada'],
        };
      }
      // v4 devuelve { data: { uuid: { "<UUID>": "201"|"202"|"205"|... }, acuse } }
      // Códigos SAT relevantes:
      //   201 → Cancelación aceptada
      //   202 → Ya estaba cancelado
      //   205 → No existe / rechazado
      // Si SW responde success pero el UUID interno da 205, fue rechazo real.
      const uuidStatuses = d?.uuid && typeof d.uuid === 'object' ? d.uuid : null;
      const uuidCode = uuidStatuses
        ? String(uuidStatuses[uuid] || uuidStatuses[uuid.toLowerCase()] || uuidStatuses[uuid.toUpperCase()] || '')
        : '';
      if (uuidCode && !['201', '202'].includes(uuidCode)) {
        return {
          success: false,
          uuid,
          status: 'REJECTED',
          errors: [`SAT rechazó cancelación (código ${uuidCode}). Revisa el UUID en swpanel.mx.`],
        };
      }
      return {
        success: true,
        uuid,
        status: 'CANCELLED',
        acuse: d?.acuse,
        fecha_cancelacion: d?.fechaCancelacion || new Date().toISOString(),
        errors: [],
      };
    } catch (e) {
      const err = this.handleAxiosError(e, 'cancelación');
      return { success: false, uuid, status: 'REJECTED', errors: err.errors };
    }
  }

  /* ─────────────── ESTADO DE CUENTA ─────────────── */

  async getAccountStatus(_credentials: PACCredentials): Promise<PACAccountStatus> {
    try {
      const http = this.http();
      const r = await http.get('/account/balance');
      // SW responde en español: saldoTimbres, timbresUtilizados, unlimited
      const d = r.data?.data || r.data;
      const unlimited = d?.unlimited === true;
      return {
        provider: this.name,
        timbres_disponibles: unlimited ? Infinity : Number(d?.saldoTimbres ?? 0),
        timbres_consumidos: Number(d?.timbresUtilizados ?? 0),
        is_test_mode: (process.env.SW_SAPIEN_ENV || 'sandbox') !== 'production',
      };
    } catch (e) {
      logger.error(`SW getAccountStatus falló: ${(e as Error).message}`);
      return {
        provider: this.name,
        timbres_disponibles: -1,
        timbres_consumidos: -1,
        is_test_mode: (process.env.SW_SAPIEN_ENV || 'sandbox') !== 'production',
      };
    }
  }

  /* ─────────────── CONEXIÓN ─────────────── */

  async testConnection(_credentials: PACCredentials): Promise<boolean> {
    try {
      const http = this.http();
      // Ping ligero: pide balance; si responde con status, la auth va bien.
      const r = await http.get('/account/balance', { timeout: 8_000 });
      return r.status === 200;
    } catch (e) {
      logger.warn(`SW testConnection falló: ${(e as Error).message}`);
      return false;
    }
  }

  /* ─────────────── HELPERS ─────────────── */

  private handleAxiosError(e: unknown, op: string): StampResult {
    const ax = e as AxiosError<any>;
    const status = ax.response?.status;
    const data   = ax.response?.data;
    // No loguear el header Authorization ni el XML completo (PII/CSD)
    logger.error(`SW Sapien ${op} error: HTTP ${status}`, {
      messageDetail: data?.messageDetail || data?.message,
    });
    if (data?.messageDetail) return { success: false, errors: [data.messageDetail] };
    if (data?.message)       return { success: false, errors: [data.message] };
    if (status === 401)      return { success: false, errors: ['Token SW inválido o expirado — genera uno nuevo en swpanel.mx'] };
    if (status === 402)      return { success: false, errors: ['Sin timbres disponibles en el plan SW Sapien'] };
    if (status === 404) {
      // 404 tipico al cancelar/consultar: SW no encuentra el UUID en su vault.
      // Suele pasar cuando la factura se timbro con MOCK (sin registro real en
      // SW) o cuando el UUID esta mal formado.
      return {
        success: false,
        errors: [
          `SW no encuentra el CFDI en su vault (404). Suele pasar cuando la ` +
          `factura fue timbrada con MOCK antes de conectar SW real. Marca la ` +
          `factura como CANCELADA localmente y emite una nueva.`,
        ],
      };
    }
    return { success: false, errors: [`Error ${op} SW Sapien: ${ax.message}`] };
  }
}
