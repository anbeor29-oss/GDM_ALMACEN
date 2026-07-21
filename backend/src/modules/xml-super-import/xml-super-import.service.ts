/**
 * xml-super-import.service — detecta y prepara importación unificada de
 * cualquier XML del SAT (Anexo 20):
 *
 *   · CFDI 4.0 puro (Facturas, NC)
 *   · CFDI 4.0 + Complemento Carta Porte 3.1
 *   · CFDI 4.0 + Complemento Nómina 1.2 (solo detecta + guarda metadata)
 *   · CFDI 4.0 + Complemento Recepción de Pagos 2.0 (detecta pero no importa)
 *
 * Reglas de importación (8 del cliente):
 *   1. Skip duplicados (por UUID, RFC, alias)
 *   2. Nueva entidad → preguntar si es cliente o proveedor
 *   3. Productos = servicios de transporte ("viajes") con impuestos configurables
 *   4. Origen/destino → dedup contra cp_lugares; si nuevo, permitir alta
 *   5. Operadores → dedup por RFC
 *   6. Mercancías → preservar código + descripción + claves SAT
 *   7. Vehículos → dedup por placa
 *   8. Aseguradoras → dedup por (nombre + póliza), con plantillas
 */
import * as xml2js from 'xml2js';
import * as crypto from 'crypto';
import { pool } from '../../config/database';

export type XmlType =
  | 'CFDI'
  | 'CFDI_CARTAPORTE'
  | 'CFDI_NOMINA'
  | 'CFDI_PAGOS'
  | 'CFDI_NC'
  | 'DESCONOCIDO';

export interface DetectionResult {
  type: XmlType;
  version?: string;
  tipoComprobante?: string;   // I, E, T, N, P
  uuid?: string;
  fechaEmision?: string;
  total?: number;
  emisor: { rfc: string; nombre?: string; regimenFiscal?: string };
  receptor: { rfc: string; nombre?: string; usoCfdi?: string; domicilioFiscal?: string };
  complementos: string[];     // ['cartaporte31', 'nomina12', ...]
  // Presencia detallada de cada complemento
  hasCartaPorte: boolean;
  hasNomina: boolean;
  hasPagos: boolean;
  // Datos específicos según tipo
  conceptos?: Array<{
    claveSat: string;
    descripcion: string;
    cantidad: number;
    claveUnidad: string;
    valorUnitario: number;
    importe: number;
    impuestos?: { iva?: number; retIva?: number; retIsr?: number };
  }>;
  cartaPorte?: any;  // el nodo cartaporte31:CartaPorte completo (para pasarlo al importador CP existente)
  nomina?: {
    tipoNomina?: string;
    fechaPago?: string;
    fechaInicialPago?: string;
    fechaFinalPago?: string;
    numDiasPagados?: number;
    totalPercepciones?: number;
    totalDeducciones?: number;
    totalOtrosPagos?: number;
  };
  xmlBlob: string;
  xmlSha256: string;
}

/* ─── Helpers ─── */

function attr(node: any, name: string): string | undefined {
  if (!node?.$) return undefined;
  return node.$[name];
}
function get(obj: any, ...keys: string[]): any {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  return undefined;
}
function toArr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
function num(v: any): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Punto de entrada — detecta y clasifica un XML del SAT.
 * NO valida contra XSD; solo lee.
 */
export async function detect(xmlContent: string): Promise<DetectionResult> {
  const parser = new xml2js.Parser({ explicitArray: false });
  const root = await parser.parseStringPromise(xmlContent);
  const comprobante = get(root, 'cfdi:Comprobante', 'Comprobante');
  if (!comprobante) throw new Error('El archivo no es un CFDI válido (no se encontró cfdi:Comprobante)');

  const emisor = get(comprobante, 'cfdi:Emisor', 'Emisor');
  const receptor = get(comprobante, 'cfdi:Receptor', 'Receptor');
  const complemento = get(comprobante, 'cfdi:Complemento', 'Complemento');
  const tfd = get(complemento, 'tfd:TimbreFiscalDigital', 'TimbreFiscalDigital');

  const cartaPorteNode = get(complemento, 'cartaporte31:CartaPorte', 'CartaPorte');
  const nominaNode = get(complemento, 'nomina12:Nomina', 'Nomina');
  const pagosNode = get(complemento, 'pago20:Pagos', 'Pagos');

  const tipoComprobante = attr(comprobante, 'TipoDeComprobante');

  const complementos: string[] = [];
  if (cartaPorteNode) complementos.push('cartaporte31');
  if (nominaNode) complementos.push('nomina12');
  if (pagosNode) complementos.push('pagos20');

  // Clasificación del tipo
  let type: XmlType = 'DESCONOCIDO';
  if (nominaNode) type = 'CFDI_NOMINA';
  else if (cartaPorteNode) type = 'CFDI_CARTAPORTE';
  else if (pagosNode) type = 'CFDI_PAGOS';
  else if (tipoComprobante === 'E') type = 'CFDI_NC';
  else if (tipoComprobante === 'I' || tipoComprobante === 'T') type = 'CFDI';

  // Conceptos
  const conceptosNode = get(comprobante, 'cfdi:Conceptos', 'Conceptos');
  const conceptos = toArr(get(conceptosNode, 'cfdi:Concepto', 'Concepto')).map((c: any) => {
    const impuestos = get(c, 'cfdi:Impuestos', 'Impuestos');
    const traslados = toArr(get(get(impuestos, 'cfdi:Traslados', 'Traslados'), 'cfdi:Traslado', 'Traslado'));
    const retenciones = toArr(get(get(impuestos, 'cfdi:Retenciones', 'Retenciones'), 'cfdi:Retencion', 'Retencion'));
    const iva = traslados.find((t: any) => attr(t, 'Impuesto') === '002');
    const retIva = retenciones.find((r: any) => attr(r, 'Impuesto') === '002');
    const retIsr = retenciones.find((r: any) => attr(r, 'Impuesto') === '001');
    return {
      claveSat: attr(c, 'ClaveProdServ') || '',
      descripcion: attr(c, 'Descripcion') || '',
      cantidad: num(attr(c, 'Cantidad')) ?? 0,
      claveUnidad: attr(c, 'ClaveUnidad') || '',
      valorUnitario: num(attr(c, 'ValorUnitario')) ?? 0,
      importe: num(attr(c, 'Importe')) ?? 0,
      impuestos: {
        iva:     iva     ? num(attr(iva, 'Importe')) : undefined,
        retIva:  retIva  ? num(attr(retIva, 'Importe')) : undefined,
        retIsr:  retIsr  ? num(attr(retIsr, 'Importe')) : undefined,
      },
    };
  });

  // Nómina metadata
  let nomina;
  if (nominaNode) {
    nomina = {
      tipoNomina:         attr(nominaNode, 'TipoNomina'),
      fechaPago:          attr(nominaNode, 'FechaPago'),
      fechaInicialPago:   attr(nominaNode, 'FechaInicialPago'),
      fechaFinalPago:     attr(nominaNode, 'FechaFinalPago'),
      numDiasPagados:     num(attr(nominaNode, 'NumDiasPagados')),
      totalPercepciones:  num(attr(nominaNode, 'TotalPercepciones')),
      totalDeducciones:   num(attr(nominaNode, 'TotalDeducciones')),
      totalOtrosPagos:    num(attr(nominaNode, 'TotalOtrosPagos')),
    };
  }

  return {
    type,
    version: attr(comprobante, 'Version'),
    tipoComprobante,
    uuid: attr(tfd, 'UUID'),
    fechaEmision: attr(comprobante, 'Fecha'),
    total: num(attr(comprobante, 'Total')),
    emisor: {
      rfc: (attr(emisor, 'Rfc') || '').toUpperCase(),
      nombre: attr(emisor, 'Nombre'),
      regimenFiscal: attr(emisor, 'RegimenFiscal'),
    },
    receptor: {
      rfc: (attr(receptor, 'Rfc') || '').toUpperCase(),
      nombre: attr(receptor, 'Nombre'),
      usoCfdi: attr(receptor, 'UsoCFDI'),
      domicilioFiscal: attr(receptor, 'DomicilioFiscalReceptor'),
    },
    complementos,
    hasCartaPorte: !!cartaPorteNode,
    hasNomina: !!nominaNode,
    hasPagos: !!pagosNode,
    conceptos,
    cartaPorte: cartaPorteNode,
    nomina,
    xmlBlob: xmlContent,
    xmlSha256: crypto.createHash('sha256').update(xmlContent).digest('hex'),
  };
}

/**
 * Marca de dedup para cada tipo de entidad — dice si YA existe en la BD de la
 * empresa. Se usa en el preview para mostrar checkmarks.
 */
export async function checkDuplicates(companyId: string, det: DetectionResult) {
  const result: Record<string, { exists: boolean; id?: string }> = {};
  // UUID de la factura (para no re-importar)
  if (det.uuid) {
    const r = await pool.query(
      `SELECT id FROM invoices WHERE company_id = $1 AND cfdi_uuid = $2 LIMIT 1`,
      [companyId, det.uuid],
    );
    result.factura = { exists: (r.rowCount ?? 0) > 0, id: r.rows[0]?.id };
    // También en nomina_imports si es nómina
    if (det.type === 'CFDI_NOMINA') {
      const rn = await pool.query(
        `SELECT id FROM nomina_imports WHERE company_id = $1 AND uuid = $2 LIMIT 1`,
        [companyId, det.uuid],
      );
      result.nomina = { exists: (rn.rowCount ?? 0) > 0, id: rn.rows[0]?.id };
    }
  }
  // Emisor y receptor: dedup por RFC en customers/suppliers
  if (det.emisor.rfc) {
    const r = await pool.query(
      `SELECT id, party_type FROM customers WHERE company_id = $1 AND rfc = $2 AND deleted_at IS NULL LIMIT 1`,
      [companyId, det.emisor.rfc],
    );
    result.emisor = { exists: (r.rowCount ?? 0) > 0, id: r.rows[0]?.id };
  }
  if (det.receptor.rfc) {
    const r = await pool.query(
      `SELECT id, party_type FROM customers WHERE company_id = $1 AND rfc = $2 AND deleted_at IS NULL LIMIT 1`,
      [companyId, det.receptor.rfc],
    );
    result.receptor = { exists: (r.rowCount ?? 0) > 0, id: r.rows[0]?.id };
  }
  return result;
}

/**
 * Guarda un XML de nómina como fila en nomina_imports.
 * Idempotente por (company_id, uuid).
 */
export async function saveNomina(companyId: string, det: DetectionResult, userId?: string) {
  if (det.type !== 'CFDI_NOMINA' || !det.uuid) {
    throw new Error('El XML no es de tipo Nómina o no tiene UUID');
  }
  const r = await pool.query(
    `INSERT INTO nomina_imports (
       company_id, uuid, rfc_emisor, nombre_emisor, rfc_receptor, nombre_receptor,
       fecha_pago, fecha_inicial_pago, fecha_final_pago, num_dias_pagados,
       tipo_nomina, total_percepciones, total_deducciones, total_otros_pagos,
       total_neto, xml_blob, xml_sha256, imported_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (company_id, uuid) DO UPDATE SET
       xml_blob = EXCLUDED.xml_blob,
       xml_sha256 = EXCLUDED.xml_sha256,
       imported_at = NOW()
     RETURNING id`,
    [
      companyId, det.uuid,
      det.emisor.rfc, det.emisor.nombre,
      det.receptor.rfc, det.receptor.nombre,
      det.nomina?.fechaPago || null,
      det.nomina?.fechaInicialPago || null,
      det.nomina?.fechaFinalPago || null,
      det.nomina?.numDiasPagados ?? null,
      det.nomina?.tipoNomina || null,
      det.nomina?.totalPercepciones ?? null,
      det.nomina?.totalDeducciones ?? null,
      det.nomina?.totalOtrosPagos ?? null,
      det.total ?? null,
      det.xmlBlob,
      det.xmlSha256,
      userId ?? null,
    ],
  );
  return { id: r.rows[0].id };
}
