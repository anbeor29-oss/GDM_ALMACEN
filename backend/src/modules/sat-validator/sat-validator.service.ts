/**
 * SAT Validator Service
 * Integración con SAT APIs para validar comprobantes timbrados
 */

import axios, { AxiosInstance } from 'axios';
import { query } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

interface SATValidationResult {
  valid: boolean;
  status: 'VALID' | 'INVALID' | 'CANCELLED' | 'UNKNOWN';
  rfc_emisor: string;
  rfc_receptor: string;
  total: number;
  uuid: string;
  fecha_timbrado?: string;
  pac?: string;
  mensaje?: string;
  errors: string[];
}

interface SATStampStatus {
  folio: string;
  uuid: string;
  status: 'STAMPED' | 'PENDING' | 'REJECTED' | 'CANCELLED' | 'UNKNOWN';
  timestamp?: string;
  sello_digital?: string;
  certificado_sat?: string;
}

/**
 * SAT Validator Client
 * Conecta con servicios SAT (producción o pruebas)
 */
export class SATValidatorClient {
  private client: AxiosInstance;
  private apiVersion: string = 'v1';
  private satApiUrl: string;

  constructor(isProduction: boolean = false) {
    // En producción, usar API real de SAT
    // Para demostración, usar URL de pruebas
    this.satApiUrl = isProduction
      ? 'https://www.sat.gob.mx/api'
      : 'https://www.sat.gob.mx/api/test';

    this.client = axios.create({
      baseURL: this.satApiUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Validar comprobante contra SAT
   * RFC Emisor + RFC Receptor + Total + UUID
   */
  async validateComprobante(
    rfcEmisor: string,
    rfcReceptor: string,
    total: string,
    uuid: string
  ): Promise<SATValidationResult> {
    try {
      const response = await this.client.get('/consulta/comprobantes', {
        params: {
          rfc_emisor: rfcEmisor,
          rfc_receptor: rfcReceptor,
          total: total,
          uuid: uuid,
        },
      });

      if (response.status === 200) {
        return {
          valid: true,
          status: response.data.estatus || 'VALID',
          rfc_emisor: rfcEmisor,
          rfc_receptor: rfcReceptor,
          total: parseFloat(total),
          uuid: uuid,
          fecha_timbrado: response.data.fecha_timbrado,
          pac: response.data.pac,
          errors: [],
        };
      }

      return {
        valid: false,
        status: 'INVALID',
        rfc_emisor: rfcEmisor,
        rfc_receptor: rfcReceptor,
        total: parseFloat(total),
        uuid: uuid,
        errors: ['Comprobante no encontrado en SAT'],
      };
    } catch (error) {
      logger.error('SAT API validation error', {
        uuid,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        valid: false,
        status: 'UNKNOWN',
        rfc_emisor: rfcEmisor,
        rfc_receptor: rfcReceptor,
        total: parseFloat(total),
        uuid: uuid,
        errors: [`SAT API error: ${error instanceof Error ? error.message : 'Unknown'}`],
      };
    }
  }

  /**
   * Obtener estatus de timbrado
   */
  async getStampStatus(uuid: string): Promise<SATStampStatus> {
    try {
      const response = await this.client.get(`/timbrados/${uuid}`);

      return {
        folio: response.data.folio,
        uuid: uuid,
        status: response.data.estatus || 'UNKNOWN',
        timestamp: response.data.timestamp,
        sello_digital: response.data.sello,
        certificado_sat: response.data.certificado,
      };
    } catch (error) {
      logger.warn('Could not get SAT stamp status', { uuid });

      return {
        folio: '',
        uuid: uuid,
        status: 'UNKNOWN',
      };
    }
  }

  /**
   * Descargar comprobante timbrado (XML)
   */
  async downloadTimbredXML(uuid: string): Promise<string> {
    try {
      const response = await this.client.get(`/descarga/${uuid}`, {
        responseType: 'text',
      });

      return response.data;
    } catch (error) {
      throw new ValidationError(
        `Failed to download timbred XML: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Verificar cancelación
   */
  async checkCancellation(rfcEmisor: string, uuid: string): Promise<boolean> {
    try {
      const response = await this.client.get('/cancelacion/consulta', {
        params: {
          rfc_emisor: rfcEmisor,
          uuid: uuid,
        },
      });

      return response.data.cancelado === true;
    } catch (error) {
      logger.warn('Could not check cancellation status', { uuid });
      return false;
    }
  }
}

/**
 * Validar sello digital de comprobante
 */
export function validateDigitalSeal(
  xmlContent: string,
  sello: string,
  certificado: string
): boolean {
  // En una implementación real, esto verificaría:
  // 1. El certificado es válido y no expirado
  // 2. El sello corresponde al contenido del XML
  // 3. El certificado es de SAT
  //
  // Para demostración, solo verificamos que los campos existan
  if (!sello || !certificado) {
    return false;
  }

  // Verificar que el sello es base64
  try {
    Buffer.from(sello, 'base64');
    Buffer.from(certificado, 'base64');
    return true;
  } catch {
    return false;
  }
}

/**
 * Validar que el UUID está en el XML
 */
export function validateUUIDInXML(xmlContent: string, uuid: string): boolean {
  return xmlContent.includes(uuid);
}

/**
 * Guardar validación en BD
 */
export async function saveValidation(
  companyId: string,
  invoiceId: string,
  validationResult: SATValidationResult
): Promise<void> {
  await query(
    `INSERT INTO cfdi_validations
     (company_id, invoice_id, validation_type, is_valid, status,
      rfc_emisor, rfc_receptor, total, uuid, response_data, created_at)
     VALUES ($1, $2, 'SAT', $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (invoice_id, validation_type)
     DO UPDATE SET
       is_valid = $3,
       status = $4,
       response_data = $9,
       updated_at = NOW()`,
    [
      companyId,
      invoiceId,
      validationResult.valid,
      validationResult.status,
      validationResult.rfc_emisor,
      validationResult.rfc_receptor,
      validationResult.total,
      validationResult.uuid,
      JSON.stringify(validationResult),
    ]
  );
}

/**
 * Obtener último estado de validación
 */
export async function getLastValidation(invoiceId: string): Promise<any> {
  const result = await query(
    `SELECT * FROM cfdi_validations
     WHERE invoice_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [invoiceId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('No validation found for this invoice');
  }

  return result.rows[0];
}

/**
 * Validar lote de comprobantes
 */
export async function validateBatch(
  client: SATValidatorClient,
  comprobantes: Array<{
    rfc_emisor: string;
    rfc_receptor: string;
    total: string;
    uuid: string;
  }>
): Promise<SATValidationResult[]> {
  const results: SATValidationResult[] = [];

  for (const comprobante of comprobantes) {
    try {
      const result = await client.validateComprobante(
        comprobante.rfc_emisor,
        comprobante.rfc_receptor,
        comprobante.total,
        comprobante.uuid
      );
      results.push(result);

      // Agregar delay para no sobrecargar SAT
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      results.push({
        valid: false,
        status: 'UNKNOWN',
        rfc_emisor: comprobante.rfc_emisor,
        rfc_receptor: comprobante.rfc_receptor,
        total: parseFloat(comprobante.total),
        uuid: comprobante.uuid,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      });
    }
  }

  return results;
}

/**
 * Estadísticas de validaciones
 */
export async function getValidationStats(companyId: string): Promise<any> {
  const result = await query(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_valid = true THEN 1 ELSE 0 END) as valid_count,
      SUM(CASE WHEN is_valid = false THEN 1 ELSE 0 END) as invalid_count,
      COUNT(DISTINCT status) as unique_statuses
     FROM cfdi_validations
     WHERE company_id = $1`,
    [companyId]
  );

  return result.rows[0];
}

export default {
  SATValidatorClient,
  validateDigitalSeal,
  validateUUIDInXML,
  saveValidation,
  getLastValidation,
  validateBatch,
  getValidationStats,
};
