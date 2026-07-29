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
      /* Vuelve a /cfdi33/stamp/v4 SIN prefijo: con /v3 devolvió 404 en las cinco
       * formas, así que ese path no existe. El original sí — respondía con un
       * mensaje real de SW, no con 404.
       *
       * Y eso reencuadra el problema: el endpoint existe y responde "Xml CFDI no
       * proporcionado" ante JSON, texto plano y XML crudo por igual. Lo que queda
       * es la convención que SW usa en su servicio de timbrado: el XML va como
       * ARCHIVO en multipart/form-data, en un campo llamado "xml". Por eso ningún
       * cuerpo servía — buscaba una parte de formulario, no un cuerpo.
       */
      const ENDPOINT = '/cfdi33/stamp/v4';
      const b64 = Buffer.from(xmlContent, 'utf8').toString('base64');

      /* multipart/form-data con el XML como ARCHIVO en el campo "xml" — la
       * convención del servicio de timbrado de SW. Va primera porque es la única
       * que explica que JSON, texto plano y XML crudo fallaran igual: SW no
       * buscaba un cuerpo, buscaba una parte de formulario.
       *
       * Se dejan las otras como respaldo hasta que el log confirme cuál sirve.
       * Al saberlo se queda una sola y se borra el resto. */
      const fd = new FormData();
      fd.append('xml', new Blob([xmlContent], { type: 'application/xml' }), 'cfdi.xml');

      const formas: Array<{ nombre: string; cuerpo: any; tipo?: string }> = [
        // Sin Content-Type: que axios ponga el boundary del multipart.
        { nombre: 'multipart campo xml', cuerpo: fd },
        { nombre: '{xml:base64}',  cuerpo: { xml: b64 },        tipo: 'application/json' },
        { nombre: 'base64 crudo',  cuerpo: b64,                 tipo: 'text/plain' },
        { nombre: 'XML crudo',     cuerpo: xmlContent,          tipo: 'application/xml' },
        { nombre: '{data:base64}', cuerpo: { data: b64 },       tipo: 'application/json' },
      ];

      let r: any = null;
      let usada = '';
      const rechazos: string[] = [];
      for (const f of formas) {
        const resp = await http.post(ENDPOINT, f.cuerpo, {
          headers: f.tipo ? { 'Content-Type': f.tipo } : {},
          // Que un 400 no lance: queremos leer el mensaje y seguir probando.
          validateStatus: () => true,
        } as any);
        if (resp.data?.status === 'success' && resp.data?.data?.uuid) {
          r = resp; usada = f.nombre;
          break;
        }
        rechazos.push(`${f.nombre}: ${resp.data?.messageDetail || resp.data?.message || resp.status}`);
      }

      if (!r) {
        return {
          success: false,
          errors: [
            `SW rechazó las ${formas.length} formas de enviar el XML a ${ENDPOINT}. ` +
            rechazos.join(' | '),
          ],
        };
      }
      // eslint-disable-next-line no-console
      console.log(`[SW] XML aceptado con la forma "${usada}" — fijarla y retirar el resto.`);

      const d = r.data?.data;
      if (r.data?.status !== 'success' || !d?.uuid) {
        // Se nombra el endpoint en el error. Sin esto, un rechazo de SW no
        // decía POR CUÁL ruta entró, y distinguir "el cuerpo iba mal" de "la
        // ruta no era la correcta" costó varias vueltas.
        return {
          success: false,
          errors: [
            `${r.data?.messageDetail || r.data?.message || 'Respuesta SW inválida'} ` +
            `[SW ${ENDPOINT}]`,
          ],
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

      /* La documentación de SW (developers.sw.com.mx → emision-timbrado-json-cfdi)
       * especifica el cuerpo envuelto en "data", con Sello/NoCertificado/
       * Certificado presentes aunque vacíos —los llena SW con el CSD del vault—:
       *
       *   { "data": { "Version": "4.0", …, "Sello": "", "NoCertificado": "", … } }
       *
       * Nuestro código mandaba el payload SUELTO. Las facturas timbran así
       * porque SW tolera los campos estándar en la raíz, pero un COMPLEMENTO
       * anidado no lo encuentra: de ahí el CFDI140230 "no existe el Complemento
       * para recepción de Pagos" en los comprobantes tipo P.
       *
       * Se intenta primero la forma documentada. Si SW la rechazara, se cae a la
       * forma suelta que hoy funciona para facturas: así este cambio no puede
       * romper el timbrado que ya opera en producción.
       */
      const conData = {
        data: { Sello: '', NoCertificado: '', Certificado: '', ...payload },
      };

      let r = await http.post('/v3/cfdi33/issue/json/v4', conData, {
        headers: { 'Content-Type': 'application/jsontoxml' },
        validateStatus: () => true,
      } as any);

      if (r.data?.status !== 'success' || !r.data?.data?.uuid) {
        const motivo = r.data?.messageDetail || r.data?.message || r.status;
        // eslint-disable-next-line no-console
        console.log(`[SW] forma documentada {data:…} rechazada (${motivo}); se reintenta suelta.`);
        r = await http.post('/v3/cfdi33/issue/json/v4', payload, {
          headers: { 'Content-Type': 'application/jsontoxml' },
        });
      } else {
        // eslint-disable-next-line no-console
        console.log('[SW] aceptado con la forma documentada {data:…}');
      }
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
