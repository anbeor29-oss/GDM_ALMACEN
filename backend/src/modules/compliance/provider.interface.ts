import type { ComplianceRequest, CredContext, ProviderResult } from './types';

/**
 * IComplianceProvider — un adaptador por organismo (SAT, IMSS, INFONAVIT).
 *
 * Capas internas sugeridas dentro de cada adaptador: Auth · Navegación ·
 * Adquisición · Validación. El código que habla con cada portal/API vive SÓLO
 * aquí; el resto de NEXO conoce esta interfaz, no los detalles.
 *
 * REGLA INQUEBRANTABLE: si el adaptador topa con CAPTCHA o MFA, NO los evade —
 * devuelve { estado: 'REQUIRES_USER_ACTION' } para que el usuario complete el
 * paso. Tampoco convierte un error técnico en un sentido fiscal.
 */
export interface IComplianceProvider {
  readonly organismo: string;
  ejecutar(req: ComplianceRequest, cred: CredContext): Promise<ProviderResult>;
}
