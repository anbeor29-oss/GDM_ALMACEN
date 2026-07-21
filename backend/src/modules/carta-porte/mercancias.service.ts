/**
 * mercancias.service — mercancías transportadas del complemento Carta Porte 3.1.
 *
 * SEPARADO de products: `products` es inventario propio; aquí guardamos
 * mercancía de terceros que la empresa transporta. Dos tablas:
 *
 *   · cp_mercancias_catalog     — plantilla reusable (dedup por claveSat +
 *                                  descripcion normalizada + cliente).
 *   · cp_mercancias_movimiento  — bitácora por viaje para inspecciones SAT.
 *
 * Multitenant: todo se filtra por company_id del JWT.
 */

import { pool } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';

export interface MercanciaInput {
  claveSat: string;
  descripcion: string;
  cantidad: number;
  claveUnidad?: string;
  unidadTexto?: string;
  pesoKg?: number;
  valorMercancia?: number;
  moneda?: string;
  // Metadata del viaje (para bitácora)
  invoiceId?: string;
  uuidCfdi?: string;
  idCcp?: string;
  remitenteRfc?: string;
  remitenteNombre?: string;
  destinatarioRfc?: string;
  destinatarioNombre?: string;
  fechaViaje?: string;
}

function normalizeDesc(s: string): string {
  return String(s || '').toUpperCase().trim().replace(/\s+/g, ' ');
}

/**
 * Upsert de plantilla + inserción de movimiento.
 *
 * · Plantilla: se busca por (company, claveSat, descripción normalizada,
 *   cliente_rfc) — el cliente es el remitente si existe, si no el
 *   destinatario. Si ya existe se incrementa `veces_transportada` y
 *   se actualiza `ultima_vez`; si no, se crea.
 * · Movimiento: siempre se inserta (bitácora); dedup por (company +
 *   uuid_cfdi + descripción) para no duplicar si el mismo XML se
 *   procesa dos veces.
 */
export async function saveMercancia(companyId: string, input: MercanciaInput) {
  if (!input.claveSat) throw new ValidationError('claveSat requerida');
  if (!input.descripcion) throw new ValidationError('descripcion requerida');
  if (!(input.cantidad > 0)) throw new ValidationError('cantidad debe ser > 0');

  const clienteRfc = input.remitenteRfc || input.destinatarioRfc || null;
  const clienteNombre = input.remitenteNombre || input.destinatarioNombre || null;
  const pesoUnit = input.pesoKg && input.cantidad ? input.pesoKg / input.cantidad : null;
  const valorUnit = input.valorMercancia && input.cantidad ? input.valorMercancia / input.cantidad : null;
  const descNorm = normalizeDesc(input.descripcion);

  // 1) Upsert plantilla
  const catalogSql = `
    INSERT INTO cp_mercancias_catalog (
      company_id, clave_sat, descripcion, descripcion_norm,
      clave_unidad, unidad_texto, peso_unitario_kg, valor_unitario, moneda,
      cliente_rfc, cliente_nombre
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (company_id, clave_sat, descripcion_norm, cliente_rfc)
    DO UPDATE SET
      veces_transportada = cp_mercancias_catalog.veces_transportada + 1,
      ultima_vez = NOW(),
      updated_at = NOW(),
      peso_unitario_kg = COALESCE(EXCLUDED.peso_unitario_kg, cp_mercancias_catalog.peso_unitario_kg),
      valor_unitario   = COALESCE(EXCLUDED.valor_unitario,   cp_mercancias_catalog.valor_unitario)
    RETURNING id, (xmax = 0) AS was_inserted
  `;
  const catRes = await pool.query(catalogSql, [
    companyId, input.claveSat, input.descripcion, descNorm,
    input.claveUnidad || null, input.unidadTexto || null,
    pesoUnit, valorUnit, input.moneda || 'MXN',
    clienteRfc, clienteNombre,
  ]);
  const catalogId = catRes.rows[0]?.id;
  const wasInserted = catRes.rows[0]?.was_inserted === true;

  // 2) Movimiento — dedup por (company + uuid_cfdi + descripcion_norm) si hay UUID
  let movimientoId: string | null = null;
  let movimientoSkipped = false;
  if (input.uuidCfdi) {
    const dup = await pool.query(
      `SELECT id FROM cp_mercancias_movimiento
        WHERE company_id = $1 AND uuid_cfdi = $2
          AND UPPER(TRIM(REGEXP_REPLACE(descripcion, '\\s+', ' ', 'g'))) = $3
        LIMIT 1`,
      [companyId, input.uuidCfdi, descNorm],
    );
    if (dup.rows[0]) {
      movimientoId = dup.rows[0].id;
      movimientoSkipped = true;
    }
  }
  if (!movimientoSkipped) {
    const movSql = `
      INSERT INTO cp_mercancias_movimiento (
        company_id, invoice_id, catalog_id, uuid_cfdi, id_ccp,
        clave_sat, descripcion, cantidad, clave_unidad, peso_kg,
        valor_mercancia, moneda, remitente_rfc, remitente_nombre,
        destinatario_rfc, destinatario_nombre, fecha_viaje
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING id
    `;
    const mv = await pool.query(movSql, [
      companyId, input.invoiceId || null, catalogId, input.uuidCfdi || null, input.idCcp || null,
      input.claveSat, input.descripcion, input.cantidad, input.claveUnidad || null, input.pesoKg || null,
      input.valorMercancia || null, input.moneda || 'MXN',
      input.remitenteRfc || null, input.remitenteNombre || null,
      input.destinatarioRfc || null, input.destinatarioNombre || null,
      input.fechaViaje || null,
    ]);
    movimientoId = mv.rows[0]?.id;
  }

  return { catalogId, movimientoId, catalogInserted: wasInserted, movimientoSkipped };
}

export async function listCatalog(companyId: string, opts?: { search?: string; clienteRfc?: string; limit?: number }) {
  const limit = Math.min(opts?.limit ?? 100, 500);
  const params: any[] = [companyId];
  let sql = `SELECT id, clave_sat, descripcion, clave_unidad, peso_unitario_kg, valor_unitario, moneda,
                    cliente_rfc, cliente_nombre, veces_transportada, ultima_vez
               FROM cp_mercancias_catalog
              WHERE company_id = $1`;
  if (opts?.search) {
    params.push(`%${opts.search.toUpperCase()}%`);
    sql += ` AND (UPPER(descripcion) LIKE $${params.length} OR clave_sat LIKE $${params.length})`;
  }
  if (opts?.clienteRfc) {
    params.push(opts.clienteRfc.toUpperCase());
    sql += ` AND cliente_rfc = $${params.length}`;
  }
  sql += ` ORDER BY veces_transportada DESC, ultima_vez DESC LIMIT ${limit}`;
  const r = await pool.query(sql, params);
  return r.rows;
}

export async function listBitacora(companyId: string, opts?: { invoiceId?: string; from?: string; to?: string; limit?: number }) {
  const limit = Math.min(opts?.limit ?? 200, 1000);
  const params: any[] = [companyId];
  let sql = `SELECT m.id, m.invoice_id, m.uuid_cfdi, m.id_ccp, m.clave_sat, m.descripcion,
                    m.cantidad, m.clave_unidad, m.peso_kg, m.valor_mercancia, m.moneda,
                    m.remitente_rfc, m.remitente_nombre, m.destinatario_rfc, m.destinatario_nombre,
                    m.fecha_viaje, m.created_at
               FROM cp_mercancias_movimiento m
              WHERE m.company_id = $1`;
  if (opts?.invoiceId) {
    params.push(opts.invoiceId);
    sql += ` AND m.invoice_id = $${params.length}`;
  }
  if (opts?.from) {
    params.push(opts.from);
    sql += ` AND m.fecha_viaje >= $${params.length}`;
  }
  if (opts?.to) {
    params.push(opts.to);
    sql += ` AND m.fecha_viaje <= $${params.length}`;
  }
  sql += ` ORDER BY m.fecha_viaje DESC NULLS LAST, m.created_at DESC LIMIT ${limit}`;
  const r = await pool.query(sql, params);
  return r.rows;
}

export async function removeCatalog(companyId: string, id: string) {
  const r = await pool.query(
    `DELETE FROM cp_mercancias_catalog WHERE id = $1 AND company_id = $2 RETURNING id`,
    [id, companyId],
  );
  if (!r.rows[0]) throw new ValidationError('Mercancía no encontrada');
}
