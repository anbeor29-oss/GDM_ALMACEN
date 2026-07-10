/**
 * Importador de productos desde XMLs CFDI 4.0.
 *
 * - Acepta XMLs EMITIDOS (nuestra empresa es el Emisor) y RECIBIDOS
 *   (somos el Receptor). En ambos casos extraemos los <cfdi:Concepto>
 *   y los integramos al catálogo de productos del usuario.
 * - Para evitar duplicados, el matching de un concepto contra un producto
 *   existente usa esta prioridad:
 *     1) (company_id, no_identificacion) si NoIdentificacion viene en el XML
 *     2) (company_id, clave_sat, descripcion-normalizada)
 * - Si el RFC del Receptor coincide con un cliente registrado y el XML es
 *   EMITIDO, se actualiza la tabla `customer_products` (memoria cliente↔producto).
 */

import * as xml2js from 'xml2js';
import { query, transaction, transactionQuery } from '../../config/database';
import logger from '../../middleware/logger';

/**
 * Versión transaccional de getNextProductSku. Es CRÍTICO que use el `client`
 * de la transacción para que los productos insertados antes en la MISMA
 * transacción sean visibles aquí (de lo contrario varios conceptos del mismo
 * XML obtendrían el mismo SKU "P-1").
 */
async function nextProductSkuTx(client: any, companyId: string): Promise<string> {
  const r = await transactionQuery<{ max_n: number | null }>(
    client,
    `SELECT COALESCE(MAX(CAST(SUBSTRING(sku FROM '^P-(\\d+)$') AS INTEGER)), 0) AS max_n
       FROM products
      WHERE company_id = $1
        AND sku ~ '^P-\\d+$'
        AND deleted_at IS NULL`,
    [companyId]
  );
  return `P-${(r.rows[0]?.max_n ?? 0) + 1}`;
}

export interface ImportSummary {
  total_files: number;
  files_ok: number;
  files_failed: number;
  invoices_emitted: number;     // donde NUESTRA empresa fue Emisor
  invoices_received: number;    // donde NUESTRA empresa fue Receptor (u otro)
  products_created: number;
  products_updated: number;
  customer_links_updated: number;
  errors: Array<{ file: string; error: string }>;
  items_detail: Array<{
    file: string;
    folio?: string;
    rfcEmisor: string;
    rfcReceptor: string;
    role: 'EMITIDO' | 'RECIBIDO' | 'OTRO';
    products: Array<{ sku: string; name: string; action: 'created' | 'updated' | 'skipped' }>;
  }>;
}

interface ConceptoCFDI {
  claveProdServ: string;
  noIdentificacion?: string;
  cantidad: number;
  claveUnidad: string;
  unidad?: string;
  descripcion: string;
  valorUnitario: number;
  importe: number;
  objetoImp?: string;
  taxRate: number;            // tasa o cuota (ej. 0.16)
}

interface ParsedCFDI {
  folio?: string;
  serie?: string;
  fecha?: string;
  rfcEmisor: string;
  nombreEmisor?: string;
  rfcReceptor: string;
  nombreReceptor?: string;
  uuid?: string;
  conceptos: ConceptoCFDI[];
}

// ──────────────────────── Parser XML ────────────────────────

function getNode(o: any, k: string): any {
  // xml2js entrega arrays incluso para nodos únicos
  if (!o) return undefined;
  return Array.isArray(o[k]) ? o[k][0] : o[k];
}

function attrs(o: any): any {
  return (o && o['$']) || {};
}

async function parseXML(xmlContent: string): Promise<ParsedCFDI> {
  const parser = new xml2js.Parser({ explicitArray: true, attrkey: '$' });
  const doc = await parser.parseStringPromise(xmlContent);
  const root = doc['cfdi:Comprobante'] || doc.Comprobante;
  if (!root) throw new Error('XML inválido: falta cfdi:Comprobante');

  const compAttrs = attrs(root);
  const emisor = getNode(root, 'cfdi:Emisor') || getNode(root, 'Emisor');
  const receptor = getNode(root, 'cfdi:Receptor') || getNode(root, 'Receptor');
  const conceptosNode = getNode(root, 'cfdi:Conceptos') || getNode(root, 'Conceptos');
  const conceptos = conceptosNode
    ? (conceptosNode['cfdi:Concepto'] || conceptosNode['Concepto'] || []) as any[]
    : [];

  const complemento = getNode(root, 'cfdi:Complemento') || getNode(root, 'Complemento');
  const tfd = complemento ? getNode(complemento, 'tfd:TimbreFiscalDigital') : undefined;
  const uuid = tfd ? attrs(tfd).UUID : undefined;

  return {
    folio: compAttrs.Folio,
    serie: compAttrs.Serie,
    fecha: compAttrs.Fecha,
    rfcEmisor: (attrs(emisor).Rfc || '').toUpperCase(),
    nombreEmisor: attrs(emisor).Nombre,
    rfcReceptor: (attrs(receptor).Rfc || '').toUpperCase(),
    nombreReceptor: attrs(receptor).Nombre,
    uuid,
    conceptos: conceptos.map((c: any) => {
      const a = attrs(c);
      const impuestos = getNode(c, 'cfdi:Impuestos') || getNode(c, 'Impuestos');
      const traslados = impuestos ? (getNode(impuestos, 'cfdi:Traslados') || getNode(impuestos, 'Traslados')) : undefined;
      const tlst = traslados ? (traslados['cfdi:Traslado'] || traslados['Traslado'] || []) : [];
      const t0 = Array.isArray(tlst) && tlst.length > 0 ? attrs(tlst[0]) : {};
      return {
        claveProdServ: a.ClaveProdServ || '',
        noIdentificacion: a.NoIdentificacion || undefined,
        cantidad: parseFloat(a.Cantidad || '0'),
        claveUnidad: a.ClaveUnidad || '',
        unidad: a.Unidad,
        descripcion: a.Descripcion || '',
        valorUnitario: parseFloat(a.ValorUnitario || '0'),
        importe: parseFloat(a.Importe || '0'),
        objetoImp: a.ObjetoImp,
        taxRate: t0.TasaOCuota ? parseFloat(t0.TasaOCuota) : 0,
      };
    }),
  };
}

// ──────────────── Matching y upsert de productos ────────────────

function normDesc(s: string): string {
  return (s || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ExistingProduct {
  id: string;
  sku: string;
  name: string;
  base_price: number;
  last_cost: number;
}

async function findExistingProduct(
  client: any,
  companyId: string,
  concepto: ConceptoCFDI
): Promise<ExistingProduct | null> {
  // 1) por no_identificacion
  if (concepto.noIdentificacion) {
    const r = await transactionQuery<ExistingProduct>(
      client,
      `SELECT id, sku, name, base_price, last_cost
         FROM products
        WHERE company_id = $1 AND no_identificacion = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [companyId, concepto.noIdentificacion]
    );
    if (r.rows[0]) return r.rows[0];
  }

  // 2) por (clave_sat + descripción normalizada)
  const descN = normDesc(concepto.descripcion);
  const r2 = await transactionQuery<ExistingProduct>(
    client,
    `SELECT id, sku, name, base_price, last_cost
       FROM products
      WHERE company_id = $1
        AND clave_sat = $2
        AND UPPER(REGEXP_REPLACE(name, '\\s+', ' ', 'g')) = $3
        AND deleted_at IS NULL
      LIMIT 1`,
    [companyId, concepto.claveProdServ, descN]
  );
  return r2.rows[0] || null;
}

/**
 * Crea o actualiza un producto a partir de un concepto del CFDI.
 * Retorna { id, action }.
 */
async function upsertProductFromConcepto(
  client: any,
  companyId: string,
  concepto: ConceptoCFDI
): Promise<{ id: string; sku: string; name: string; action: 'created' | 'updated' | 'skipped' }> {
  if (!concepto.claveProdServ || !concepto.descripcion) {
    return { id: '', sku: '', name: concepto.descripcion, action: 'skipped' };
  }

  const existing = await findExistingProduct(client, companyId, concepto);

  if (existing) {
    // Actualizamos last_cost si la unidad es la misma. No tocamos el SKU ni el name.
    const newLastCost = concepto.valorUnitario || existing.last_cost;
    await transactionQuery(
      client,
      `UPDATE products
          SET last_cost = $1,
              no_identificacion = COALESCE(no_identificacion, $2),
              updated_at = NOW()
        WHERE id = $3`,
      [newLastCost, concepto.noIdentificacion || null, existing.id]
    );
    return { id: existing.id, sku: existing.sku, name: existing.name, action: 'updated' };
  }

  // Crear con SKU automático — usamos la versión transaccional para que vea
  // los inserts intermedios y no entregue el mismo número dos veces.
  const sku = await nextProductSkuTx(client, companyId);
  // Buscamos la descripción de la unidad en el catálogo SAT
  const u = await transactionQuery<{ description: string }>(
    client,
    `SELECT description FROM sat_catalogs
      WHERE catalog_name = 'c_ClaveUnidad' AND catalog_key = $1
      LIMIT 1`,
    [concepto.claveUnidad]
  );
  const unitName = u.rows[0]?.description || concepto.unidad || concepto.claveUnidad;

  const insert = await transactionQuery<{ id: string; sku: string; name: string }>(
    client,
    `INSERT INTO products
       (company_id, sku, name, description, clave_sat, unit_code, unit_name,
        base_price, tax_type, tax_rate, is_active, last_cost, no_identificacion)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'IVA', $9, true, $10, $11)
     RETURNING id, sku, name`,
    [
      companyId,
      sku,
      concepto.descripcion,
      concepto.descripcion,
      concepto.claveProdServ,
      concepto.claveUnidad,
      unitName,
      concepto.valorUnitario,
      concepto.taxRate || 0.16,
      concepto.valorUnitario,
      concepto.noIdentificacion || null,
    ]
  );
  return { ...insert.rows[0], action: 'created' };
}

/**
 * Registra en customer_products que un cliente compró un producto (XMLs emitidos).
 */
async function bumpCustomerProduct(
  client: any,
  companyId: string,
  customerId: string,
  productId: string,
  concepto: ConceptoCFDI,
  fecha?: string,
  uuid?: string,
  folio?: string
) {
  const fechaDate = fecha ? new Date(fecha) : new Date();
  await transactionQuery(
    client,
    `INSERT INTO customer_products
       (company_id, customer_id, product_id,
        first_purchase_date, last_purchase_date,
        times_purchased, total_quantity, total_amount,
        last_unit_price, last_invoice_uuid, last_invoice_folio)
     VALUES ($1,$2,$3,$4,$4,1,$5,$6,$7,$8,$9)
     ON CONFLICT (customer_id, product_id) DO UPDATE SET
       last_purchase_date = EXCLUDED.last_purchase_date,
       times_purchased    = customer_products.times_purchased + 1,
       total_quantity     = customer_products.total_quantity + EXCLUDED.total_quantity,
       total_amount       = customer_products.total_amount + EXCLUDED.total_amount,
       last_unit_price    = EXCLUDED.last_unit_price,
       last_invoice_uuid  = EXCLUDED.last_invoice_uuid,
       last_invoice_folio = EXCLUDED.last_invoice_folio,
       updated_at         = NOW()`,
    [
      companyId, customerId, productId,
      fechaDate,
      concepto.cantidad,
      concepto.importe,
      concepto.valorUnitario,
      uuid || null,
      folio || null,
    ]
  );
}

// ──────────────────────── Orquestador ────────────────────────

export async function importXMLs(
  companyId: string,
  files: Array<{ name: string; buffer: Buffer }>
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    total_files: files.length,
    files_ok: 0,
    files_failed: 0,
    invoices_emitted: 0,
    invoices_received: 0,
    products_created: 0,
    products_updated: 0,
    customer_links_updated: 0,
    errors: [],
    items_detail: [],
  };

  // RFC de la empresa actual (para clasificar EMITIDO vs RECIBIDO)
  const cr = await query<{ rfc: string }>(
    `SELECT rfc FROM companies WHERE id = $1`,
    [companyId]
  );
  const rfcCompany = (cr.rows[0]?.rfc || '').toUpperCase();

  for (const f of files) {
    try {
      const xml = f.buffer.toString('utf8');
      const parsed = await parseXML(xml);

      const role: 'EMITIDO' | 'RECIBIDO' | 'OTRO' =
        parsed.rfcEmisor === rfcCompany ? 'EMITIDO'
        : parsed.rfcReceptor === rfcCompany ? 'RECIBIDO'
        : 'OTRO';

      if (role === 'EMITIDO') summary.invoices_emitted++;
      else summary.invoices_received++;

      const fileDetail: ImportSummary['items_detail'][number] = {
        file: f.name,
        folio: parsed.folio,
        rfcEmisor: parsed.rfcEmisor,
        rfcReceptor: parsed.rfcReceptor,
        role,
        products: [],
      };

      // Cliente para la relación de "memoria" (solo si XML EMITIDO)
      let customerId: string | null = null;
      if (role === 'EMITIDO' && parsed.rfcReceptor) {
        const cust = await query<{ id: string }>(
          `SELECT id FROM customers WHERE company_id = $1 AND rfc = $2 AND deleted_at IS NULL LIMIT 1`,
          [companyId, parsed.rfcReceptor]
        );
        customerId = cust.rows[0]?.id || null;
      }

      await transaction(async (client) => {
        for (const c of parsed.conceptos) {
          const r = await upsertProductFromConcepto(client, companyId, c);
          if (r.action === 'created') summary.products_created++;
          else if (r.action === 'updated') summary.products_updated++;
          if (r.action !== 'skipped' && customerId) {
            await bumpCustomerProduct(
              client, companyId, customerId, r.id, c,
              parsed.fecha, parsed.uuid, parsed.folio
            );
            summary.customer_links_updated++;
          }
          fileDetail.products.push({ sku: r.sku, name: r.name, action: r.action });
        }
      });

      summary.files_ok++;
      summary.items_detail.push(fileDetail);
    } catch (e: any) {
      summary.files_failed++;
      summary.errors.push({ file: f.name, error: e?.message || String(e) });
      logger.warn(`XML import failed: ${f.name}`, { error: e?.message });
    }
  }

  return summary;
}
