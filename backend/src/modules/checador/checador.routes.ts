/**
 * /checador — control de asistencia biométrico.
 *
 * DOS NIVELES DE ACCESO (montado bajo el módulo 'checador', ver app.ts):
 *   · CHECAR (POST /checada): lo alcanza la cuenta UNIVERSAL del grupo CHECADOR
 *     —sólo registra su entrada/salida; la cara identifica a cada quien—.
 *   · ADMINISTRAR (todo lo demás: enrolar, turnos, registro, config): exige
 *     además el módulo 'nomina' → Recursos Humanos / ADMIN. La cuenta CHECADOR
 *     NO lo alcanza.
 *
 * La autenticación del KIOSCO por token de dispositivo (sin login) es Fase 2.
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { requireModule } from '../../middleware/permissions';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as checador from './checador.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Se requiere empresa activa.');
  return req.user.companyId;
}
const ok = (res: Response, data: any, code = 200) => res.status(code).json({ success: true, data });

/* ── CHECAR — el único endpoint del grupo CHECADOR (cuenta universal) ──
 * Identifica el rostro (1:N) y asienta la entrada/salida. Va ANTES del candado
 * de 'nomina' para que la cuenta que sólo checa lo alcance. */
router.post('/checada', asyncHandler(async (req, res) =>
  ok(res, await checador.registrarChecada(companyId(req), req.body || {}), 201)));

/* ─────────────── De aquí para abajo: ADMINISTRACIÓN (exige 'nomina') ───────────────
 * Enrolar, turnos, horarios, consentimiento, registro y configuración son de
 * Recursos Humanos / ADMIN. La cuenta CHECADOR (sólo 'checador') se queda fuera. */
router.use(requireModule('nomina'));

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

/* ── Asignación MASIVA de horario (varios empleados de un golpe) ── */
router.put('/horarios/masivo', asyncHandler(async (req, res) =>
  ok(res, await checador.asignarHorarioMasivo(companyId(req), (req.body || {}).empleadoIds, req.body || {}))));

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

/* ── Empleados (con consentimiento y # de plantillas) para enrolar en el kiosco ── */
router.get('/empleados-enrolar', asyncHandler(async (req, res) =>
  ok(res, await checador.empleadosParaEnrolar(companyId(req)))));

/* ── Registro de asistencia (requerimiento de ley): día y historial ── */
router.get('/asistencia/dia', asyncHandler(async (req, res) =>
  ok(res, await checador.asistenciaDelDia(companyId(req), req.query.fecha as string | undefined))));
const filtrosAsistencia = (req: Request) => ({
  desde: req.query.desde as string | undefined,
  hasta: req.query.hasta as string | undefined,
  empleadoId: req.query.empleadoId as string | undefined,
  limit: req.query.limit ? Number(req.query.limit) : undefined,
});
router.get('/asistencia/historial', asyncHandler(async (req, res) =>
  ok(res, await checador.historialAsistencia(companyId(req), filtrosAsistencia(req)))));
router.get('/asistencia/historial.xlsx', asyncHandler(async (req, res) => {
  const { buffer, nombre } = await checador.historialExcel(companyId(req), filtrosAsistencia(req));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(buffer);
}));
router.get('/asistencia/historial.pdf', asyncHandler(async (req, res) => {
  const buffer = await checador.historialPdf(companyId(req), filtrosAsistencia(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="Registro_asistencia.pdf"');
  res.send(buffer);
}));

export default router;
