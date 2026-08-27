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
import { validarRfcSat } from '../../utils/validators';
import { aplicarRecepcionDesdeXml } from '../purchasing/recepcion-por-xml.service';
import { indexarCfdi } from '../sat-descarga/descarga.service';
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
    if (!rfc) return { exists: false } as {
      exists: boolean; id?: string; kind?: 'CUSTOMER'|'SUPPLIER'; creditDays?: number;
    };
    const r = await query<{ id: string; party_type: 'CUSTOMER'|'SUPPLIER'; credit_days: number|null }>(
      `SELECT id, party_type, es_cliente, es_proveedor, credit_days FROM customers
        WHERE company_id = $1 AND UPPER(rfc) = UPPER($2) AND deleted_at IS NULL LIMIT 1`,
      [companyId, rfc]
    );
    return r.rows[0]
      ? {
          exists: true, id: r.rows[0].id, kind: r.rows[0].party_type,
          creditDays: r.rows[0].credit_days ?? 0,
        }
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

  const emisorRfc   = validarRfcSat(parsed.emisor.rfc);
  const receptorRfc = validarRfcSat(parsed.receptor.rfc);

  const emisor: PreviewedParty = {
    rfc: parsed.emisor.rfc,
    nombre: parsed.emisor.nombre,
    regimen_fiscal: parsed.emisor.regimen,
    postal_code: parsed.emisor.postalCode,
    exists_in_catalog: emisorMatch.exists,
    existing_customer_id: emisorMatch.id,
    existing_party_type: emisorMatch.kind,
    is_self: emisorIsSelf,
    rfc_valido: emisorRfc.valido,
    rfc_tipo:   emisorRfc.tipo,
    rfc_motivo: emisorRfc.motivo,
    credit_days: emisorMatch.creditDays,
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
    rfc_valido: receptorRfc.valido,
    rfc_tipo:   receptorRfc.tipo,
    rfc_motivo: receptorRfc.motivo,
    credit_days: receptorMatch.creditDays,
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

  const commitResult: CommitResult = await transaction(async (client) => {
    // 1) Party (cliente o proveedor)
    let partyResult: CommitResult['party'] | undefined;
    if (req.selection.party === 'emisor' || req.selection.party === 'receptor') {
      const party = req.selection.party === 'emisor' ? parsed.emisor : parsed.receptor;
      if (!party.rfc) {
        throw new ValidationError(`El XML no tiene RFC del ${req.selection.party}`);
      }

      // Validación del RFC. Se hace también aquí y no solo en el preview:
      // el preview es informativo y el cliente podría no haberlo consultado.
      // Un RFC mal formado da de alta un proveedor fantasma al que después se
      // le programa un pago — barato de impedir, caro de limpiar.
      const chk = validarRfcSat(party.rfc);
      if (!chk.valido) {
        throw new ValidationError(
          `El RFC del ${req.selection.party} ("${party.rfc}") no es válido: ${chk.motivo}. ` +
          'Revisa el XML con tu proveedor antes de darlo de alta.'
        );
      }
      // Los genéricos identifican "público en general" o "residente en el
      // extranjero": no son un contribuyente concreto, así que no pueden ser
      // un proveedor con cuenta por pagar y línea de crédito.
      if (kind === 'SUPPLIER' && chk.tipo?.startsWith('GENERICO')) {
        throw new ValidationError(
          `${chk.rfc} es un RFC genérico del SAT, no identifica a un proveedor. ` +
          'No se puede registrar una compra a su nombre.'
        );
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
        `SELECT id, rfc, business_name, party_type, es_cliente, es_proveedor, deleted_at FROM customers
          WHERE company_id = $1 AND UPPER(rfc) = UPPER($2) LIMIT 1`,
        [companyId, party.rfc]
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        const columnaRol = kind === 'SUPPLIER' ? 'es_proveedor' : 'es_cliente';
        const yaTieneRol = kind === 'SUPPLIER' ? row.es_proveedor : row.es_cliente;

        if (row.deleted_at) {
          const upd = await transactionQuery<any>(client,
            `UPDATE customers SET deleted_at = NULL, business_name = $1,
                                    ${columnaRol} = TRUE, updated_at = NOW()
              WHERE id = $2 RETURNING id, rfc, business_name, party_type`,
            [(party.nombre || row.business_name).toUpperCase(), row.id]
          );
          partyResult = { ...upd.rows[0], kind, already_existed: true };
        } else if (!yaTieneRol) {
          /* ── Ya existe, pero con otro rol: SE LE AGREGA ──
           *
           * Antes esto reventaba con "el RFC ya está registrado como
           * SUPPLIER", y no había salida: el RFC es único por empresa, así
           * que tampoco se podía crear otro registro.
           *
           * Pero un tercero SÍ puede ser las dos cosas. Un banco donde tengo
           * dinero y que además me financia; un cliente que un día me vende
           * algo. Cerrarle la puerta obligaba a inventar un RFC falso o a
           * dejar el CFDI sin importar.
           *
           * Se AGREGA el rol, no se sustituye: quitarle el de proveedor para
           * ponerle el de cliente lo sacaría de las órdenes de compra que ya
           * tiene. */
          const upd = await transactionQuery<any>(client,
            `UPDATE customers SET ${columnaRol} = TRUE, updated_at = NOW()
              WHERE id = $1 RETURNING id, rfc, business_name, party_type`,
            [row.id]
          );
          partyResult = {
            ...upd.rows[0], kind, already_existed: true, rol_agregado: true,
          };
        } else {
          partyResult = {
            id: row.id, rfc: row.rfc, business_name: row.business_name,
            kind, already_existed: true,
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
             (company_id, rfc, business_name, fiscal_regime, postal_code,
              es_cliente, es_proveedor, is_active)
           VALUES ($1, UPPER($2), $3, $4, $5, $6, $7, true)
           RETURNING id, rfc, business_name, fiscal_regime, postal_code, party_type`,
          [companyId, party.rfc, cleanName, fiscalRegime, postalCode,
           kind === 'CUSTOMER', kind === 'SUPPLIER']
        );
        partyResult = { ...ins.rows[0], kind, already_existed: false };
      }
    }

    // 2) Products — solo los que el usuario marcó
    const productsCreated: CommitResult['products'] = [];
    // Partidas que no se pudieron dar de alta, con su motivo. NO se tragan:
    // el operador tiene que enterarse en la misma pantalla, no un mes después
    // al cuadrar el kardex.
    const productsFailed: CommitResult['products_failed'] = [];
    // FASE 2: mapa concepto→producto para generar las entradas de inventario
    // `cantidad` es lo que ENTRA al kardex (lo contado); `cantidadFacturada`
    // es lo que dice el XML. Se guardan las dos para poder avisar del faltante.
    // `index` es el renglón del XML del que salió: se necesita para saber a qué
    // almacén va esa partida, que se elige por renglón.
    const conceptProducts: Array<{
      index: number;
      productId: string; cantidad: number; cantidadFacturada: number; valorUnitario: number;
    }> = [];
    // Lo que el almacenista contó, por índice de concepto.
    const recibidas = req.receivedQuantities || {};
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
        conceptProducts.push({
          index: idx,
          productId: existing.rows[0].id,
          cantidad: recibidas[idx] != null ? Number(recibidas[idx]) : c.cantidad,
          cantidadFacturada: c.cantidad,
          valorUnitario: c.valorUnitario,
        });
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
        conceptProducts.push({
          index: idx,
          productId: created.id,
          cantidad: recibidas[idx] != null ? Number(recibidas[idx]) : c.cantidad,
          cantidadFacturada: c.cantidad,
          valorUnitario: c.valorUnitario,
        });
      } catch (e) {
        const motivo = (e as Error).message;
        logger.warn(`[cfdi-import] concepto[${idx}] no se pudo dar de alta — ${motivo}`);
        productsFailed.push({ index: idx, descripcion: c.descripcion, motivo });
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
      products_failed: productsFailed,
    };

    /* ══════════════════════════════════════════════════════════════════════
     * 4) Es una COMPRA (la party es proveedor). De aquí salen dos cosas
     *    INDEPENDIENTES entre sí:
     *
     *      a) La entrada al almacén — solo si se pidió afectar existencias y
     *         hubo partidas con producto resuelto.
     *      b) La cuenta por pagar en tesorería — SIEMPRE que la factura tenga
     *         importe. Se le debe al proveedor aunque la compra sea de puros
     *         servicios, aunque el operador haya apagado "afectar existencias",
     *         y aunque ninguna partida haya podido darse de alta como producto.
     *
     *    Antes (b) vivía dentro de (a) y por lo tanto no se generaba en
     *    ninguno de esos tres casos, mientras la pantalla prometía registrar
     *    la cuenta por pagar. Una deuda que el sistema no anota es una deuda
     *    que se paga tarde o se paga dos veces.
     * ══════════════════════════════════════════════════════════════════════ */
    const isPurchase = partyResult?.kind === 'SUPPLIER';
    const importId = importIns.rows[0].id;
    const docRef = [parsed.serie, parsed.folio].filter(Boolean).join('-') || parsed.cfdiUUID || 'XML';

    // ── a) Entrada de inventario ──────────────────────────────────────────
    if (isPurchase && req.receiveInventory !== false && conceptProducts.length > 0 && partyResult) {
      // Guard anti-doble-entrada: el ON CONFLICT de xml_imports permite
      // re-commitear el mismo archivo — el stock NO debe duplicarse.
      const alreadyReceived = await transactionQuery(client,
        `SELECT 1 FROM inventory_movements
          WHERE reference_type = 'xml_import' AND reference_id = $1 LIMIT 1`,
        [importId]
      );
      if (alreadyReceived.rows.length === 0) {
        // Almacén de respaldo: el indicado para todo el documento o el default
        // de la empresa. Es el que reciben las partidas que no eligieron uno.
        let warehouseBase = req.warehouseId;
        if (!warehouseBase) {
          warehouseBase = await getOrCreateDefaultWarehouse(client, companyId);
        }

        /* Los almacenes que se van a usar, validados de una sola vez ANTES de
         * mover nada.
         *
         * Se comprueba que cada uno exista y sea DE ESTA EMPRESA: los ids
         * llegan del navegador, y sin esta verificación un id de otra compañía
         * metería mercancía en su bodega. Va antes del primer applyMovementTx
         * a propósito — dentro del bucle, la mitad de las partidas ya se
         * habrían movido cuando saltara el error, y aunque la transacción lo
         * revierta, el mensaje saldría después de un trabajo que no servía. */
        const porConcepto = req.warehouseByConcept || {};
        const idsUsados = Array.from(new Set<string>([
          warehouseBase,
          ...conceptProducts
            .map(cp => porConcepto[cp.index])
            .filter((w): w is string => Boolean(w)),
        ]));
        const whR = await transactionQuery<{ id: string; code: string }>(client,
          `SELECT id, code FROM warehouses
            WHERE company_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
          [companyId, idsUsados]
        );
        const codigoDe = new Map(whR.rows.map(w => [w.id, w.code]));
        const desconocido = idsUsados.find(id => !codigoDe.has(id));
        if (desconocido) {
          throw new ValidationError(
            `El almacén ${desconocido} no existe o no es de esta empresa. ` +
            'No se recibió nada: corrige el destino de esa partida y vuelve a guardar.'
          );
        }

        /* Cuánto entró en cada bodega. Se acumula por almacén en lugar de
         * llevar un solo total porque, repartida la compra, "entraron 40
         * unidades" no le dice a nadie dónde buscarlas. */
        const acumulado = new Map<string, { movements: number; totalUnits: number }>();
        let totalUnits = 0;
        for (const cp of conceptProducts) {
          const destino = porConcepto[cp.index] || warehouseBase;
          // Un renglón facturado pero NO recibido no genera movimiento: meter
          // un PURCHASE_IN de cero ensucia el kardex sin aportar nada.
          if (cp.cantidad <= 0) continue;

          const faltante = cp.cantidadFacturada - cp.cantidad;
          const nota = faltante > 0
            ? ` · recibido ${cp.cantidad} de ${cp.cantidadFacturada} facturados`
            : faltante < 0
              ? ` · recibido ${cp.cantidad}, facturados ${cp.cantidadFacturada}`
              : '';

          await applyMovementTx(client, {
            companyId,
            productId: cp.productId,
            movementType: 'PURCHASE_IN',
            quantity: cp.cantidad,
            unitCost: cp.valorUnitario,
            warehouseToId: destino,
            referenceType: 'xml_import',
            referenceId: importId,
            // La diferencia queda escrita en el kardex: dentro de un mes nadie
            // va a recordar por qué entraron 8 si la factura decía 10.
            reason: `Compra XML ${docRef} · ${partyResult.business_name}${nota}`,
            userId,
            userEmail,
            costingMethod: req.costingMethod,
          });
          totalUnits += cp.cantidad;
          const acc = acumulado.get(destino) || { movements: 0, totalUnits: 0 };
          acc.movements += 1;
          acc.totalUnits += cp.cantidad;
          acumulado.set(destino, acc);

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

        /* La mercancía entró: si había una orden de compra esperándola, se
         * abona y se mueve su estado. Va DENTRO de la transacción para que, si
         * la importación se revierte, la orden no quede marcada como recibida
         * por mercancía que nunca entró. */
        result.ordenesRecibidas = await aplicarRecepcionDesdeXml(client, {
          companyId,
          supplierId: partyResult.id,
          warehouseId: warehouseBase,
          recibido: conceptProducts
            .filter(cp => cp.cantidad > 0)
            .map(cp => ({ productId: cp.productId, cantidad: cp.cantidad })),
          userEmail,
        });

        const porAlmacen = Array.from(acumulado.entries())
          .map(([id, a]) => ({
            warehouseId: id,
            warehouseCode: codigoDe.get(id) || '',
            movements: a.movements,
            totalUnits: a.totalUnits,
          }))
          .sort((a, b) => b.totalUnits - a.totalUnits);

        /* El almacén "principal" es el que más recibió, no el que se eligió
         * como respaldo: si toda la mercancía se desvió renglón por renglón, el
         * resumen nombraría una bodega en la que no entró nada. Si ninguna
         * partida se movió —todas venían en cero— se cae al de respaldo, que
         * ya está validado. */
        const principal = porAlmacen[0];
        result.inventory = {
          warehouseId: principal?.warehouseId || warehouseBase,
          warehouseCode: principal?.warehouseCode || codigoDe.get(warehouseBase) || '',
          movements: porAlmacen.reduce((s, w) => s + w.movements, 0),
          totalUnits,
          porAlmacen,
        };
      } else {
        logger.warn(`[cfdi-import] Import ${importId} ya tenía entradas de inventario — skip (anti-duplicado)`);
      }
    }

    // ── b) Cuenta por pagar en tesorería ──────────────────────────────────
    // Vencimiento = fecha de emisión de la factura + los días de crédito
    // pactados con ESE proveedor (customers.credit_days). Si no tiene crédito
    // pactado son 0 días: vence el mismo día, que es lo correcto para contado.
    //
    // El importe es el TOTAL de la factura, con impuestos: es lo que se le va
    // a transferir. No se descuenta el faltante de mercancía — eso se aclara
    // con nota de crédito, y restarlo aquí escondería el problema.
    if (isPurchase && partyResult && parsed.total && parsed.total > 0) {
      // Anti-duplicado propio: re-commitear el mismo XML no debe generar dos
      // cuentas por pagar. Espeja al guard del inventario, no depende de él.
      const yaProgramado = await transactionQuery<any>(client,
        `SELECT id, amount, due_date FROM supplier_payments_schedule
          WHERE xml_import_id = $1 AND status <> 'CANCELLED' LIMIT 1`,
        [importId]
      );

      if (yaProgramado.rows[0]) {
        logger.warn(`[cfdi-import] Import ${importId} ya tenía cuenta por pagar — skip (anti-duplicado)`);
        result.payment = {
          scheduleId: yaProgramado.rows[0].id,
          amount: Number(yaProgramado.rows[0].amount),
          dueDate: yaProgramado.rows[0].due_date,
          alreadyExisted: true,
        };
      } else {
        const payR = await transactionQuery<any>(client,
          `INSERT INTO supplier_payments_schedule
             (company_id, supplier_id, xml_import_id, amount, due_date, notes)
           SELECT $1, $2, $3, $4,
                  (COALESCE($5::timestamp, NOW()) + make_interval(days => COALESCE(c.credit_days, 0)))::date,
                  $6
             FROM customers c WHERE c.id = $2
           RETURNING id, amount, due_date,
                     (SELECT COALESCE(credit_days, 0) FROM customers WHERE id = $2) AS credit_days`,
          [companyId, partyResult.id, importId, parsed.total,
           parsed.fechaEmision || null, `Compra XML ${docRef}`]
        );
        if (payR.rows[0]) {
          // Consume línea de crédito del proveedor.
          await transactionQuery(client,
            `UPDATE customers SET credit_used = COALESCE(credit_used, 0) + $1 WHERE id = $2`,
            [parsed.total, partyResult.id]
          );
          result.payment = {
            scheduleId: payR.rows[0].id,
            amount: Number(payR.rows[0].amount),
            dueDate: payR.rows[0].due_date,
            creditDays: Number(payR.rows[0].credit_days || 0),
            alreadyExisted: false,
          };
        }
      }
    }

    // Prefill solo aplica para CLIENTES — a proveedores no les facturamos.
    if (req.prefillInvoice && partyResult?.id && partyResult.kind === 'CUSTOMER') {
      result.next = { redirectTo: `/invoices/new?customerId=${partyResult.id}` };
    }
    return result;
  });

  /* Si fue una COMPRA, se indexa el mismo XML en cfdi_recibidos para que la
   * CONTABILIDAD lo vea: la póliza de compra lee de ahí, no del import de almacén.
   * Sin esto, una factura recibida por el asistente de almacén nunca llegaba a la
   * póliza de compra. No debe tumbar el import si algo falla —el asiento es un
   * paso posterior—. Idempotente por UUID (indexarCfdi rellena/omite). */
  if (commitResult.party?.kind === 'SUPPLIER') {
    try {
      const self = await query<{ rfc: string }>(`SELECT UPPER(rfc) AS rfc FROM companies WHERE id = $1`, [companyId]);
      const ownRfc = self.rows[0]?.rfc || '';
      if (ownRfc) await indexarCfdi(companyId, ownRfc, 'recibidos', xmlBuf.toString('utf8'));
    } catch (e: any) {
      logger.warn(`[cfdi-import] compra importada pero no se pudo indexar a cfdi_recibidos: ${e?.message}`);
    }
  }
  return commitResult;
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
