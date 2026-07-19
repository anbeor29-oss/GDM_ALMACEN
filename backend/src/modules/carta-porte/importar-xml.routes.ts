/**
 * importar-xml.routes — endpoints del importador de XML CFDI+CP.
 *   POST /carta-porte/importar-xml/preview  — parseo, sin escribir
 *   POST /carta-porte/importar-xml/apply    — upserts a los 4 catálogos
 *
 * Payload: { xml: "<?xml version..." }  (JSON con el XML como string).
 * En apply, el body también acepta un objeto ya editado por el usuario en el
 * preview: { lugares, vehiculo, aseguradoras, operadores } — si viene, se
 * usa; si no, se re-parsea del XML.
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as importer from './importar-xml.service';
import * as lugaresSvc from './lugares.service';
import * as vehiculosSvc from './vehiculos.service';
import * as aseguradorasSvc from './aseguradoras.service';
import * as operadoresSvc from './operadores.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID requerido');
  return req.user.companyId;
}

router.post('/preview', asyncHandler(async (req: Request, res: Response) => {
  const xml = req.body?.xml;
  if (!xml || typeof xml !== 'string') throw new ValidationError('Debe incluir { xml: "…" }');
  const preview = await importer.previewFromXml(xml);
  res.json(preview);
}));

router.post('/apply', asyncHandler(async (req: Request, res: Response) => {
  const cid = companyId(req);
  const body = req.body || {};

  // Si el usuario editó el preview y lo envía tal cual, se usa directo.
  // Si no, se re-parsea del XML.
  let data;
  if (body.lugares || body.vehiculo || body.aseguradoras || body.operadores) {
    data = body;
  } else if (typeof body.xml === 'string') {
    data = await importer.previewFromXml(body.xml);
  } else {
    throw new ValidationError('Debe enviar xml o payload editado');
  }

  const result = {
    lugares:      [] as any[],
    vehiculo:     null as any,
    aseguradoras: [] as any[],
    operadores:   [] as any[],
    errors:       [] as string[],
  };

  // ─── Aseguradoras PRIMERO — el vehículo puede referenciarlas ─────────
  const aseguradorasCreated: Record<string, string> = {}; // tipo → id
  for (const a of (data.aseguradoras || [])) {
    try {
      const row = await aseguradorasSvc.create(cid, a);
      result.aseguradoras.push(row);
      aseguradorasCreated[a.tipo] = row.id;
    } catch (e: any) {
      result.errors.push(`Aseguradora "${a.alias}": ${e.message}`);
    }
  }

  // ─── Vehículo (con FK a aseguradoras si aplican) ───────────────────
  if (data.vehiculo) {
    try {
      const payload = { ...data.vehiculo,
        aseguradoraRespCivilId: aseguradorasCreated['RespCivil']   ?? undefined,
        aseguradoraMedAmbId:    aseguradorasCreated['MedAmbiente'] ?? undefined,
        aseguradoraCargaId:     aseguradorasCreated['Carga']       ?? undefined,
      };
      result.vehiculo = await vehiculosSvc.create(cid, payload);
    } catch (e: any) {
      result.errors.push(`Vehículo "${data.vehiculo.alias}": ${e.message}`);
    }
  }

  // ─── Lugares ─────────────────────────────────────────────────────────
  for (const l of (data.lugares || [])) {
    try {
      result.lugares.push(await lugaresSvc.create(cid, l));
    } catch (e: any) {
      result.errors.push(`Lugar "${l.alias}": ${e.message}`);
    }
  }

  // ─── Operadores ──────────────────────────────────────────────────────
  for (const o of (data.operadores || [])) {
    try {
      result.operadores.push(await operadoresSvc.create(cid, o));
    } catch (e: any) {
      result.errors.push(`Operador "${o.alias}": ${e.message}`);
    }
  }

  res.status(201).json(result);
}));

export default router;
