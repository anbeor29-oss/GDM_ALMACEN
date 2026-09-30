import type { IComplianceProvider } from '../provider.interface';
import type { OrganismoTipo } from '../types';
import { PendienteProvider } from './pendiente.provider';
import { MockProvider } from './mock.provider';
import { SatProvider } from './sat.provider';
import { SatGoProvider } from './satgo.provider';

/** Qué falta para conectar el adaptador real de cada organismo pendiente. */
const NOTAS: Record<OrganismoTipo, string> = {
  SAT: 'Fase 2: Opinión 32-D por RFC (consulta pública opt-in) y CSF con e.firma.',
  CSF: 'Fase 2: Constancia de Situación Fiscal (e.firma o lectura de la CIF).',
  IMSS: 'Fase 3: Opinión del IMSS por Buzón/e.firma (reusa la herramienta local).',
  INFONAVIT: 'Fase 4: Constancia del Portal Empresarial (validar mecanismo vigente).',
};

/**
 * getProvider — devuelve el adaptador del organismo.
 *  - COMPLIANCE_MOCK=true → MockProvider (probar el flujo, sin portales).
 *  - SAT / CSF / IMSS → SatGoProvider si SatGo está configurado (API key).
 *      · SAT/CSF de respaldo → SatProvider HTTP genérico si no hay SatGo.
 *      · IMSS por SatGo va por RFC (recurso imssoc, sin CIEC).
 *  - INFONAVIT → PendienteProvider (manual: abre su portal + Registrar).
 */
export async function getProvider(tipo: OrganismoTipo): Promise<IComplianceProvider> {
  if (process.env.COMPLIANCE_MOCK === 'true') return new MockProvider(tipo);

  // ¿Hay SatGo configurado? (una sola verificación reutilizable)
  let satgoListo = false;
  try {
    const { getConfig } = await import('../../satgo/satgo.service');
    satgoListo = (await getConfig()).tieneKey === true;
  } catch { /* sin SatGo */ }

  if (tipo === 'SAT' || tipo === 'CSF' || tipo === 'IMSS') {
    if (satgoListo) return new SatGoProvider(tipo);
    if (tipo === 'SAT' || tipo === 'CSF') return new SatProvider(tipo);
    // IMSS sin SatGo → pendiente (asistente manual en la UI).
  }
  return new PendienteProvider(tipo, NOTAS[tipo]);
}
