import type { IComplianceProvider } from '../provider.interface';
import type { ComplianceRequest, CredContext, ProviderResult, Sentido } from '../types';
import { mapearSentido } from '../sat-parse';
import * as satgo from '../../satgo/satgo.service';

/**
 * SatGoProvider — obtiene por SatGo (proveedor fiscal). Orden de preferencia para
 * CSF (CIF) y SAT (Opinión 32-D):
 *   1) **e.firma (FIEL)** → `csffiel` / `ocfiel` (SIN CIEC) si la empresa tiene su
 *      e.firma vigente cargada. Es lo normal: con la e.firma se bajan CIF y 32-D.
 *   2) **CIEC** → `csf` / `oc` si hay clave CIEC guardada.
 *   3) **Pública** (solo 32-D) → `ocpublico` por RFC (requiere opt-in del contribuyente).
 *   - IMSS → `imssoc` (SOLO RFC, sin CIEC ni e.firma).
 * El sentido del 32-D/IMSS se infiere del PDF (mapearSentido); la CSF es VIGENTE.
 */
export class SatGoProvider implements IComplianceProvider {
  constructor(public readonly organismo: string = 'SAT') {}

  async ejecutar(req: ComplianceRequest, cred: CredContext): Promise<ProviderResult> {
    const rfc = String(req.rfc || cred.usuario || '').toUpperCase().trim();
    if (!rfc) return { estado: 'ERROR', mensaje: 'RFC de la empresa ausente.' };
    const secret = cred.credencial;   // clave CIEC (descifrada en memoria), puede faltar

    // IMSS: por RFC.
    if (req.tipo === 'IMSS') {
      try { return this.armar(req, await satgo.consultarPdf('imssoc', rfc), 'en línea'); }
      catch (e: any) { return { estado: 'ERROR', mensaje: String(e?.message || 'Error consultando SatGo').slice(0, 400) }; }
    }

    // CSF / SAT (32-D): 1) e.firma (FIEL) → 2) CIEC → 3) pública (solo 32-D).
    try {
      const { credencialUsable } = await import('../../sat-descarga/descarga.service');
      const efirma = await credencialUsable(req.companyId).catch(() => null);
      if (efirma) {
        const recurso = req.tipo === 'CSF' ? 'csffiel' : 'ocfiel';
        const buf = await satgo.consultarPdfFiel(recurso, rfc, efirma);   // lanza si falla → cae a CIEC
        return this.armar(req, buf, 'en línea (e.firma)');
      }
    } catch { /* e.firma ausente o FIEL falló → se intenta CIEC / pública */ }

    // 2) CIEC (csf/oc) o 3) pública (ocpublico, solo 32-D).
    let recurso: satgo.RecursoPdf; let fuente: string; let usaSecret: boolean;
    if (req.tipo === 'CSF') {
      if (!secret) {
        return {
          estado: 'REQUIRES_USER_ACTION',
          mensaje: 'La CIF necesita la e.firma vigente de la empresa (recomendado) o su clave CIEC (Configurar → credencial).',
        };
      }
      recurso = 'csf'; usaSecret = true; fuente = 'en línea';
    } else {
      recurso = secret ? 'oc' : 'ocpublico';
      usaSecret = recurso === 'oc';
      fuente = recurso === 'ocpublico' ? 'en línea (opinión pública)' : 'en línea';
    }

    try {
      const buf = await satgo.consultarPdf(recurso, rfc, usaSecret ? secret : undefined);
      return this.armar(req, buf, fuente);
    } catch (e: any) {
      return { estado: 'ERROR', mensaje: String(e?.message || 'Error consultando SatGo').slice(0, 400) };
    }
  }

  /** Arma el resultado SUCCESS desde el PDF (infere el sentido salvo CSF = VIGENTE). */
  private async armar(req: ComplianceRequest, buf: Buffer, fuente: string): Promise<ProviderResult> {
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
      mensaje: `Obtenido ${fuente}.`,
    };
  }
}
