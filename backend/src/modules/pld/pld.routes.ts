/**
 * /pld — PLD / antilavado (LFPIORPI) por EMPRESA. Gated: módulo contabilidad
 * (authenticateToken + requireModule se aplican al montar en app.ts).
 *
 *   GET  /pld/actividades   catálogo de Actividades Vulnerables (Art. 17) + umbrales UMA
 *   GET  /pld/config        config PLD de la empresa
 *   PUT  /pld/config        activar / fracción / representante / padrón
 *   GET  /pld/tablero       detección sobre facturas + alertas (identificación / aviso / acumulado)
 *   GET  /pld/expedientes    expedientes de clientes
 *   PUT  /pld/expediente     alta/actualización de un expediente
 */
import { Router, Request, Response } from 'express';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as pld from './pld.service';
import * as aviso from './pld-aviso.service';

const router = Router();

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

router.get('/actividades', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: pld.ACTIVIDADES });
}));

router.get('/config', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await pld.getConfig(companyId(req)) });
}));

router.put('/config', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await pld.setConfig(companyId(req), req.body || {}) });
}));

router.get('/tablero', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await pld.tablero(companyId(req)) });
}));

router.get('/campos-expediente', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: pld.CATALOGO_EXPEDIENTE });
}));

router.get('/expedientes', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await pld.listarExpedientes(companyId(req)) });
}));

router.put('/expediente', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await pld.guardarExpediente(companyId(req), req.body || {}) });
}));

/** Resumen del Aviso del periodo (cuántas operaciones, cuántas sin expediente). */
router.get('/aviso/resumen', asyncHandler(async (req: Request, res: Response) => {
  const r = await aviso.generarAvisoXml(companyId(req), Number(req.query.anio), Number(req.query.mes));
  res.json({ success: true, data: { operaciones: r.operaciones, sinExpediente: r.sinExpediente } });
}));

/** Borrador del Aviso en XML (contenido Art. 24 + esquema general SPPLD; validar en el Portal). */
router.get('/aviso.xml', asyncHandler(async (req: Request, res: Response) => {
  const r = await aviso.generarAvisoXml(companyId(req), Number(req.query.anio), Number(req.query.mes));
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${r.nombre}"`);
  res.send(r.xml);
}));

export default router;
