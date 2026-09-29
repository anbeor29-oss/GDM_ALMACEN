import type { IComplianceProvider } from '../provider.interface';
import type { ComplianceRequest, CredContext, ProviderResult } from '../types';

/**
 * PendienteProvider — adaptador aún NO conectado a su portal/API oficial.
 *
 * No inventa resultados: devuelve REQUIRES_USER_ACTION explicando qué falta.
 * Se sustituye por el adaptador real en su fase (SAT=Fase 2, IMSS=3, INFONAVIT=4).
 * Así el motor, la bitácora y el scheduler ya funcionan de punta a punta sin
 * fabricar opiniones falsas.
 */
export class PendienteProvider implements IComplianceProvider {
  constructor(public readonly organismo: string, private readonly nota: string) {}

  async ejecutar(_req: ComplianceRequest, _cred: CredContext): Promise<ProviderResult> {
    return {
      estado: 'REQUIRES_USER_ACTION',
      mensaje:
        `Adaptador de ${this.organismo} pendiente de conectar. ${this.nota} ` +
        `Mientras, registra la opinión a mano en el tracker de cumplimiento.`,
    };
  }
}
