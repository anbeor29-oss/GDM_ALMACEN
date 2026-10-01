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
import * as onboarding from './onboarding.service';
import * as authService from '../auth/auth.service';

const router = Router();

/* Alta pública de prueba — sin autenticación. */
router.post('/registro', asyncHandler(async (req: Request, res: Response) => {
  const { correo } = await onboarding.registrarPrueba({
    rfc: req.body?.rfc, razonSocial: req.body?.razonSocial, cp: req.body?.cp,
    regimen: req.body?.regimen, correo: req.body?.correo, password: req.body?.password,
    nombre: req.body?.nombre, telefono: req.body?.telefono,
  });
  // Auto-login: entra de inmediato (ya en modo prueba). Mismo envoltorio que /auth/login.
  const auth = await authService.login(correo, String(req.body?.password || ''));
  res.status(201).json({ success: true, message: 'Empresa de prueba creada. Tienes 72 horas para explorar.', data: auth });
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

export default router;
