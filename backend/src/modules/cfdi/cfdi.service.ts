/**
 * CFDI Generator Service
 * Generates CFDI 4.0 XML compliant with SAT specifications
 */

import { v4 as uuidv4 } from 'uuid';
import * as invoicesService from '../invoices/invoices.service';
import * as customersService from '../customers/customers.service';
import * as companiesService from '../companies/companies.service';
import { query } from '../../config/database';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

interface CFDIData {
  companyId: string;
  invoiceId: string;
}

/**
 * Generar XML CFDI 4.0
 * Estructura según Anexo 20 del SAT
 */
export async function generateCFDIXML(data: CFDIData): Promise<string> {
  // 1. Obtener datos de factura
  const invoice = await invoicesService.getInvoiceById(data.companyId, data.invoiceId);

  if (!invoice) {
    throw new NotFoundError('Invoice not found');
  }

  // 2. Obtener company (emisor)
  const company = await companiesService.getCompanyById(data.companyId);

  // 3. Obtener customer (receptor)
  const customer = await customersService.getCustomerById(data.companyId, invoice.customer_id);

  // 4. Generar UUID del CFDI
  const cfdiUUID = uuidv4().toUpperCase();

  // 5. Fecha emisión
  const dateIssued = new Date(invoice.date_issued).toISOString().split('T')[0];
  const timeIssued = new Date(invoice.date_issued).toISOString().split('T')[1];

  // Construye el nodo cfdi:Impuestos agregado a partir de las líneas
  const impuestosNode = generateImpuestosNode(invoice.items);

  // 6. Construir XML CFDI 4.0
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante
  xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd"
  Version="4.0"
  Id="UUID-${cfdiUUID}"
  Fecha="${dateIssued}T${timeIssued}"
  Folio="${invoice.folio}"
  Serie="${invoice.serie}"
  FormaPago="${invoice.payment_form || '01'}"
  CondicionesDePago="${escapeXml(invoice.payment_terms || 'Contado')}"
  TipoDeComprobante="I"
  CurrencyCode="${invoice.currency || 'MXN'}"
  TipoCambio="${invoice.exchange_rate || 1}"
  SubTotal="${Number(invoice.subtotal).toFixed(2)}"
  Descuento="${Number(invoice.discount || 0).toFixed(2)}"
  Total="${Number(invoice.total).toFixed(2)}"
  Moneda="${invoice.currency || 'MXN'}"
  LugarExpedicion="${company.postal_code || '00000'}"
  MetodoPago="${invoice.payment_method || 'PUE'}"
  Exportacion="01">

  <!-- EMISOR (Company) -->
  <cfdi:Emisor
    Rfc="${company.rfc}"
    Nombre="${escapeXml(company.business_name)}"
    RegimenFiscal="${company.fiscal_regime || '601'}"/>

  <!-- RECEPTOR (Customer) -->
  <cfdi:Receptor
    Rfc="${customer.rfc}"
    Nombre="${escapeXml(customer.business_name)}"
    DomicilioFiscalReceptor="${customer.postal_code || '00000'}"
    RegimenFiscalReceptor="${customer.fiscal_regime || invoice.regimen_fiscal_receptor || '616'}"
    UsoCFDI="${invoice.cfdi_use || 'G01'}"/>

  <!-- CONCEPTOS (Line Items) -->
  <cfdi:Conceptos>
${generateConceptos(invoice.items)}
  </cfdi:Conceptos>

${impuestosNode}

</cfdi:Comprobante>`;

  // 7. Guardar XML en BD
  await query(
    `UPDATE invoices
     SET xml_content = $1, cfdi_uuid = $2, updated_at = NOW()
     WHERE id = $3`,
    [xml, cfdiUUID, data.invoiceId]
  );

  logger.info(`CFDI XML generated for invoice ${invoice.serie}-${invoice.folio}`);

  return xml;
}

function escapeXml(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generar conceptos (líneas) de CFDI con sus impuestos por línea.
 * Anexo 20:
 *   - Impuesto 002 = IVA  (TipoFactor Tasa | Exento)
 *   - Impuesto 003 = IEPS (TipoFactor Tasa)
 *   - Retenciones: IVA 002 (Tasa), ISR 001 (Tasa)
 *   - ObjetoImp: "01" no objeto, "02" sí objeto de impuesto, "03" sí objeto sin obligación de desglose
 */
function generateConceptos(items: any[]): string {
  return items
    .map((item) => {
      const base    = Number(item.subtotal || 0);
      const ivaTasa = Number(item.tax_rate || 0);
      const ivaAmt  = Number(item.tax_amount || 0);
      const retIvaR = Number(item.ret_iva_rate || 0);
      const retIvaA = Number(item.ret_iva_amount || 0);
      const retIsrR = Number(item.ret_isr_rate || 0);
      const retIsrA = Number(item.ret_isr_amount || 0);
      const iepsR   = Number(item.ieps_rate || 0);
      const iepsA   = Number(item.ieps_amount || 0);
      const exempt  = !!item.is_exempt;

      // Si no tiene IVA, ni IEPS, ni retenciones → "no objeto"
      const hasAnyTax = exempt || ivaTasa > 0 || iepsR > 0 || retIvaR > 0 || retIsrR > 0;
      const objetoImp = hasAnyTax ? '02' : '01';

      const traslados: string[] = [];
      if (exempt) {
        traslados.push(
          `          <cfdi:Traslado Base="${base.toFixed(2)}" Impuesto="002" TipoFactor="Exento"/>`
        );
      } else if (ivaTasa > 0 || (objetoImp === '02' && retIvaR === 0 && iepsR === 0)) {
        traslados.push(
          `          <cfdi:Traslado Base="${base.toFixed(2)}" Impuesto="002" TipoFactor="Tasa" ` +
          `TasaOCuota="${ivaTasa.toFixed(6)}" Importe="${ivaAmt.toFixed(2)}"/>`
        );
      }
      if (iepsR > 0) {
        traslados.push(
          `          <cfdi:Traslado Base="${base.toFixed(2)}" Impuesto="003" TipoFactor="Tasa" ` +
          `TasaOCuota="${iepsR.toFixed(6)}" Importe="${iepsA.toFixed(2)}"/>`
        );
      }

      const retenciones: string[] = [];
      if (retIvaR > 0) {
        retenciones.push(
          `          <cfdi:Retencion Base="${base.toFixed(2)}" Impuesto="002" TipoFactor="Tasa" ` +
          `TasaOCuota="${retIvaR.toFixed(6)}" Importe="${retIvaA.toFixed(2)}"/>`
        );
      }
      if (retIsrR > 0) {
        retenciones.push(
          `          <cfdi:Retencion Base="${base.toFixed(2)}" Impuesto="001" TipoFactor="Tasa" ` +
          `TasaOCuota="${retIsrR.toFixed(6)}" Importe="${retIsrA.toFixed(2)}"/>`
        );
      }

      let impuestosBlock = '';
      if (objetoImp === '02' && (traslados.length || retenciones.length)) {
        impuestosBlock = `
      <cfdi:Impuestos>
${retenciones.length ? `        <cfdi:Retenciones>\n${retenciones.join('\n')}\n        </cfdi:Retenciones>\n` : ''}${traslados.length ? `        <cfdi:Traslados>\n${traslados.join('\n')}\n        </cfdi:Traslados>` : ''}
      </cfdi:Impuestos>`;
      }

      return `    <cfdi:Concepto
      ClaveProdServ="${item.clave_sat || '01010101'}"
      NoIdentificacion="${escapeXml(item.no_identificacion || item.product_id || '')}"
      Cantidad="${Number(item.quantity).toFixed(3)}"
      ClaveUnidad="${item.unit_code || 'H87'}"
      Descripcion="${escapeXml(item.description || 'Concepto')}"
      ValorUnitario="${Number(item.unit_price).toFixed(2)}"
      Importe="${base.toFixed(2)}"
      ObjetoImp="${objetoImp}">${impuestosBlock}
    </cfdi:Concepto>`;
    })
    .join('\n');
}

/**
 * Nodo <cfdi:Impuestos> agregado de la factura:
 *   suma todas las retenciones y traslados por (Impuesto, TipoFactor, TasaOCuota).
 */
function generateImpuestosNode(items: any[]): string {
  // Buckets por clave única
  const traslados = new Map<string, { impuesto: string; tipoFactor: string; tasa: number; base: number; importe: number }>();
  const retenciones = new Map<string, { impuesto: string; importe: number }>();

  let totalTraslados = 0;
  let totalRetenciones = 0;

  for (const it of items || []) {
    const base    = Number(it.subtotal || 0);
    const ivaTasa = Number(it.tax_rate || 0);
    const ivaAmt  = Number(it.tax_amount || 0);
    const retIvaR = Number(it.ret_iva_rate || 0);
    const retIvaA = Number(it.ret_iva_amount || 0);
    const retIsrR = Number(it.ret_isr_rate || 0);
    const retIsrA = Number(it.ret_isr_amount || 0);
    const iepsR   = Number(it.ieps_rate || 0);
    const iepsA   = Number(it.ieps_amount || 0);
    const exempt  = !!it.is_exempt;

    if (exempt) {
      const k = `002|Exento|0`;
      const cur = traslados.get(k) || { impuesto: '002', tipoFactor: 'Exento', tasa: 0, base: 0, importe: 0 };
      cur.base += base;
      traslados.set(k, cur);
    } else if (ivaTasa > 0) {
      const k = `002|Tasa|${ivaTasa.toFixed(6)}`;
      const cur = traslados.get(k) || { impuesto: '002', tipoFactor: 'Tasa', tasa: ivaTasa, base: 0, importe: 0 };
      cur.base += base; cur.importe += ivaAmt;
      traslados.set(k, cur);
      totalTraslados += ivaAmt;
    }
    if (iepsR > 0) {
      const k = `003|Tasa|${iepsR.toFixed(6)}`;
      const cur = traslados.get(k) || { impuesto: '003', tipoFactor: 'Tasa', tasa: iepsR, base: 0, importe: 0 };
      cur.base += base; cur.importe += iepsA;
      traslados.set(k, cur);
      totalTraslados += iepsA;
    }
    if (retIvaR > 0) {
      const cur = retenciones.get('002') || { impuesto: '002', importe: 0 };
      cur.importe += retIvaA;
      retenciones.set('002', cur);
      totalRetenciones += retIvaA;
    }
    if (retIsrR > 0) {
      const cur = retenciones.get('001') || { impuesto: '001', importe: 0 };
      cur.importe += retIsrA;
      retenciones.set('001', cur);
      totalRetenciones += retIsrA;
    }
  }

  const trasladosXml = Array.from(traslados.values())
    .map((t) =>
      t.tipoFactor === 'Exento'
        ? `      <cfdi:Traslado Base="${t.base.toFixed(2)}" Impuesto="${t.impuesto}" TipoFactor="Exento"/>`
        : `      <cfdi:Traslado Base="${t.base.toFixed(2)}" Impuesto="${t.impuesto}" TipoFactor="Tasa" TasaOCuota="${t.tasa.toFixed(6)}" Importe="${t.importe.toFixed(2)}"/>`
    )
    .join('\n');
  const retencionesXml = Array.from(retenciones.values())
    .map((r) => `      <cfdi:Retencion Impuesto="${r.impuesto}" Importe="${r.importe.toFixed(2)}"/>`)
    .join('\n');

  const attrs: string[] = [];
  if (totalRetenciones > 0) attrs.push(`TotalImpuestosRetenidos="${totalRetenciones.toFixed(2)}"`);
  if (totalTraslados > 0)   attrs.push(`TotalImpuestosTrasladados="${totalTraslados.toFixed(2)}"`);
  if (!attrs.length && !trasladosXml && !retencionesXml) return '';

  return `  <cfdi:Impuestos ${attrs.join(' ')}>
${retencionesXml ? `    <cfdi:Retenciones>\n${retencionesXml}\n    </cfdi:Retenciones>\n` : ''}${trasladosXml ? `    <cfdi:Traslados>\n${trasladosXml}\n    </cfdi:Traslados>` : ''}
  </cfdi:Impuestos>`;
}

/**
 * Get CFDI UUID
 */
export async function getCFDIUUID(companyId: string, invoiceId: string): Promise<string> {
  const result = await query(
    `SELECT cfdi_uuid FROM invoices WHERE id = $1 AND company_id = $2`,
    [invoiceId, companyId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Invoice not found');
  }

  if (!result.rows[0].cfdi_uuid) {
    throw new ValidationError('CFDI not yet generated for this invoice');
  }

  return result.rows[0].cfdi_uuid;
}

/**
 * Get CFDI XML Content
 */
export async function getCFDIXMLContent(companyId: string, invoiceId: string): Promise<string> {
  const result = await query(
    `SELECT xml_content FROM invoices WHERE id = $1 AND company_id = $2`,
    [invoiceId, companyId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Invoice not found');
  }

  if (!result.rows[0].xml_content) {
    throw new ValidationError('XML not yet generated for this invoice');
  }

  return result.rows[0].xml_content;
}

/**
 * Validate CFDI XML structure
 */
export function validateCFDIXML(xml: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check required namespaces
  if (!xml.includes('xmlns:cfdi="http://www.sat.gob.mx/cfd/4"')) {
    errors.push('Missing or incorrect cfdi namespace');
  }

  // Check required elements
  const requiredElements = [
    '<cfdi:Comprobante',
    '<cfdi:Emisor',
    '<cfdi:Receptor',
    '<cfdi:Conceptos',
    '<cfdi:Impuestos',
  ];

  requiredElements.forEach((element) => {
    if (!xml.includes(element)) {
      errors.push(`Missing required element: ${element}`);
    }
  });

  // Check XML structure
  if (!xml.startsWith('<?xml')) {
    errors.push('Invalid XML declaration');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Mark invoice as CFDI generated
 */
export async function markCFDIGenerated(companyId: string, invoiceId: string): Promise<void> {
  await query(
    `UPDATE invoices SET is_stamped = false, updated_at = NOW() WHERE id = $1 AND company_id = $2`,
    [invoiceId, companyId]
  );

  logger.info(`Invoice ${invoiceId} marked as CFDI generated`);
}

export default {
  generateCFDIXML,
  getCFDIUUID,
  getCFDIXMLContent,
  validateCFDIXML,
  markCFDIGenerated,
};
