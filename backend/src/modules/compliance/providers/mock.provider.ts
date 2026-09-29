import type { IComplianceProvider } from '../provider.interface';
import type { ComplianceRequest, CredContext, ProviderResult } from '../types';

/**
 * MockProvider — SÓLO para probar el flujo del motor (bitácora, evidencia, hash,
 * scheduler) SIN tocar portales de gobierno. Se activa con COMPLIANCE_MOCK=true.
 * Devuelve una opinión POSITIVA/VIGENTE con un PDF diminuto claramente marcado
 * como simulado. Jamás debe encenderse en producción.
 */
const PDF_MINIMO =
  'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAzMDAgMTQ0XT4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTkwCiUlRU9GCg==';

export class MockProvider implements IComplianceProvider {
  constructor(public readonly organismo: string) {}

  async ejecutar(req: ComplianceRequest, _cred: CredContext): Promise<ProviderResult> {
    const hoy = new Date().toISOString().slice(0, 10);
    return {
      estado: 'SUCCESS',
      sentido: req.tipo === 'CSF' ? 'VIGENTE' : 'POSITIVA',
      fechaOpinion: hoy,
      folio: `MOCK-${Date.now()}`,
      observaciones: 'Resultado SIMULADO (COMPLIANCE_MOCK). No es un documento oficial.',
      pdfBase64: PDF_MINIMO,
      mensaje: 'Ejecución simulada correcta.',
    };
  }
}
