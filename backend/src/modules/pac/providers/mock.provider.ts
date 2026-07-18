/**
 * Mock PAC Provider
 *
 * Simula el comportamiento de un PAC real SIN conectarse a ningún servicio externo.
 * Permite probar TODO el flujo de timbrado/cancelación end-to-end con confianza,
 * antes de elegir y conectar un PAC real.
 *
 * Genera UUIDs, sellos simulados y XML timbrado con estructura válida.
 * NO tiene validez fiscal — es solo para pruebas internas.
 */

import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import {
  IPACProvider,
  StampResult,
  CancelResult,
  PACAccountStatus,
  PACCredentials,
} from '../pac.interface';
import logger from '../../../middleware/logger';

export class MockPACProvider implements IPACProvider {
  readonly name = 'MOCK';

  // Simula un contador de timbres disponibles
  private static timbresConsumidos = 0;
  private static readonly TIMBRES_TOTALES = 1000;

  /**
   * Simular timbrado
   */
  async stamp(xmlContent: string, credentials: PACCredentials): Promise<StampResult> {
    logger.info(`[MOCK PAC] Simulando timbrado (test_mode: ${credentials.is_test_mode})`);

    // Simular latencia de red
    await this.delay(300);

    // Validar que el XML tiene estructura mínima
    if (!xmlContent.includes('<cfdi:Comprobante')) {
      return {
        success: false,
        errors: ['[MOCK] XML inválido: falta cfdi:Comprobante'],
      };
    }

    // Generar UUID simulado
    const uuid = uuidv4().toUpperCase();
    const fechaTimbrado = new Date().toISOString();

    // Generar sellos simulados (hashes, NO criptográficamente válidos)
    const selloCfd = this.generateMockSeal(xmlContent);
    const selloSat = this.generateMockSeal(uuid + fechaTimbrado);
    const cadenaOriginalSat = `||1.1|${uuid}|${fechaTimbrado}|MOCK_SAT|...||`;
    const noCertificadoSat = '00001000000500000001';

    // Inyectar TimbreFiscalDigital en el XML (estructura simulada)
    const xmlStamped = this.injectTimbre(xmlContent, {
      uuid,
      fechaTimbrado,
      selloCfd,
      selloSat,
      noCertificadoSat,
    });

    // Generar código QR simulado (URL de verificación SAT)
    const qrCode = this.generateQRData(uuid, credentials.username, xmlContent);

    MockPACProvider.timbresConsumidos++;

    logger.info(`[MOCK PAC] ✅ Timbrado simulado exitoso. UUID: ${uuid}`);

    return {
      success: true,
      uuid,
      xml_stamped: xmlStamped,
      sello_sat: selloSat,
      sello_cfd: selloCfd,
      no_certificado_sat: noCertificadoSat,
      fecha_timbrado: fechaTimbrado,
      cadena_original_sat: cadenaOriginalSat,
      qr_code: qrCode,
      errors: [],
    };
  }

  /**
   * Simular cancelación
   */
  async cancel(
    uuid: string,
    rfcEmisor: string,
    motivo: string,
    credentials: PACCredentials
  ): Promise<CancelResult> {
    logger.info(`[MOCK PAC] Simulando cancelación UUID: ${uuid}, motivo: ${motivo}`);

    await this.delay(300);

    if (!uuid) {
      return {
        success: false,
        uuid,
        status: 'REJECTED',
        errors: ['[MOCK] UUID requerido para cancelación'],
      };
    }

    const acuse = `<Acuse><UUID>${uuid}</UUID><Estatus>Cancelado</Estatus><Fecha>${new Date().toISOString()}</Fecha></Acuse>`;

    logger.info(`[MOCK PAC] ✅ Cancelación simulada exitosa. UUID: ${uuid}`);

    return {
      success: true,
      uuid,
      status: 'CANCELLED',
      acuse,
      fecha_cancelacion: new Date().toISOString(),
      errors: [],
    };
  }

  /**
   * Estado de cuenta simulado
   */
  async getAccountStatus(credentials: PACCredentials): Promise<PACAccountStatus> {
    return {
      provider: this.name,
      timbres_disponibles: MockPACProvider.TIMBRES_TOTALES - MockPACProvider.timbresConsumidos,
      timbres_consumidos: MockPACProvider.timbresConsumidos,
      is_test_mode: credentials.is_test_mode,
    };
  }

  /**
   * Probar conexión (siempre OK en mock)
   */
  async testConnection(credentials: PACCredentials): Promise<boolean> {
    logger.info(`[MOCK PAC] Test de conexión (usuario: ${credentials.username})`);
    await this.delay(100);
    return true;
  }

  // ============ Helpers privados ============

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private generateMockSeal(input: string): string {
    return crypto.createHash('sha256').update(input).digest('base64');
  }

  private injectTimbre(
    xml: string,
    timbre: {
      uuid: string;
      fechaTimbrado: string;
      selloCfd: string;
      selloSat: string;
      noCertificadoSat: string;
    }
  ): string {
    const tfd = `    <tfd:TimbreFiscalDigital
      xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
      Version="1.1"
      UUID="${timbre.uuid}"
      FechaTimbrado="${timbre.fechaTimbrado}"
      RfcProvCertif="MOCK010101AAA"
      SelloCFD="${timbre.selloCfd}"
      NoCertificadoSAT="${timbre.noCertificadoSat}"
      SelloSAT="${timbre.selloSat}"/>`;

    // Un CFDI válido debe tener EXACTAMENTE UN <cfdi:Complemento>: si ya hay
    // (p.ej. cartaporte31), se inserta el TFD dentro. Si no existe, se crea
    // uno nuevo antes del cierre de Comprobante.
    if (xml.includes('<cfdi:Complemento>')) {
      return xml.replace('</cfdi:Complemento>', `${tfd}\n  </cfdi:Complemento>`);
    }
    return xml.replace(
      '</cfdi:Comprobante>',
      `  <cfdi:Complemento>\n${tfd}\n  </cfdi:Complemento>\n</cfdi:Comprobante>`,
    );
  }

  private generateQRData(uuid: string, rfcReceptor: string, xml: string): string {
    // El QR del SAT contiene: id, rfc emisor, rfc receptor, total, últimos 8 del sello
    const totalMatch = xml.match(/Total="([^"]+)"/);
    const total = totalMatch ? totalMatch[1] : '0.00';

    return `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=${uuid}&rr=${rfcReceptor}&tt=${total}&fe=MOCKfe`;
  }
}

export default MockPACProvider;
