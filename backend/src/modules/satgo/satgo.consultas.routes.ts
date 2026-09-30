/**
 * /satgo/consultas — consultas SatGo por EMPRESA (gated: módulo contabilidad).
 *
 *  GET  /satgo/consultas/info-fiscal                      Información fiscal (JSON, CIEC)
 *  GET  /satgo/consultas/declaraciones?ejercicio=&mes=    Declaraciones (ZIP, CIEC)
 *  GET  /satgo/consultas/validar-cfdi?re=&rr=&tt=&id=&fe= Estado de un CFDI (sin CIEC)
 *
 * authenticateToken + requireModule('contabilidad') se aplican al montar (gated) en app.ts.
 */
import { Router, Request, Response } from 'express';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as consultas from './satgo.consultas.service';

const router = Router();

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

router.get('/info-fiscal', asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await consultas.infoFiscal(companyId(req)) });
}));

router.get('/declaraciones', asyncHandler(async (req: Request, res: Response) => {
  const ejercicio = parseInt(String(req.query.ejercicio || ''), 10);
  const mes = parseInt(String(req.query.mes || '0'), 10) || 0;
  const { buffer, nombre } = await consultas.declaraciones(companyId(req), ejercicio, mes);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(buffer);
}));

router.get('/validar-cfdi', asyncHandler(async (req: Request, res: Response) => {
  const data = await consultas.validarCfdi(companyId(req), {
    re: req.query.re as string, rr: req.query.rr as string,
    tt: req.query.tt as string, id: req.query.id as string, fe: req.query.fe as string,
  });
  res.json({ success: true, data });
}));

export default router;
