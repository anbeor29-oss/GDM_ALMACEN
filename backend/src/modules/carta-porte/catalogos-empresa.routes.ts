/**
 * catalogos-empresa.routes — CRUD de los 3 catálogos por empresa de CP 3.1:
 *   /carta-porte/vehiculos
 *   /carta-porte/aseguradoras
 *   /carta-porte/operadores
 *
 * Un solo archivo por concisión (mismo shape en los tres).
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as vehiculos from './vehiculos.service';
import * as aseguradoras from './aseguradoras.service';
import * as operadores from './operadores.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID requerido');
  return req.user.companyId;
}

/* ─── ASEGURADORAS ─── */
router.get('/aseguradoras', asyncHandler(async (req, res) => {
  const items = await aseguradoras.list(companyId(req), {
    q: String(req.query.q || '').trim() || undefined,
    tipo: String(req.query.tipo || '').trim() || undefined,
    incluirInactivos: req.query.incluirInactivos === 'true',
  });
  res.json({ items });
}));
router.post('/aseguradoras', asyncHandler(async (req, res) => {
  res.status(201).json(await aseguradoras.create(companyId(req), req.body));
}));
router.patch('/aseguradoras/:id', asyncHandler(async (req, res) => {
  res.json(await aseguradoras.update(companyId(req), req.params.id, req.body));
}));
router.delete('/aseguradoras/:id', asyncHandler(async (req, res) => {
  res.json(await aseguradoras.deactivate(companyId(req), req.params.id));
}));

/* ─── VEHÍCULOS ─── */
router.get('/vehiculos', asyncHandler(async (req, res) => {
  const items = await vehiculos.list(companyId(req), {
    q: String(req.query.q || '').trim() || undefined,
    incluirInactivos: req.query.incluirInactivos === 'true',
  });
  res.json({ items });
}));
router.post('/vehiculos', asyncHandler(async (req, res) => {
  res.status(201).json(await vehiculos.create(companyId(req), req.body));
}));
router.patch('/vehiculos/:id', asyncHandler(async (req, res) => {
  res.json(await vehiculos.update(companyId(req), req.params.id, req.body));
}));
router.delete('/vehiculos/:id', asyncHandler(async (req, res) => {
  res.json(await vehiculos.deactivate(companyId(req), req.params.id));
}));

/* ─── OPERADORES ─── */
router.get('/operadores', asyncHandler(async (req, res) => {
  const items = await operadores.list(companyId(req), {
    q: String(req.query.q || '').trim() || undefined,
    tipo: String(req.query.tipo || '').trim() || undefined,
    incluirInactivos: req.query.incluirInactivos === 'true',
  });
  res.json({ items });
}));
router.post('/operadores', asyncHandler(async (req, res) => {
  res.status(201).json(await operadores.create(companyId(req), req.body));
}));
router.patch('/operadores/:id', asyncHandler(async (req, res) => {
  res.json(await operadores.update(companyId(req), req.params.id, req.body));
}));
router.delete('/operadores/:id', asyncHandler(async (req, res) => {
  res.json(await operadores.deactivate(companyId(req), req.params.id));
}));

export default router;
