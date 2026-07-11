/**
 * cfdi-import.service.ts — orquesta parser + detección de duplicados +
 * creación selectiva (cliente y/o productos).
 *
 *  · Single Responsibility: este servicio NO parsea XML directo (lo delega
 *    a cfdi-parser.service), NI valida SAT a fondo — solo coordina.
 *  · No tiene HTTP — recibe Buffers/strings ya validados por el controller.
 *  · Transaccional: el commit crea customer+products en una sola transacción
 *    para que si falla la mitad, no quede catálogo inconsistente.
 */

import * as crypto from 'crypto';
import * as xml2js from 'xml2js';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import * as productsService from '../products/products.service';
import { applyMovementTx, getOrCreateDefaultWarehouse } from '../inventory/inventory.service';
import {
  PreviewResult,
  PreviewedParty,
  PreviewedConcept,
  CommitRequest,
  CommitResult,
} from './cfdi-import.types';

const XML_MAX_BYTES = 1_048_576; // 1 MB

/** Calcula SHA-256 hex del buffer — usado para dedup. */
function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Acceso seguro a atributos de xml2js (puede ser objeto o array). */
function attr(node: any, key: string): string | undefined {
  if (!node || !node.$) return undefined;
  const v = node.$[key];
  return typeof v === 'string' ? v : undefined;
}

function num(s: string | undefined): number | undefined {
  if (s === undefined || s === null || s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function normalize(s: string | undefined): string {
  return (s || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/* ─────────────────────  PARSE  ───────────────────── */

interface ParsedMinimum {
  cfdiUUID: string | null;
  fechaEmision?: string;
  folio?: string;
  serie?: string;
  total?: number;
  /** LugarExpedicion del comprobante — CP fiscal del emisor (CFDI 4.0). */
  lugarExpedicion?: string;
  emisor:   { rfc: string; nombre?: string; regimen?: string; postalCode?: string };
  receptor: { rfc: string; nombre?: string; regimen?: string; postalCode?: string; usoCfdi?: string };
  conceptos: Array<{
    claveSat: string;
    claveUnidad: string;
    descripcion: string;
    cantidad: number;
    valorUnitario: number;
    importe: number;
  }>;
}

/**
 * Parser tolerante: extrae lo mínimo necesario para el preview, sin validar
 * estrictamente vs catálogo SAT (esa es responsabilidad de cfdi-parser.service
 * cuando se quiere importar como factura completa).
 */
async function parseXml(xml: string): Promise<ParsedMinimum> {
  const parser = new xml2js.Parser({
    explicitArray: false,
    tagNameProcessors: [xml2js.processors.stripPrefix],
    attrkey: '$',
  });
  let parsed: any;
  try {
    parsed = await parser.parseStringPromise(xml);
  } catch (e) {
    throw new ValidationError('XML mal formado: ' + (e as Error).message);
  }

  const comp = parsed?.Comprobante;
  if (!comp || !comp.$) throw new ValidationError('No es un CFDI válido (falta cfdi:Comprobante)');

  // Conceptos puede ser objeto o array
  const conceptosNode = comp.Conceptos?.Concepto;
  const conceptosArr = Array.isArray(conceptosNode) ? conceptosNode : (conceptosNode ? [conceptosNode] : []);

  const tfd = comp.Complemento?.TimbreFiscalDigital;
  const uuid = attr(tfd, 'UUID') || null;

  const lugarExp = attr(comp, 'LugarExpedicion');
  return {
    cfdiUUID: uuid,
    fechaEmision: attr(comp, 'Fecha'),
    folio: attr(comp, 'Folio'),
    serie: attr(comp, 'Serie'),
    total: num(attr(comp, 'Total')),
    lugarExpedicion: lugarExp,
    emisor: {
      rfc: attr(comp.Emisor, 'Rfc') || '',
      nombre: attr(comp.Emisor, 'Nombre'),
      regimen: attr(comp.Emisor, 'RegimenFiscal'),
      postalCode: lugarExp,
    },
    receptor: {
      rfc: attr(comp.Receptor, 'Rfc') || '',
      nombre: attr(comp.Receptor, 'Nombre'),
      regimen: attr(comp.Receptor, 'RegimenFiscalReceptor'),
      postalCode: attr(comp.Receptor, 'DomicilioFiscalReceptor'),
      usoCfdi: attr(comp.Receptor, 'UsoCFDI'),
    },
    conceptos: conceptosArr.map((c: any) => ({
      claveSat:      attr(c, 'ClaveProdServ') || '00000000',
      claveUnidad:   attr(c, 'ClaveUnidad')    || 'H87',
      descripcion:   attr(c, 'Descripcion')    || 'Sin descripción',
      cantidad:      num(attr(c, 'Cantidad'))      || 1,
      valorUnitario: num(attr(c, 'ValorUnitario')) || 0,
      importe:       num(attr(c, 'Importe'))       || 0,
    })),
  };
}

/* ─────────────────────  PREVIEW  ───────────────────── */

export async function preview(
  companyId: string,
  xmlBuffer: Buffer
): Promise<PreviewResult> {
  if (xmlBuffer.length > XML_MAX_BYTES) {
    throw new ValidationError(`XML excede ${XML_MAX_BYTES} bytes`);
  }
  const xmlStr = xmlBuffer.toString('utf8');
  const sha = sha256Hex(xmlBuffer);
  const parsed = await parseXml(xmlStr);

  // Dedup: ¿ya fue importado por esta compañía?
  const dup = await query<any>(
    `SELECT ts, user_email, status FROM xml_imports
      WHERE company_id = $1 AND sha256 = $2
      ORDER BY ts DESC LIMIT 1`,
    [companyId, sha]
  );
  const already = dup.rows[0] || null;

  // Match de emisor / receptor contra catálogo. Distinguimos kind para el preview.
  const partyMatch = async (rfc: string) => {
    if (!rfc) return { exists: false } as { exists: boolean; id?: string; kind?: 'CUSTOMER'|'SUPPLIER' };
    const r = await query<{ id: string; party_type: 'CUSTOMER'|'SUPPLIER' }>(
      `SELECT id, party_type FROM customers
        WHERE company_id = $1 AND UPPER(rfc) = UPPER($2) AND deleted_at IS NULL LIMIT 1`,
      [companyId, rfc]
    );
    return r.rows[0]
      ? { exists: true, id: r.rows[0].id, kind: r.rows[0].party_type }
      : { exists: false };
  };
  const emisorMatch   = await partyMatch(parsed.emisor.rfc);
  const receptorMatch = await partyMatch(parsed.receptor.rfc);

  // Auto-detección: ¿alguna parte es la propia compañía? — usamos companies.rfc del JWT.
  const selfR = await query<{ rfc: string }>(
    'SELECT UPPER(rfc) AS rfc FROM companies WHERE id = $1', [companyId]
  );
  const ownRfc = selfR.rows[0]?.rfc || '';
  const emisorIsSelf   = ownRfc !== '' && (parsed.emisor.rfc   || '').toUpperCase() === ownRfc;
  const receptorIsSelf = ownRfc !== '' && (parsed.receptor.rfc || '').toUpperCase() === ownRfc;

  let suggestion: { party: 'emisor'|'receptor'|'none'; kind: 'CUSTOMER'|'SUPPLIER'; reason: string };
  if (emisorIsSelf && !receptorIsSelf) {
    suggestion = { party: 'receptor', kind: 'CUSTOMER',
      reason: 'El emisor es tu empresa → el receptor es tu cliente.' };
  } else if (receptorIsSelf && !emisorIsSelf) {
    suggestion = { party: 'emisor', kind: 'SUPPLIER',
      reason: 'El receptor es tu empresa → el emisor es tu proveedor.' };
  } else if (emisorIsSelf && receptorIsSelf) {
    suggestion = { party: 'none', kind: 'CUSTOMER',
      reason: 'Ambos RFC coinciden con tu empresa — no se sugiere creación.' };
  } else {
    suggestion = { party: 'none', kind: 'CUSTOMER',
      reason: 'Ninguno de los RFCs coincide con tu empresa. Decide manualmente.' };
  }

  // Match de cada concepto vs products del catálogo (clave_sat + nombre normalizado)
  const conceptos: PreviewedConcept[] = [];
  for (let i = 0; i < parsed.conceptos.length; i++) {
    const c = parsed.conceptos[i];
    const r = await query<{ id: string }>(
      `SELECT id FROM products
        WHERE company_id = $1 AND clave_sat = $2 AND UPPER(name) = $3 AND deleted_at IS NULL LIMIT 1`,
      [companyId, c.claveSat, normalize(c.descripcion)]
    );
    const hit = r.rows[0];
    conceptos.push({
      index: i,
      clave_sat:     c.claveSat,
      clave_unidad:  c.claveUnidad,
      descripcion:   c.descripcion,
      cantidad:      c.cantidad,
      valor_unitario: c.valorUnitario,
      importe:       c.importe,
      exists_in_catalog: !!hit,
      existing_product_id: hit?.id,
    });
  }

  const emisor: PreviewedParty = {
    rfc: parsed.emisor.rfc,
    nombre: parsed.emisor.nombre,
    regimen_fiscal: parsed.emisor.regimen,
    postal_code: parsed.emisor.postalCode,
    exists_in_catalog: emisorMatch.exists,
    existing_customer_id: emisorMatch.id,
    existing_party_type: emisorMatch.kind,
    is_self: emisorIsSelf,
  };
  const receptor: PreviewedParty = {
    rfc: parsed.receptor.rfc,
    nombre: parsed.receptor.nombre,
    regimen_fiscal: parsed.receptor.regimen,
    postal_code: parsed.receptor.postalCode,
    uso_cfdi: parsed.receptor.usoCfdi,
    exists_in_catalog: receptorMatch.exists,
    existing_customer_id: receptorMatch.id,
    existing_party_type: receptorMatch.kind,
    is_self: receptorIsSelf,
  };

  return {
    sha256: sha,
    cfdi_uuid: parsed.cfdiUUID,
    fecha_emision: parsed.fechaEmision,
    folio: parsed.folio,
    serie: parsed.serie,
    total: parsed.total,
    emisor, receptor, conceptos,
    already_imported: already
      ? { yes: true, ts: already.ts, by_user: already.user_email, status: already.status }
      : { yes: false },
    suggestion,
  };
}

/* ─────────────────────  COMMIT  ───────────────────── */

export async function commit(
  companyId: string,
  userId: string,
  userEmail: string,
  req: CommitRequest
): Promise<CommitResult> {
  const xmlBuf = Buffer.from(req.xmlBase64, 'base64');
  if (xmlBuf.length > XML_MAX_BYTES) throw new ValidationError('XML excede 1MB');

  const sha = sha256Hex(xmlBuf);
  if (sha !== req.sha256) {
    throw new ValidationError('El XML cambió desde el preview (sha256 no coincide)');
  }
  const parsed = await parseXml(xmlBuf.toString('utf8'));

  // Validamos el contrato del request — un fail-fast antes de tocar BD.
  const kind: 'CUSTOMER' | 'SUPPLIER' =
    req.selection.partyKind === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER';

  return transaction(async (client) => {
    // 1) Party (cliente o proveedor)
    let partyResult: CommitResult['party'] | undefined;
    if (req.selection.party === 'emisor' || req.selection.party === 'receptor') {
      const party = req.selection.party === 'emisor' ? parsed.emisor : parsed.receptor;
      if (!party.rfc) {
        throw new ValidationError(`El XML no tiene RFC del ${req.selection.party}`);
      }

      // Guard: si la party es "mi empresa" (mismo RFC que companies.rfc),
      // NO la creamos como cliente/proveedor — sería incoherente facturarse a sí mismo.
      const selfR = await transactionQuery<{ rfc: string }>(client,
        'SELECT UPPER(rfc) AS rfc FROM companies WHERE id = $1', [companyId]
      );
      const ownRfc = selfR.rows[0]?.rfc || '';
      if (ownRfc && party.rfc.toUpperCase() === ownRfc) {
        throw new ValidationError(
          'El RFC seleccionado coincide con el de tu empresa. ' +
          'No se puede crear como cliente ni proveedor.'
        );
      }

      // Dedup ignorando deleted_at — el UNIQUE INDEX no lo filtra.
      const existing = await transactionQuery<any>(client,
        `SELECT id, rfc, business_name, party_type, deleted_at FROM customers
          WHERE company_id = $1 AND UPPER(rfc) = UPPER($2) LIMIT 1`,
        [companyId, party.rfc]
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        // Si ya existe pero con OTRO party_type, lo reportamos sin sobrescribir.
        if (!row.deleted_at && row.party_type !== kind) {
          throw new ValidationError(
            `El RFC ${row.rfc} ya está registrado como ${row.party_type}. ` +
            `Si quieres cambiarlo a ${kind}, hazlo manualmente desde el catálogo.`
          );
        }
        if (row.deleted_at) {
          const upd = await transactionQuery<any>(client,
            `UPDATE customers SET deleted_at = NULL, business_name = $1,
                                    party_type = $2, updated_at = NOW()
              WHERE id = $3 RETURNING id, rfc, business_name, party_type`,
            [(party.nombre || row.business_name).toUpperCase(), kind, row.id]
          );
          partyResult = { ...upd.rows[0], kind, already_existed: true };
        } else {
          partyResult = {
            id: row.id, rfc: row.rfc, business_name: row.business_name,
            kind: row.party_type, already_existed: true,
          };
        }
      } else {
        // Toma régimen y CP REALES del XML según la party seleccionada.
        const partyData = req.selection.party === 'emisor' ? parsed.emisor : parsed.receptor;
        const fiscalRegime = partyData.regimen || '616';
        const postalCode   = (partyData.postalCode || '00000').replace(/\D/g, '').padStart(5, '0').slice(0, 5);
        // El nombre se limpia: SAT a veces lo envía con "(REGIMEN)" o sufijos. Lo dejamos en mayúsculas pero sin RFC.
        const cleanName    = (partyData.nombre || party.rfc).toUpperCase().replace(/\s+/g, ' ').trim();
        const ins = await transactionQuery<any>(client,
          `INSERT INTO customers
             (company_id, rfc, business_name, fiscal_regime, postal_code, party_type, is_active)
           VALUES ($1, UPPER($2), $3, $4, $5, $6, true)
           RETURNING id, rfc, business_name, fiscal_regime, postal_code, party_type`,
          [companyId, party.rfc, cleanName, fiscalRegime, postalCode, kind]
        );
        partyResult = { ...ins.rows[0], kind, already_existed: false };
      }
    }

    // 2) Products — solo los que el usuario marcó
    const productsCreated: CommitResult['products'] = [];
    // FASE 2: mapa concepto→producto para generar las entradas de inventario
    const conceptProducts: Array<{ productId: string; cantidad: number; valorUnitario: number }> = [];
    const presetId = req.productTaxPresetId || 'iva16';
    for (const idx of req.selection.concept_indexes) {
      const c = parsed.conceptos[idx];
      if (!c) continue;
      // ¿Ya existe?
      const existing = await transactionQuery<any>(client,
        `SELECT id, sku, name FROM products
          WHERE company_id = $1 AND clave_sat = $2 AND UPPER(name) = $3 AND deleted_at IS NULL LIMIT 1`,
        [companyId, c.claveSat, normalize(c.descripcion)]
      );
      if (existing.rows.length > 0) {
        productsCreated.push({ ...existing.rows[0], already_existed: true });
        conceptProducts.push({ productId: existing.rows[0].id, cantidad: c.cantidad, valorUnitario: c.valorUnitario });
        continue;
      }
      // Crear producto — delegamos al service para que respete validaciones SAT
      try {
        const created = await productsService.createProduct(companyId, {
          name: normalize(c.descripcion),
          claveSat: c.claveSat,
          unitCode: c.claveUnidad,
          basePrice: c.valorUnitario,
          taxType: 'IVA',
          taxRate: 0.16,
          taxPresetId: presetId,
        });
        productsCreated.push({
          id: created.id, sku: created.sku, name: created.name,
          already_existed: false,
        });
        conceptProducts.push({ productId: created.id, cantidad: c.cantidad, valorUnitario: c.valorUnitario });
      } catch (e) {
        logger.warn(`Skip product concept[${idx}] — ${(e as Error).message}`);
      }
    }

    // 3) Registro de import (idempotencia + auditoría)
    const importIns = await transactionQuery<any>(client,
      `INSERT INTO xml_imports
         (company_id, user_id, user_email, sha256, cfdi_uuid,
          emisor_rfc, emisor_nombre, receptor_rfc, receptor_nombre,
          fecha_emision, total, created_customer_id, created_product_ids, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'COMMITTED',$14)
       ON CONFLICT (company_id, sha256)
       DO UPDATE SET status='COMMITTED', notes = EXCLUDED.notes, ts = NOW()
       RETURNING id`,
      [
        companyId, userId, userEmail, sha, parsed.cfdiUUID,
        parsed.emisor.rfc, parsed.emisor.nombre,
        parsed.receptor.rfc, parsed.receptor.nombre,
        parsed.fechaEmision || null, parsed.total || null,
        partyResult?.id || null,
        productsCreated.map((p) => p.id),
        `kind=${partyResult?.kind || 'none'} products=${productsCreated.length}`,
      ]
    );

    const result: CommitResult = {
      importId: importIns.rows[0].id,
      party: partyResult,
      products: productsCreated,
    };

    // 4) FASE 2 (ALMACEN §5): compra recibida → entrada de inventario,
    //    productos del proveedor y pago programado. Solo cuando la party
    //    es SUPPLIER y hay conceptos con producto resuelto.
    const isPurchase = partyResult?.kind === 'SUPPLIER' && req.receiveInventory !== false;
    if (isPurchase && conceptProducts.length > 0 && partyResult) {
      const importId = importIns.rows[0].id;

      // Guard anti-doble-entrada: el ON CONFLICT de xml_imports permite
      // re-commitear el mismo archivo — el stock NO debe duplicarse.
      const alreadyReceived = await transactionQuery(client,
        `SELECT 1 FROM inventory_movements
          WHERE reference_type = 'xml_import' AND reference_id = $1 LIMIT 1`,
        [importId]
      );
      if (alreadyReceived.rows.length === 0) {
        // Almacén destino: el indicado o el default de la empresa
        let warehouseId = req.warehouseId;
        if (!warehouseId) {
          warehouseId = await getOrCreateDefaultWarehouse(client, companyId);
        }

        const docRef = [parsed.serie, parsed.folio].filter(Boolean).join('-') || parsed.cfdiUUID || 'XML';
        let totalUnits = 0;
        for (const cp of conceptProducts) {
          await applyMovementTx(client, {
            companyId,
            productId: cp.productId,
            movementType: 'PURCHASE_IN',
            quantity: cp.cantidad,
            unitCost: cp.valorUnitario,
            warehouseToId: warehouseId,
            referenceType: 'xml_import',
            referenceId: importId,
            reason: `Compra XML ${docRef} · ${partyResult.business_name}`,
            userId,
            userEmail,
            costingMethod: req.costingMethod,
          });
          totalUnits += cp.cantidad;

          // Catálogo proveedor→producto (§4): último precio y contador
          await transactionQuery(client,
            `INSERT INTO supplier_products
               (supplier_id, product_id, last_price, last_purchase_date, purchases_count)
             VALUES ($1, $2, $3, $4, 1)
             ON CONFLICT (supplier_id, product_id)
             DO UPDATE SET last_price = $3, last_purchase_date = $4,
                           purchases_count = supplier_products.purchases_count + 1`,
            [partyResult.id, cp.productId, cp.valorUnitario, parsed.fechaEmision || new Date()]
          );
        }

        const whR = await transactionQuery<{ code: string }>(client,
          `SELECT code FROM warehouses WHERE id = $1`, [warehouseId]
        );
        result.inventory = {
          warehouseId,
          warehouseCode: whR.rows[0]?.code || '',
          movements: conceptProducts.length,
          totalUnits,
        };

        // Pago programado (línea de crédito del proveedor):
        // vencimiento = fecha de emisión + días de crédito (credit_days).
        if (parsed.total && parsed.total > 0) {
          const payR = await transactionQuery<any>(client,
            `INSERT INTO supplier_payments_schedule
               (company_id, supplier_id, xml_import_id, amount, due_date, notes)
             SELECT $1, $2, $3, $4,
                    (COALESCE($5::timestamp, NOW()) + make_interval(days => COALESCE(c.credit_days, 0)))::date,
                    $6
               FROM customers c WHERE c.id = $2
             RETURNING id, amount, due_date`,
            [companyId, partyResult.id, importId, parsed.total,
             parsed.fechaEmision || null, `Compra XML ${docRef}`]
          );
          if (payR.rows[0]) {
            await transactionQuery(client,
              `UPDATE customers SET credit_used = COALESCE(credit_used, 0) + $1 WHERE id = $2`,
              [parsed.total, partyResult.id]
            );
            result.payment = {
              scheduleId: payR.rows[0].id,
              amount: Number(payR.rows[0].amount),
              dueDate: payR.rows[0].due_date,
            };
          }
        }
      } else {
        logger.warn(`[cfdi-import] Import ${importId} ya tenía entradas de inventario — skip (anti-duplicado)`);
      }
    }

    // Prefill solo aplica para CLIENTES — a proveedores no les facturamos.
    if (req.prefillInvoice && partyResult?.id && partyResult.kind === 'CUSTOMER') {
      result.next = { redirectTo: `/invoices/new?customerId=${partyResult.id}` };
    }
    return result;
  });
}

/* ─────────────────────  HISTORY  ───────────────────── */

export async function history(companyId: string, limit = 50): Promise<any[]> {
  const r = await query<any>(
    `SELECT id, ts, user_email, status, cfdi_uuid,
            emisor_rfc, emisor_nombre, receptor_rfc, receptor_nombre,
            fecha_emision, total,
            created_customer_id,
            COALESCE(array_length(created_product_ids, 1), 0) AS products_count
       FROM xml_imports
      WHERE company_id = $1
      ORDER BY ts DESC LIMIT $2`,
    [companyId, limit]
  );
  return r.rows;
}
