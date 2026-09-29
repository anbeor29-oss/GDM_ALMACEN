import axios from 'axios';
import type { IComplianceProvider } from '../provider.interface';
import type { ComplianceRequest, CredContext, ProviderResult, Sentido } from '../types';
import { RX_RFC, clasificarHttpError, envolverPdf, interpretarJson, mapearSentido, pareceLoginOCaptcha } from '../sat-parse';

const TIMEOUT_MS = 30000;

/**
 * SatProvider — Opinión 32-D y CSF del SAT.
 *
 * Camino primario (comercializable): consulta por RFC contra un ORIGEN
 * configurado (cumplimiento_config.base_url + token) — la consulta pública
 * opt-in del SAT, o el proveedor/servicio que la exponga —, SIN e.firma y SIN
 * CAPTCHA. El origen se valida en Fase 0; aquí NO se cablea ninguna URL del SAT
 * a mano ni se adivina un endpoint.
 *
 * Nunca evade retos: si el origen no está configurado, si la respuesta parece
 * login/CAPTCHA, o si el método es EFIRMA/PORTAL (que hoy exige interacción),
 * devuelve REQUIRES_USER_ACTION. Un error técnico jamás se guarda como NEGATIVA.
 */
export class SatProvider implements IComplianceProvider {
  constructor(public readonly organismo: string = 'SAT') {}

  async ejecutar(req: ComplianceRequest, cred: CredContext): Promise<ProviderResult> {
    const rfc = String(req.rfc || cred.usuario || '').toUpperCase().trim();
    if (!RX_RFC.test(rfc))
      return { estado: 'ERROR', mensaje: 'RFC de la empresa inválido o ausente; captúralo en la ficha de la empresa.' };

    // e.firma/portal: el flujo pasa por el portal del SAT (puede pedir CAPTCHA o
    // clave dinámica). No se automatiza aquí: se resuelve en modo asistido / con
    // la herramienta local. Para server-to-server se usa el método API.
    if (cred.metodo === 'EFIRMA' || cred.metodo === 'PORTAL')
      return {
        estado: 'REQUIRES_USER_ACTION',
        mensaje: 'El método e.firma/portal del SAT requiere el flujo asistido; para automatizar ' +
                 'server-to-server usa el método API con un origen de consulta por RFC.',
      };

    if (!cred.baseUrl)
      return {
        estado: 'REQUIRES_USER_ACTION',
        mensaje: 'Configura el ORIGEN de la consulta SAT (URL del servicio de consulta por RFC) en la ' +
                 'configuración de cumplimiento. Sin origen no se puede consultar sin CAPTCHA.',
      };

    let resp: { status: number; headers: any; data: any };
    try {
      // POST con el RFC en el CUERPO (nunca en la URL — es dato del contribuyente).
      resp = await axios.post(
        cred.baseUrl,
        { rfc, tipo: req.tipo },
        {
          timeout: TIMEOUT_MS,
          responseType: 'arraybuffer',
          validateStatus: () => true,
          headers: {
            'Content-Type': 'application/json',
            ...(cred.token ? { Authorization: `Bearer ${cred.token}` } : {}),
          },
        },
      );
    } catch (e: any) {
      if (e?.code === 'ECONNABORTED')
        return { estado: 'TIMEOUT', mensaje: 'La consulta al origen SAT excedió el tiempo.' };
      return { estado: 'ERROR', mensaje: `No se pudo consultar el origen SAT: ${String(e?.message || '').slice(0, 200)}` };
    }

    const status = resp.status;
    const errorHttp = clasificarHttpError(status);
    if (errorHttp) return errorHttp;

    const ct = String(resp.headers?.['content-type'] || '').toLowerCase();
    const buf: Buffer = Buffer.isBuffer(resp.data) ? resp.data : Buffer.from(resp.data || []);

    // 1) PDF directo: se guarda y, si se puede leer el texto, se infiere el sentido.
    if (ct.includes('application/pdf')) {
      let sentido: Sentido | undefined = req.tipo === 'CSF' ? 'VIGENTE' : undefined;
      try {
        const pdfParse = (await import('pdf-parse')).default as any;
        const texto = (await pdfParse(buf))?.text || '';
        sentido = mapearSentido(texto) ?? sentido;
      } catch { /* si no se lee el texto, se conserva el PDF sin sentido inferido */ }
      return {
        estado: 'SUCCESS', httpStatus: status,
        sentido: sentido ?? 'OTRO',
        fechaOpinion: new Date().toISOString().slice(0, 10),
        pdfBase64: envolverPdf(buf.toString('base64')),
        mensaje: 'Documento PDF recibido del origen SAT.',
      };
    }

    // 2) JSON estructurado.
    if (ct.includes('application/json') || ct.includes('text/json')) {
      try {
        return interpretarJson(req.tipo, JSON.parse(buf.toString('utf8')));
      } catch {
        return { estado: 'ERROR', httpStatus: status, mensaje: 'El origen SAT devolvió un JSON ilegible.' };
      }
    }

    // 3) HTML/texto: casi siempre login o CAPTCHA → acción del usuario, sin evadir.
    const texto = buf.toString('utf8').slice(0, 40000);
    if (pareceLoginOCaptcha(texto))
      return {
        estado: 'REQUIRES_USER_ACTION', httpStatus: status,
        mensaje: 'El origen SAT respondió con una página de inicio de sesión o CAPTCHA. No se evade: ' +
                 'completa el acceso en modo asistido o usa un origen de consulta directo por RFC.',
      };
    // Algunas consultas devuelven el sentido como texto plano ("Positiva").
    const sentidoTxt = mapearSentido(texto);
    if (sentidoTxt)
      return {
        estado: 'SUCCESS', httpStatus: status, sentido: sentidoTxt,
        fechaOpinion: new Date().toISOString().slice(0, 10),
        mensaje: 'Sentido obtenido del origen SAT (texto).',
      };
    return { estado: 'NO_DISPONIBLE', httpStatus: status, mensaje: 'El origen SAT respondió en un formato no reconocido.' };
  }
}
