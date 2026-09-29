import type { IComplianceProvider } from '../provider.interface';
import type { OrganismoTipo } from '../types';
import { PendienteProvider } from './pendiente.provider';
import { MockProvider } from './mock.provider';

/** Qué falta para conectar el adaptador real de cada organismo. */
const NOTAS: Record<OrganismoTipo, string> = {
  SAT: 'Fase 2: Opinión 32-D por RFC (consulta pública opt-in) y CSF con e.firma.',
  CSF: 'Fase 2: Constancia de Situación Fiscal (e.firma o lectura de la CIF).',
  IMSS: 'Fase 3: Opinión del IMSS por Buzón/e.firma (reusa la herramienta local).',
  INFONAVIT: 'Fase 4: Constancia del Portal Empresarial (validar mecanismo vigente).',
};

/**
 * getProvider — devuelve el adaptador del organismo.
 *  - COMPLIANCE_MOCK=true → MockProvider (probar el flujo, sin portales).
 *  - en otro caso → PendienteProvider (no inventa: pide acción del usuario).
 * En su fase, cada rama se sustituye por el adaptador real (SatProvider, etc.).
 */
export function getProvider(tipo: OrganismoTipo): IComplianceProvider {
  if (process.env.COMPLIANCE_MOCK === 'true') return new MockProvider(tipo);
  return new PendienteProvider(tipo, NOTAS[tipo]);
}
