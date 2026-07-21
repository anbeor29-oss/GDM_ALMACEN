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
  if (b.saveCartaPorte && det.hasCartaPorte) {
    try {
      const cp = await cpPreviewFromXml(xml);
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

export default router;
