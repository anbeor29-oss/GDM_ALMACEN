import type { IComplianceProvider } from '../provider.interface';
import type { ComplianceRequest, CredContext, ProviderResult, Sentido } from '../types';
import { mapearSentido } from '../sat-parse';
import * as satgo from '../../satgo/satgo.service';

/**
 * SatGoProvider — obtiene la Constancia de Situación Fiscal (CSF) y la Opinión de
 * Cumplimiento 32-D del SAT a través de SatGo (proveedor fiscal). Usa la clave
 * CIEC de la empresa (header `Secret`); el acceso FIEL vía SatGo queda pendiente.
 * El sentido del 32-D se lee del PDF; la CSF es siempre VIGENTE.
 */
export class SatGoProvider implements IComplianceProvider {
  constructor(public readonly organismo: string = 'SAT') {}

  async ejecutar(req: ComplianceRequest, cred: CredContext): Promise<ProviderResult> {
    const rfc = String(req.rfc || cred.usuario || '').toUpperCase().trim();
    if (!rfc) return { estado: 'ERROR', mensaje: 'RFC de la empresa ausente.' };
    const secret = cred.credencial;   // clave CIEC (descifrada en memoria)
    if (!secret) {
      return {
        estado: 'REQUIRES_USER_ACTION',
        mensaje: 'Falta la clave CIEC de la empresa (Configurar → credencial) para consultar por SatGo. El acceso FIEL vía SatGo queda pendiente.',
      };
    }

    const recurso = req.tipo === 'CSF' ? 'csf' : 'oc';   // oc = Opinión 32-D del SAT
    let buf: Buffer;
    try {
      buf = await satgo.consultarPdfCiec(recurso, rfc, secret);
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

    return {
      estado: 'SUCCESS',
      sentido,
      fechaOpinion: new Date().toISOString().slice(0, 10),
      pdfBase64: `data:application/pdf;base64,${buf.toString('base64')}`,
      mensaje: 'Obtenido de SatGo.',
    };
  }
}
