/**
 * /onboarding — alta pública de prueba (self-service) y estado del onboarding.
 *
 *  POST /onboarding/registro   PÚBLICO: crea la empresa de prueba (72 h) + su ADMIN
 *                              y devuelve el login (auto-entra, restringido).
 *  GET  /onboarding/estado     AUTH: estado de prueba (para banner / restricciones).
 *  POST /onboarding/demo       AUTH: solicita una "demostración en línea".
 */
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { authenticateToken } from '../../middleware/authentication';
import { requireSuperAdmin } from '../admin/admin.middleware';
import * as onboarding from './onboarding.service';

const router = Router();

/* Alta pública de prueba — sin autenticación. NO auto-entra: devuelve el correo y
 * una contraseña TEMPORAL que el usuario cambia al iniciar sesión. */
router.post('/registro', asyncHandler(async (req: Request, res: Response) => {
  const { correo, passwordTemporal } = await onboarding.registrarPrueba({
    rfc: req.body?.rfc, razonSocial: req.body?.razonSocial, cp: req.body?.cp,
    regimen: req.body?.regimen, correo: req.body?.correo,
    nombre: req.body?.nombre, telefono: req.body?.telefono,
  });
  res.status(201).json({
    success: true,
    message: 'Cuenta creada. Inicia sesión con tu contraseña temporal y cámbiala para entrar.',
    data: { correo, passwordTemporal },
  });
}));

/* Estado del onboarding de la empresa en sesión. */
router.get('/estado', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) { res.json({ success: true, data: { estado: 'ACTIVA', firmado: false, pruebaInicio: null, horasRestantes: null } }); return; }
  res.json({ success: true, data: await onboarding.estadoOnboarding(companyId) });
}));

/* Solicitud de demostración en línea. */
router.post('/demo', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) { res.status(400).json({ success: false, message: 'Sin empresa en sesión.' }); return; }
  res.json({ success: true, data: await onboarding.solicitarDemo(companyId, {
    contacto: req.body?.contacto, correo: req.body?.correo, telefono: req.body?.telefono, mensaje: req.body?.mensaje,
  }) });
}));

/* Bandeja de solicitudes de demo — SÓLO súper admin. */
router.get('/demos', authenticateToken, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await onboarding.listarDemos(req.query.pendientes === 'true') });
}));
router.post('/demos/:id/atender', authenticateToken, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await onboarding.atenderDemo(req.params.id) });
}));

/* Bandeja de empresas que FIRMARON (facturar + pasar a producción) — súper admin. */
router.get('/firmas', authenticateToken, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await onboarding.listarFirmas(req.query.pendientes === 'true') });
}));
router.post('/firmas/:id/atender', authenticateToken, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await onboarding.atenderFirma(req.params.id) });
}));

export default router;
