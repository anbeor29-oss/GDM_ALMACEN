/**
 * Tipos del motor de cumplimiento (SAT 32-D, CSF, IMSS, INFONAVIT).
 *
 * Se distinguen dos ejes que suelen confundirse:
 *  - ESTADO TÉCNICO del intento (¿se pudo consultar?): EstadoEjecucion.
 *  - SENTIDO FISCAL del documento (¿está al corriente?): Sentido.
 * Un ERROR de portal NUNCA se traduce a NEGATIVA: son cosas distintas.
 */

export type OrganismoTipo = 'SAT' | 'IMSS' | 'INFONAVIT' | 'CSF';
export type MetodoObtencion = 'PORTAL' | 'API' | 'EFIRMA';
export type Disparo = 'MANUAL' | 'SCHEDULER' | 'API';

/** Estado TÉCNICO del intento. REQUIRES_USER_ACTION = topó con CAPTCHA/MFA. */
export type EstadoEjecucion =
  | 'STARTED' | 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'BLOCKED'
  | 'REQUIRES_USER_ACTION' | 'SKIPPED' | 'NO_DISPONIBLE';

/** Sentido FISCAL del documento (lo define el documento oficial, no el motor). */
export type Sentido = 'POSITIVA' | 'NEGATIVA' | 'SIN_ADEUDOS' | 'SUSPENDIDA' | 'VIGENTE' | 'OTRO';

export interface ComplianceRequest {
  companyId: string;
  tipo: OrganismoTipo;
  rfc?: string;          // RFC de la empresa — el adaptador valida credencial == empresa
  disparo: Disparo;
  userId?: string;
}

/** Config + credenciales descifradas, vivas SOLO en memoria durante la ejecución. */
export interface CredContext {
  metodo: MetodoObtencion;
  baseUrl?: string;
  usuario?: string;
  credencial?: string;   // contraseña/CIEC en claro EN MEMORIA (jamás se registra)
  token?: string;        // API key/token en claro EN MEMORIA
  extra?: any;
}

/** Lo que devuelve un adaptador tras intentar obtener el documento. */
export interface ProviderResult {
  estado: EstadoEjecucion;
  sentido?: Sentido;         // sólo si estado === 'SUCCESS'
  fechaOpinion?: string;     // AAAA-MM-DD
  folio?: string;
  observaciones?: string;
  pdfBase64?: string;        // data-URL application/pdf;base64,…
  httpStatus?: number;
  mensaje?: string;          // diagnóstico SIN secretos
}

/** Resultado de una ejecución completa (lo que ve quien llama al motor). */
export interface ComplianceResult extends ProviderResult {
  executionId: string;
  resultadoId?: string;      // id de la evidencia guardada (si SUCCESS con PDF)
}
