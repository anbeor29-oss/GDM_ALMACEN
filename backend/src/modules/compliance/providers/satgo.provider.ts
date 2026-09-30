import type { IComplianceProvider } from '../provider.interface';
import type { ComplianceRequest, CredContext, ProviderResult, Sentido } from '../types';
import { mapearSentido } from '../sat-parse';
import * as satgo from '../../satgo/satgo.service';

/**
 * SatGoProvider — obtiene por SatGo (proveedor fiscal):
 *   - CSF  (Constancia de Situación Fiscal)  → recurso `csf`  (requiere CIEC).
 *   - SAT  (Opinión de Cumplimiento 32-D)     → recurso `oc`   (CIEC) o `ocpublico`
 *                                               (pública por RFC, sin CIEC) si no hay clave.
 *   - IMSS (Opinión de Cumplimiento)          → recurso `imssoc` (SOLO RFC, sin CIEC).
 *
 * El sentido del 32-D / IMSS se infiere del PDF (mapearSentido); la CSF es VIGENTE.
 * El acceso FIEL vía SatGo queda pendiente (hoy: CIEC para csf/oc, RFC para imssoc/ocpublico).
 */
export class SatGoProvider implements IComplianceProvider {
  constructor(public readonly organismo: string = 'SAT') {}

  async ejecutar(req: ComplianceRequest, cred: CredContext): Promise<ProviderResult> {
    const rfc = String(req.rfc || cred.usuario || '').toUpperCase().trim();
    if (!rfc) return { estado: 'ERROR', mensaje: 'RFC de la empresa ausente.' };
    const secret = cred.credencial;   // clave CIEC (descifrada en memoria), puede faltar

    // Resuelve recurso + si requiere CIEC según el tipo.
    let recurso: satgo.RecursoPdf;
    if (req.tipo === 'CSF') {
      recurso = 'csf';
      if (!secret) {
        return {
          estado: 'REQUIRES_USER_ACTION',
          mensaje: 'La CSF por SatGo requiere la clave CIEC de la empresa (Configurar → credencial).',
        };
      }
    } else if (req.tipo === 'IMSS') {
      recurso = 'imssoc';                 // IMSS: por RFC, no usa CIEC
    } else {
      // SAT / Opinión 32-D: con CIEC usa la privada `oc`; sin CIEC, la pública opt-in.
      recurso = secret ? 'oc' : 'ocpublico';
    }

    const usaSecret = recurso === 'csf' || recurso === 'oc';
    let buf: Buffer;
    try {
      buf = await satgo.consultarPdf(recurso, rfc, usaSecret ? secret : undefined);
    } catch (e: any) {
      return { estado: 'ERROR', mensaje: String(e?.message || 'Error consultando SatGo').slice(0, 400) };
    }

    let sentido: Sentido = req.tipo === 'CSF' ? 'VIGENTE' : 'OTRO';
    if (req.tipo !== 'CSF') {
      try {
        const pdfParse = (await import('pdf-parse')).default as any;
        const texto = (await pdfParse(buf))?.text || '';
        sentido = mapearSentido(texto) || 'OTRO';
      } catch { /* se queda OTRO */ }
    }

    const fuente = recurso === 'ocpublico' ? 'en línea (opinión pública)' : 'en línea';
    return {
      estado: 'SUCCESS',
      sentido,
      fechaOpinion: new Date().toISOString().slice(0, 10),
      pdfBase64: `data:application/pdf;base64,${buf.toString('base64')}`,
      mensaje: `Obtenido ${fuente}.`,
    };
  }
}
