/**
 * /checador — control de asistencia biométrico.
 *
 * Se monta bajo el candado del módulo 'nomina' (ver app.ts): quien administra el
 * checador es Recursos Humanos / el administrador. La autenticación del KIOSCO
 * (token de dispositivo, sin login personal) se resolverá en la Fase 2.
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as checador from './checador.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Se requiere empresa activa.');
  return req.user.companyId;
}
const ok = (res: Response, data: any, code = 200) => res.status(code).json({ success: true, data });

/* ── Configuración ── */
router.get('/config', asyncHandler(async (req, res) => ok(res, await checador.getConfig(companyId(req)))));
router.put('/config', asyncHandler(async (req, res) => ok(res, await checador.setConfig(companyId(req), req.body || {}))));

/* ── Turnos ── */
router.get('/turnos', asyncHandler(async (req, res) => ok(res, await checador.listarTurnos(companyId(req)))));
router.post('/turnos', asyncHandler(async (req, res) => ok(res, await checador.crearTurno(companyId(req), req.body || {}), 201)));
router.put('/turnos/:id', asyncHandler(async (req, res) => ok(res, await checador.actualizarTurno(companyId(req), req.params.id, req.body || {}))));
router.delete('/turnos/:id', asyncHandler(async (req, res) => ok(res, await checador.borrarTurno(companyId(req), req.params.id))));

/* ── Horario del empleado ── */
router.get('/empleados/:id/horario', asyncHandler(async (req, res) => ok(res, await checador.getHorario(companyId(req), req.params.id))));
router.put('/empleados/:id/horario', asyncHandler(async (req, res) => ok(res, await checador.setHorario(companyId(req), req.params.id, req.body || {}))));
router.post('/empleados/:id/asignacion', asyncHandler(async (req, res) => ok(res, await checador.asignarDia(companyId(req), req.params.id, req.body || {}), 201)));

/* ── Consentimiento (LFPDPPP) ── */
router.get('/empleados/:id/consentimiento', asyncHandler(async (req, res) => ok(res, await checador.getConsentimiento(companyId(req), req.params.id))));
router.put('/empleados/:id/consentimiento', asyncHandler(async (req, res) => ok(res, await checador.setConsentimiento(companyId(req), req.params.id, req.body || {}))));

/* ── Enrolamiento facial ── */
router.get('/empleados/:id/enrolamiento', asyncHandler(async (req, res) => ok(res, await checador.estadoEnrolamiento(companyId(req), req.params.id))));
router.post('/empleados/:id/enrolar', asyncHandler(async (req, res) =>
  ok(res, await checador.enrolarRostros(companyId(req), req.params.id, (req.body || {}).descriptores), 201)));

/* ── Identificación 1:N (base del check-in del kiosco) ── */
router.post('/identificar', asyncHandler(async (req, res) =>
  ok(res, await checador.identificar(companyId(req), (req.body || {}).descriptor))));

export default router;
