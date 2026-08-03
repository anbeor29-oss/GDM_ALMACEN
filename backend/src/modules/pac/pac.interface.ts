/**
 * PAC Interface
 * Contrato abstracto para CUALQUIER proveedor de timbrado (PAC)
 *
 * IMPORTANTE: Esta es la capa de abstracción. NO está conectada a ningún PAC real.
 * Cuando se elija un PAC (Finkok, Solución Factible, SW Sapien, etc.),
 * solo se implementa esta interfaz en un nuevo archivo (ej: finkok.provider.ts)
 * y se registra en pac.service.ts. El resto del sistema NO cambia.
 */

/**
 * Resultado del timbrado
 */
export interface StampResult {
  success: boolean;
  uuid?: string;              // Folio Fiscal asignado por SAT
  xml_stamped?: string;       // XML con TimbreFiscalDigital
  sello_sat?: string;         // Sello del SAT
  sello_cfd?: string;         // Sello del emisor
  no_certificado_sat?: string;
  fecha_timbrado?: string;
  cadena_original_sat?: string;
  qr_code?: string;           // Código QR para el PDF
  /**
   * true cuando la factura YA estaba timbrada y esto es un reintento: el
   * resultado se reconstruyó de lo guardado y NO se consumió un timbre nuevo.
   * El cliente lo necesita para no reportar un cobro que no ocurrió.
   */
  already_stamped?: boolean;
  errors: string[];
}

/**
 * Resultado de cancelación
 */
export interface CancelResult {
  success: boolean;
  uuid: string;
  status: 'CANCELLED' | 'PENDING' | 'REJECTED';
  acuse?: string;             // Acuse de cancelación del SAT
  fecha_cancelacion?: string;
  errors: string[];
}

/**
 * Estado de cuenta del PAC (timbres disponibles)
 */
export interface PACAccountStatus {
  provider: string;
  timbres_disponibles: number;
  timbres_consumidos: number;
  is_test_mode: boolean;
}

/**
 * Credenciales del PAC
 */
/**
 * Certificado de sello para cancelar SIN depender de la bóveda del PAC.
 *
 * El método por UUID exige que el CSD esté cargado en la cuenta del PAC; si no
 * lo está, el SAT responde CA305 (Certificado Inválido) y no hay nada que
 * corregir desde el código. Mandando el certificado, la cancelación se sostiene
 * sola con lo que el sistema ya guarda.
 */
export interface CsdParaCancelar {
  b64Cer: string;
  b64Key: string;
  password: string;
}

export interface PACCredentials {
  provider: string;
  username: string;
  password: string;
  api_key?: string;
  is_test_mode: boolean;
}

/**
 * INTERFAZ PAC PROVIDER
 * Todo proveedor de timbrado debe implementar estos métodos.
 */
export interface IPACProvider {
  /** Nombre del proveedor */
  readonly name: string;

  /** Timbrar un CFDI (enviar XML, recibir XML timbrado + UUID) */
  stamp(xmlContent: string, credentials: PACCredentials): Promise<StampResult>;

  /**
   * Timbrar desde JSON — el PAC arma el XML, lo sella con la .key del emisor
   * (guardada en su vault) y timbra ante el SAT. Preferimos esta ruta cuando
   * está disponible porque evita manejar la clave privada en nuestro backend.
   * Devuelve XML timbrado + UUID + sellos + QR.
   *
   * Providers que no soporten JSON pueden dejar este método sin implementar
   * (throw). El registry / caller decidirá.
   */
  stampFromJson?(payload: any, credentials: PACCredentials): Promise<StampResult>;

  /** Cancelar un CFDI ante el SAT */
  cancel(
    uuid: string,
    rfcEmisor: string,
    motivo: string,
    credentials: PACCredentials,
    /* Obligatorio cuando motivo = '01' (comprobante emitido con errores CON
     * relación): es el UUID de la factura que sustituye a la cancelada. Se
     * validaba en pac.service pero NUNCA llegaba hasta aquí, así que una
     * cancelación por motivo 01 se enviaba sin él. */
    folioSustitucion?: string,
    /* Si viene, se cancela enviando el certificado en la petición en lugar de
     * confiar en el que el PAC tenga guardado. */
    csd?: CsdParaCancelar
  ): Promise<CancelResult>;

  /** Consultar timbres disponibles */
  getAccountStatus(credentials: PACCredentials): Promise<PACAccountStatus>;

  /** Validar que las credenciales funcionan */
  testConnection(credentials: PACCredentials): Promise<boolean>;
}

/**
 * Motivos de cancelación SAT (catálogo c_MotivoCancelacion)
 */
export const MOTIVOS_CANCELACION = {
  '01': 'Comprobante emitido con errores con relación',
  '02': 'Comprobante emitido con errores sin relación',
  '03': 'No se llevó a cabo la operación',
  '04': 'Operación nominativa relacionada en una factura global',
} as const;

export type MotivoCancelacion = keyof typeof MOTIVOS_CANCELACION;
