/**
 * Auth Routes
 */

import { Router, Request, Response } from 'express';
import * as authController from './auth.controller';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler as errorAsyncHandler } from '../../middleware/errorHandler';

const router = Router();

/**
 * POST /api/v1/auth/login
 * @body { email: string, password: string }
 * @returns { token, refreshToken, user }
 */
router.post('/login', errorAsyncHandler(authController.login));

/**
 * POST /api/v1/auth/refresh
 * @body { refreshToken: string }
 * @returns { token }
 */
router.post('/refresh', errorAsyncHandler(authController.refreshToken));

/**
 * POST /api/v1/auth/logout
 * @header { Authorization: Bearer {token} }
 */
router.post('/logout', authenticateToken, errorAsyncHandler(authController.logout));

/**
 * POST /api/v1/auth/change-password
 * @header { Authorization: Bearer {token} }
 * @body { oldPassword: string, newPassword: string }
 */
router.post('/change-password', authenticateToken, errorAsyncHandler(authController.changePassword));

/**
 * GET /api/v1/auth/me
 * @header { Authorization: Bearer {token} }
 * @returns { user info }
 */
router.get('/me', authenticateToken, errorAsyncHandler(authController.getCurrentUser));

/** Empresas del usuario y cambio de la empresa activa (multi-empresa). */
/**
 * GET /auth/mis-capacidades — qué puede HACER el usuario que pregunta.
 *
 * ── POR QUÉ HACÍA FALTA ──
 * El frontend escondía botones adivinando: "si tu rol es ADMIN puedes pagar",
 * "si eres ADMIN puedes capturar nómina". Adivinar tiene dos formas de fallar y
 * las dos ocurrieron:
 *
 *   Esconder de más. Tesorería y Recursos Humanos veían sus pantallas sin un
 *   solo botón, porque la regla del frontend no sabía de grupos de trabajo.
 *
 *   Esconder de menos. Mostrar un botón que el servidor va a rechazar, y que el
 *   usuario descubre a clics.
 *
 * Además el frontend NO puede adivinar los otorgamientos individuales: son
 * renglones en la base que sólo el servidor conoce.
 *
 * Aquí se responde con el conjunto EFECTIVO —lo que da el rol, más lo que da el
 * grupo, más lo otorgado a mano— y el frontend deja de tener su propia copia de
 * las reglas.
 *
 * ESTO NO ES EL CANDADO. Sirve para no ofrecer lo que va a ser negado; cada
 * endpoint sigue verificando por su cuenta.
 */
router.get(
  '/mis-capacidades',
  authenticateToken,
  errorAsyncHandler(async (req: any, res: any) => {
    const { getEffectiveCapabilities, CAPABILITIES } =
      await import('./capabilities');
    const capacidades = await getEffectiveCapabilities(req.user.userId, req.user.role);
    res.json({
      success: true,
      data: {
        capabilities: capacidades,
        /* El catálogo con sus etiquetas, para que una pantalla pueda decir
         * QUÉ le falta a alguien en vez de sólo esconderle el botón. */
        catalogo: CAPABILITIES,
      },
    });
  })
);

router.get('/companies', authenticateToken, errorAsyncHandler(authController.misEmpresas));
router.post('/switch-company', authenticateToken, errorAsyncHandler(authController.cambiarEmpresa));

export default router;
