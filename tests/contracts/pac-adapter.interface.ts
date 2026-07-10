/**
 * Interfaz del adapter PAC — contrato que TODO proveedor (Mock / Finkok /
 * Facturama / SW Sapien) debe cumplir. Misma interfaz, misma batería de tests.
 *
 *  - timbrar:   recibe XML CFDI 4.0 sin sello, regresa XML + UUID + sello + fecha
 *  - cancelar:  recibe UUID + motivo c_MotivoCancelacion, regresa acuse
 *  - estatus:   consulta UUID en el SAT, regresa estatus actual
 *  - validar:   sanity check del XML antes de timbrar (offline)
 *
 *  Tipos modelados según Anexo 20 — Apéndice del PAC.
 */

export interface TimbreResult {
  uuid: string;                // 36 chars UPPER, formato 8-4-4-4-12
  selloCfdi: string;           // base64 del sello del emisor
  selloSat: string;            // base64 del sello del PAC
  fechaTimbrado: string;       // ISO 8601 sin zona (CDMX)
  noCertificadoSat: string;    // 20 dígitos
  rfcPac: string;              // RFC del PAC autorizado
  xmlTimbrado: string;         // XML completo con TimbreFiscalDigital
  cadenaOriginalSat: string;   // ||1.1|UUID|FECHA|RFC_PAC|NO_CERT|...||
}

export interface CancelacionAcuse {
  uuid: string;
  status: 'Cancelado' | 'EnProceso' | 'NoEncontrado' | 'Rechazado';
  fechaCancelacion?: string;
  motivo: '01' | '02' | '03' | '04';
  folioSustitucion?: string;
}

export interface EstatusSat {
  estado: 'Vigente' | 'Cancelado' | 'NoEncontrado';
  estadoCancelacion?: 'EnProceso' | 'Cancelado';
  validacionEfos?: '200' | '400'; // 200 = sin observaciones
}

export interface ValidacionLocal {
  valid: boolean;
  errors: Array<{ code: string; message: string; path?: string }>;
}

export interface PacAdapter {
  /** Identificador legible (`mock` | `finkok` | `facturama`). */
  readonly name: string;

  /** Timbra un CFDI 4.0. Debe ser idempotente: re-timbrar el MISMO XML devuelve el MISMO UUID. */
  timbrar(xmlSinSellar: string): Promise<TimbreResult>;

  cancelar(uuid: string, motivo: CancelacionAcuse['motivo'], folioSustitucion?: string): Promise<CancelacionAcuse>;

  consultarEstatus(uuid: string, rfcEmisor: string, rfcReceptor: string, total: number): Promise<EstatusSat>;

  validarLocal(xml: string): Promise<ValidacionLocal>;
}
