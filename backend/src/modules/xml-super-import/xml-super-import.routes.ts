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
router.post('/apply', asyncHandler(async (req: Request, res: Response) => {
  const cid = companyId(req);
  const xml = req.body?.xml;
  if (!xml || typeof xml !== 'string') throw new ValidationError('Debe enviar { xml: "…" }');
  const det = await svc.detect(xml);
  const result: any = { type: det.type, created: [], skipped: [] };

  // Nómina — solo guarda metadata cuando el usuario lo pide
  if (det.type === 'CFDI_NOMINA' && req.body?.saveNomina) {
    const n = await svc.saveNomina(cid, det, req.user?.userId);
    result.created.push({ kind: 'nomina', id: n.id, uuid: det.uuid });
  } else if (det.type === 'CFDI_NOMINA') {
    result.skipped.push({ kind: 'nomina', reason: 'saveNomina=false' });
  }

  // TODO en siguientes iteraciones:
  //  · Guardar emisor/receptor como cliente/proveedor
  //  · Crear productos = viaje con impuestos
  //  · Puente al importador de Carta Porte
  //  · Pagos y NC

  res.status(201).json(result);
}));

export default router;
