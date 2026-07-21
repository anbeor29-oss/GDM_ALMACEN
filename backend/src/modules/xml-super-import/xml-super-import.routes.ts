/**
 * xml-super-import.routes — endpoints unificados del super lector XML.
 *
 *   POST /xml-super-import/detect   — detecta tipo + preview general (dry-run)
 *   POST /xml-super-import/apply    — aplica: crea invoice, catálogos, nomina...
 *
 * Body: { xml: "…" }  — el XML como string.
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as svc from './xml-super-import.service';
import * as customersService from '../customers/customers.service';
import * as productsService from '../products/products.service';
import { previewFromXml as cpPreviewFromXml } from '../carta-porte/importar-xml.service';
import * as lugaresSvc from '../carta-porte/lugares.service';
import * as vehiculosSvc from '../carta-porte/vehiculos.service';
import * as aseguradorasSvc from '../carta-porte/aseguradoras.service';
import * as operadoresSvc from '../carta-porte/operadores.service';
import * as mercanciasSvc from '../carta-porte/mercancias.service';
import { pool } from '../../config/database';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID requerido');
  return req.user.companyId;
}

router.post('/detect', asyncHandler(async (req: Request, res: Response) => {
  const xml = req.body?.xml;
  if (!xml || typeof xml !== 'string') throw new ValidationError('Debe enviar { xml: "…" }');
  const det = await svc.detect(xml);
  const dedup = await svc.checkDuplicates(companyId(req), det);
  res.json({ detection: det, duplicates: dedup });
}));

/**
 * Aplicación en 2 fases (según instrucción del usuario "pregúntame"):
 *
 *   Body opcional: {
 *     xml,
 *     saveNomina?: boolean,
 *     savePartyAsClient?: boolean,      // emisor|receptor decisión del usuario
 *     savePartyAsSupplier?: boolean,
 *   }
 *
 * Retorna un resumen de lo que se creó / omitió por dedup.
 */
/**
 * Body de apply — todo opcional; el frontend arma la lista según decisiones
 * del usuario en el preview:
 *
 *   { xml,
 *     saveNomina?: boolean,
 *     emisorAs?: 'CUSTOMER' | 'SUPPLIER' | null,  // null = no guardar
 *     receptorAs?: 'CUSTOMER' | 'SUPPLIER' | null,
 *     saveConceptsAsViajes?: boolean,             // regla 3: productos siempre viajes
 *     saveCartaPorte?: boolean,                   // regla 4-8: lugares/vehículos/etc
 *   }
 */
router.post('/apply', asyncHandler(async (req: Request, res: Response) => {
  const cid = companyId(req);
  const xml = req.body?.xml;
  if (!xml || typeof xml !== 'string') throw new ValidationError('Debe enviar { xml: "…" }');
  const det = await svc.detect(xml);
  const b = req.body || {};

  const created: Array<{ kind: string; id?: string; label?: string }> = [];
  const skipped: Array<{ kind: string; reason: string; label?: string }> = [];
  const errors: string[] = [];

  // ─── Emisor / Receptor como cliente o proveedor ──────────────────────
  const savePartyAs = async (party: { rfc: string; nombre?: string }, as: 'CUSTOMER' | 'SUPPLIER', label: string) => {
    if (!party.rfc) return;
    try {
      const created2 = await customersService.createCustomer(cid, {
        rfc: party.rfc,
        businessName: party.nombre || party.rfc,
        partyType: as,
      });
      created.push({ kind: as === 'CUSTOMER' ? 'cliente' : 'proveedor', id: created2.id, label: `${party.rfc} · ${party.nombre || ''}` });
    } catch (e: any) {
      // dedup: si ya existe, se ignora
      if (String(e?.message || '').includes('ya está registrado')) {
        skipped.push({ kind: as === 'CUSTOMER' ? 'cliente' : 'proveedor', reason: 'duplicado (dedup por RFC)', label });
      } else {
        errors.push(`${label}: ${e.message}`);
      }
    }
  };
  if (b.emisorAs) await savePartyAs(det.emisor, b.emisorAs, `Emisor ${det.emisor.rfc}`);
  if (b.receptorAs) await savePartyAs(det.receptor, b.receptorAs, `Receptor ${det.receptor.rfc}`);

  // ─── Conceptos → productos como "viaje" con impuestos ────────────────
  if (b.saveConceptsAsViajes && det.conceptos) {
    for (const c of det.conceptos) {
      try {
        // Regla 3: los productos siempre son viajes. Se usa la clave SAT del
        // concepto (usualmente 78101800/Servicios de transporte) tal cual.
        // Los impuestos van a taxRate; si el concepto trae retención, lo
        // marcamos como isDeductible para señalar retención.
        const iva = c.impuestos?.iva ?? 0;
        const taxRate = c.importe > 0 ? (iva / c.importe) : 0.16; // default 16%
        const p = await productsService.createProduct(cid, {
          name: c.descripcion.slice(0, 200),
          description: c.descripcion,
          claveSat: c.claveSat,
          unitCode: c.claveUnidad,
          basePrice: c.valorUnitario,
          taxType: '002', // IVA
          taxRate: Number(taxRate.toFixed(4)),
          isDeductible: (c.impuestos?.retIva ?? 0) > 0,
        });
        created.push({ kind: 'producto', id: p.id, label: c.descripcion.slice(0, 60) });
      } catch (e: any) {
        if (String(e?.message || '').toLowerCase().includes('duplicat') || String(e?.message || '').toLowerCase().includes('ya existe')) {
          skipped.push({ kind: 'producto', reason: 'duplicado', label: c.descripcion.slice(0, 60) });
        } else {
          errors.push(`Producto "${c.descripcion.slice(0, 40)}": ${e.message}`);
        }
      }
    }
  }

  // ─── Complemento Carta Porte — puente al importador existente ────────
  const savePartyMerc = b.saveMercancias === true;
  if ((b.saveCartaPorte || savePartyMerc) && det.hasCartaPorte) {
    try {
      const cp = await cpPreviewFromXml(xml);

      // Mercancías transportadas → catálogo + bitácora (SEPARADAS de products)
      if (savePartyMerc) {
        const remitente = (cp.lugares || []).find(l => l.tipoDefault === 'Origen');
        const destinatario = (cp.lugares || []).find(l => l.tipoDefault === 'Destino');
        for (const m of cp.mercancias || []) {
          try {
            const r = await mercanciasSvc.saveMercancia(cid, {
              claveSat: m.claveSat,
              descripcion: m.descripcion,
              cantidad: m.cantidad,
              claveUnidad: m.claveUnidad,
              unidadTexto: m.unidadTexto,
              pesoKg: m.pesoKg,
              valorMercancia: m.valorMercancia,
              moneda: m.moneda,
              uuidCfdi: det.uuid,
              idCcp: cp.cartaPorte?.idCCP,
              remitenteRfc: remitente?.rfc,
              remitenteNombre: remitente?.nombre,
              destinatarioRfc: destinatario?.rfc,
              destinatarioNombre: destinatario?.nombre,
              fechaViaje: det.fechaEmision,
            });
            if (r.catalogInserted) created.push({ kind: 'mercancía', id: r.catalogId, label: `${m.claveSat} · ${m.descripcion.slice(0, 40)}` });
            else skipped.push({ kind: 'mercancía', reason: 'ya en catálogo (contador +1)', label: m.descripcion.slice(0, 40) });
            if (!r.movimientoSkipped) created.push({ kind: 'mercancía-bitácora', id: r.movimientoId || undefined, label: `viaje ${m.cantidad} ${m.claveUnidad || ''}` });
          } catch (e: any) {
            errors.push(`Mercancía "${m.descripcion.slice(0, 40)}": ${e.message}`);
          }
        }
      }

      if (!b.saveCartaPorte) {
        // solo mercancías, skip lugares/vehiculos/aseguradoras/operadores
      } else {
      // Aseguradoras primero (el vehículo las referencia)
      const aseguradorasIds: Record<string, string> = {};
      for (const a of cp.aseguradoras || []) {
        try {
          const row = await aseguradorasSvc.create(cid, a);
          aseguradorasIds[a.tipo] = row.id;
          created.push({ kind: 'aseguradora', id: row.id, label: a.alias });
        } catch (e: any) {
          if (String(e?.message || '').includes('ya')) skipped.push({ kind: 'aseguradora', reason: 'dedup', label: a.alias });
          else errors.push(`Aseguradora "${a.alias}": ${e.message}`);
        }
      }
      // Vehículo
      if (cp.vehiculo) {
        try {
          const row = await vehiculosSvc.create(cid, {
            ...cp.vehiculo,
            aseguradoraRespCivilId: aseguradorasIds['RespCivil'],
            aseguradoraMedAmbId: aseguradorasIds['MedAmbiente'],
            aseguradoraCargaId: aseguradorasIds['Carga'],
          });
          created.push({ kind: 'vehiculo', id: row.id, label: cp.vehiculo.alias });
        } catch (e: any) {
          if (String(e?.message || '').includes('ya')) skipped.push({ kind: 'vehiculo', reason: 'dedup (placa duplicada)', label: cp.vehiculo.alias });
          else errors.push(`Vehículo "${cp.vehiculo.alias}": ${e.message}`);
        }
      }
      // Lugares
      for (const l of cp.lugares || []) {
        try {
          const row = await lugaresSvc.create(cid, l);
          created.push({ kind: 'lugar', id: row.id, label: `${l.tipoDefault} · ${l.alias}` });
        } catch (e: any) {
          if (String(e?.message || '').includes('ya')) skipped.push({ kind: 'lugar', reason: 'dedup (alias)', label: l.alias });
          else errors.push(`Lugar "${l.alias}": ${e.message}`);
        }
      }
      // Operadores
      for (const o of cp.operadores || []) {
        try {
          const row = await operadoresSvc.create(cid, o);
          created.push({ kind: 'operador', id: row.id, label: o.alias });
        } catch (e: any) {
          if (String(e?.message || '').includes('ya')) skipped.push({ kind: 'operador', reason: 'dedup', label: o.alias });
          else errors.push(`Operador "${o.alias}": ${e.message}`);
        }
      }
      } // else (b.saveCartaPorte)
    } catch (e: any) {
      errors.push(`Carta Porte: ${e.message}`);
    }
  }

  // ─── Nómina — metadata (regla del usuario: no procesar detalle aún) ──
  if (det.type === 'CFDI_NOMINA' && b.saveNomina) {
    try {
      const n = await svc.saveNomina(cid, det, req.user?.userId);
      created.push({ kind: 'nomina', id: n.id, label: `Nómina UUID ${det.uuid?.slice(0, 8)}…` });
    } catch (e: any) {
      errors.push(`Nómina: ${e.message}`);
    }
  }

  res.status(201).json({
    type: det.type,
    summary: {
      creados: created.length,
      omitidos: skipped.length,
      errores: errors.length,
    },
    created,
    skipped,
    errors,
  });
}));

/**
 * POST /xml-super-import/check-existing
 *
 * Recibe conjuntos de claves naturales y responde cuáles YA existen en la BD
 * de la empresa. Se usa en el modo lote para marcar checkmarks de "ya existe"
 * en el preview consolidado.
 *
 * Body: {
 *   parties?:      ["RFC1", "RFC2"],           // customers.rfc
 *   lugares?:      ["ALIAS1", "ALIAS2"],       // cp_lugares.alias
 *   vehiculos?:    ["PLACA1", "PLACA2"],       // cp_vehiculos.placa_vm
 *   operadores?:   ["RFC1", "RFC2"],           // cp_operadores.rfc
 *   aseguradoras?: ["POLIZA1", "POLIZA2"],     // cp_aseguradoras.num_poliza
 *   mercancias?:   [{ claveSat, descNorm, clienteRfc }],
 *   productos?:    [{ claveSat, name }],       // products.clave_sat + name
 * }
 * Respuesta: { parties: {"RFC1":true,...}, ... } — solo las que SÍ existen.
 */
router.post('/check-existing', asyncHandler(async (req: Request, res: Response) => {
  const cid = companyId(req);
  const b = req.body || {};
  const out: any = {};

  if (Array.isArray(b.parties) && b.parties.length) {
    const rfcs = b.parties.map((s: string) => String(s || '').toUpperCase()).filter(Boolean);
    const r = await pool.query(
      `SELECT rfc FROM customers WHERE company_id = $1 AND deleted_at IS NULL AND rfc = ANY($2)`,
      [cid, rfcs],
    );
    out.parties = Object.fromEntries(r.rows.map((row: any) => [row.rfc, true]));
  }
  if (Array.isArray(b.lugares) && b.lugares.length) {
    const r = await pool.query(
      `SELECT alias FROM cp_lugares WHERE company_id = $1 AND alias = ANY($2)`,
      [cid, b.lugares],
    );
    out.lugares = Object.fromEntries(r.rows.map((row: any) => [row.alias, true]));
  }
  if (Array.isArray(b.vehiculos) && b.vehiculos.length) {
    const placas = b.vehiculos.map((s: string) => String(s || '').toUpperCase()).filter(Boolean);
    const r = await pool.query(
      `SELECT placa_vm FROM cp_vehiculos WHERE company_id = $1 AND placa_vm = ANY($2)`,
      [cid, placas],
    );
    out.vehiculos = Object.fromEntries(r.rows.map((row: any) => [row.placa_vm, true]));
  }
  if (Array.isArray(b.operadores) && b.operadores.length) {
    const rfcs = b.operadores.map((s: string) => String(s || '').toUpperCase()).filter(Boolean);
    const r = await pool.query(
      `SELECT rfc FROM cp_operadores WHERE company_id = $1 AND rfc = ANY($2)`,
      [cid, rfcs],
    );
    out.operadores = Object.fromEntries(r.rows.map((row: any) => [row.rfc, true]));
  }
  if (Array.isArray(b.aseguradoras) && b.aseguradoras.length) {
    const r = await pool.query(
      `SELECT num_poliza FROM cp_aseguradoras WHERE company_id = $1 AND num_poliza = ANY($2)`,
      [cid, b.aseguradoras],
    );
    out.aseguradoras = Object.fromEntries(r.rows.map((row: any) => [row.num_poliza, true]));
  }
  if (Array.isArray(b.mercancias) && b.mercancias.length) {
    // Clave compuesta: claveSat|descNorm|clienteRfc
    const claves = b.mercancias.map((m: any) => `${m.claveSat}|${String(m.descNorm || m.descripcion || '').toUpperCase().trim().replace(/\s+/g, ' ')}|${m.clienteRfc || ''}`);
    const r = await pool.query(
      `SELECT clave_sat, descripcion_norm, COALESCE(cliente_rfc,'') AS cliente_rfc
         FROM cp_mercancias_catalog
        WHERE company_id = $1
          AND clave_sat || '|' || descripcion_norm || '|' || COALESCE(cliente_rfc,'') = ANY($2)`,
      [cid, claves],
    );
    out.mercancias = Object.fromEntries(r.rows.map((row: any) => [`${row.clave_sat}|${row.descripcion_norm}|${row.cliente_rfc}`, true]));
  }
  if (Array.isArray(b.productos) && b.productos.length) {
    const claves = b.productos.map((p: any) => p.claveSat).filter(Boolean);
    const names = b.productos.map((p: any) => String(p.name || '').toUpperCase().slice(0, 200)).filter(Boolean);
    const r = await pool.query(
      `SELECT clave_sat, UPPER(name) AS name FROM products
        WHERE company_id = $1 AND deleted_at IS NULL
          AND clave_sat = ANY($2) AND UPPER(name) = ANY($3)`,
      [cid, claves, names],
    );
    out.productos = Object.fromEntries(r.rows.map((row: any) => [`${row.clave_sat}|${row.name}`, true]));
  }

  res.json(out);
}));

/**
 * POST /xml-super-import/apply-selected
 *
 * Modo lote: recibe listas explícitas de entidades ya elegidas por el usuario
 * (con checkbox en el preview consolidado del lote). Cada lista trae los
 * campos ya extraídos del XML; el backend solo crea/deja pasar por dedup.
 *
 * Body:
 * {
 *   parties?:      [{ rfc, nombre, as: 'CUSTOMER'|'SUPPLIER' }],
 *   productos?:    [{ descripcion, claveSat, claveUnidad, valorUnitario, ivaTasa, retIva }],
 *   mercancias?:   [{ claveSat, descripcion, cantidad, claveUnidad, pesoKg, valorMercancia, moneda,
 *                     uuidCfdi, idCcp, remitenteRfc, remitenteNombre, destinatarioRfc, destinatarioNombre, fechaViaje }],
 *   lugares?:      [{ alias, tipoDefault, rfc, nombre, calle, numExterior, numInterior, colonia,
 *                     localidad, referencia, municipio, estado, pais, codigoPostal }],
 *   vehiculos?:    [{ alias, permSct, numPermisoSct, configVehicular, pesoBrutoVehicular, placaVm, anioModeloVm }],
 *   aseguradoras?: [{ alias, tipo, nombreAseguradora, numPoliza, primaSeguro }],
 *   operadores?:   [{ alias, tipoFigura, rfc, numLicencia, nombre }],
 * }
 */
router.post('/apply-selected', asyncHandler(async (req: Request, res: Response) => {
  const cid = companyId(req);
  const b = req.body || {};
  const created: Array<{ kind: string; id?: string; label?: string }> = [];
  const skipped: Array<{ kind: string; reason: string; label?: string }> = [];
  const errors: string[] = [];

  // 1) Parties (clientes/proveedores)
  for (const p of (b.parties || []) as any[]) {
    if (!p?.rfc || !p?.as) continue;
    try {
      const c = await customersService.createCustomer(cid, {
        rfc: String(p.rfc).toUpperCase(),
        businessName: p.nombre || p.rfc,
        partyType: p.as === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER',
      });
      created.push({ kind: p.as === 'SUPPLIER' ? 'proveedor' : 'cliente', id: c.id, label: `${p.rfc} · ${p.nombre || ''}` });
    } catch (e: any) {
      if (String(e?.message || '').includes('ya')) skipped.push({ kind: p.as === 'SUPPLIER' ? 'proveedor' : 'cliente', reason: 'dedup', label: p.rfc });
      else errors.push(`${p.as} ${p.rfc}: ${e.message}`);
    }
  }

  // 2) Productos (viajes/servicios facturados)
  for (const c of (b.productos || []) as any[]) {
    if (!c?.descripcion || !c?.claveSat) continue;
    try {
      const iva = Number(c.ivaTasa ?? 0.16);
      const p = await productsService.createProduct(cid, {
        name: String(c.descripcion).slice(0, 200),
        description: c.descripcion,
        claveSat: c.claveSat,
        unitCode: c.claveUnidad,
        basePrice: Number(c.valorUnitario || 0),
        taxType: '002',
        taxRate: iva,
        isDeductible: Number(c.retIva || 0) > 0,
      });
      created.push({ kind: 'producto', id: p.id, label: c.descripcion.slice(0, 60) });
    } catch (e: any) {
      const m = String(e?.message || '').toLowerCase();
      if (m.includes('duplicat') || m.includes('ya existe')) skipped.push({ kind: 'producto', reason: 'dedup', label: c.descripcion.slice(0, 60) });
      else errors.push(`Producto "${c.descripcion.slice(0, 40)}": ${e.message}`);
    }
  }

  // 3) Mercancías → catálogo + bitácora
  for (const m of (b.mercancias || []) as any[]) {
    if (!m?.claveSat || !m?.descripcion) continue;
    try {
      const r = await mercanciasSvc.saveMercancia(cid, m);
      if (r.catalogInserted) created.push({ kind: 'mercancía', id: r.catalogId, label: `${m.claveSat} · ${m.descripcion.slice(0, 40)}` });
      else skipped.push({ kind: 'mercancía', reason: 'ya en catálogo (contador +1)', label: m.descripcion.slice(0, 40) });
      if (!r.movimientoSkipped) created.push({ kind: 'mercancía-bitácora', id: r.movimientoId || undefined, label: `viaje ${m.cantidad} ${m.claveUnidad || ''}` });
    } catch (e: any) {
      errors.push(`Mercancía "${m.descripcion.slice(0, 40)}": ${e.message}`);
    }
  }

  // 4) Lugares
  for (const l of (b.lugares || []) as any[]) {
    if (!l?.alias || !l?.rfc) continue;
    try {
      const row = await lugaresSvc.create(cid, l);
      created.push({ kind: 'lugar', id: row.id, label: `${l.tipoDefault || ''} · ${l.alias}` });
    } catch (e: any) {
      if (String(e?.message || '').includes('ya')) skipped.push({ kind: 'lugar', reason: 'dedup (alias)', label: l.alias });
      else errors.push(`Lugar "${l.alias}": ${e.message}`);
    }
  }

  // 5) Aseguradoras (antes que vehículos por si se referencian)
  const aseguradorasIds: Record<string, string> = {};
  for (const a of (b.aseguradoras || []) as any[]) {
    if (!a?.alias) continue;
    try {
      const row = await aseguradorasSvc.create(cid, a);
      aseguradorasIds[a.tipo] = row.id;
      created.push({ kind: 'aseguradora', id: row.id, label: a.alias });
    } catch (e: any) {
      if (String(e?.message || '').includes('ya')) skipped.push({ kind: 'aseguradora', reason: 'dedup', label: a.alias });
      else errors.push(`Aseguradora "${a.alias}": ${e.message}`);
    }
  }

  // 6) Vehículos
  for (const v of (b.vehiculos || []) as any[]) {
    if (!v?.alias) continue;
    try {
      const row = await vehiculosSvc.create(cid, {
        ...v,
        aseguradoraRespCivilId: aseguradorasIds['RespCivil'],
        aseguradoraMedAmbId: aseguradorasIds['MedAmbiente'],
        aseguradoraCargaId: aseguradorasIds['Carga'],
      });
      created.push({ kind: 'vehiculo', id: row.id, label: v.alias });
    } catch (e: any) {
      if (String(e?.message || '').includes('ya')) skipped.push({ kind: 'vehiculo', reason: 'dedup (placa)', label: v.alias });
      else errors.push(`Vehículo "${v.alias}": ${e.message}`);
    }
  }

  // 7) Operadores
  for (const o of (b.operadores || []) as any[]) {
    if (!o?.alias || !o?.rfc) continue;
    try {
      const row = await operadoresSvc.create(cid, o);
      created.push({ kind: 'operador', id: row.id, label: o.alias });
    } catch (e: any) {
      if (String(e?.message || '').includes('ya')) skipped.push({ kind: 'operador', reason: 'dedup', label: o.alias });
      else errors.push(`Operador "${o.alias}": ${e.message}`);
    }
  }

  res.status(201).json({
    summary: { creados: created.length, omitidos: skipped.length, errores: errors.length },
    created, skipped, errors,
  });
}));

export default router;
