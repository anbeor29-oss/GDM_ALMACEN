/**
 * Auth Controller
 * HTTP request handlers for authentication
 */

import { Request, Response } from 'express';
import { empresasDelUsuario, cambiarDeEmpresa } from './companies-de-usuario.service';
import * as authService from './auth.service';
import { ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

/**
 * POST /api/v1/auth/login
 */
export async function login(req: Request, res: Response) {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    throw new ValidationError('Email and password are required');
  }

  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new ValidationError('Email and password must be strings');
  }

  // Login
  const result = await authService.login(email.toLowerCase(), password);

  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: result,
  });
}

/**
 * POST /api/v1/auth/refresh
 */
export async function refreshToken(req: Request, res: Response) {
  const { refreshToken } = req.body;

  // Validate input
  if (!refreshToken) {
    throw new ValidationError('Refresh token is required');
  }

  if (!req.user) {
    throw new ValidationError('User not authenticated');
  }

  // Refresh token
  const result = await authService.refreshAccessToken(req.user.userId, refreshToken);

  res.status(200).json({
    success: true,
    message: 'Token refreshed successfully',
    data: result,
  });
}

/**
 * POST /api/v1/auth/logout
 */
export async function logout(req: Request, res: Response) {
  if (!req.user) {
    throw new ValidationError('User not authenticated');
  }

  // Logout
  await authService.logout(req.user.userId);

  res.status(200).json({
    success: true,
    message: 'Logout successful',
  });
}

/**
 * POST /api/v1/auth/change-password
 */
export async function changePassword(req: Request, res: Response) {
  const { oldPassword, newPassword } = req.body;

  // Validate input
  if (!oldPassword || !newPassword) {
    throw new ValidationError('Old password and new password are required');
  }

  if (newPassword.length < 8) {
    throw new ValidationError('New password must be at least 8 characters');
  }

  if (!req.user) {
    throw new ValidationError('User not authenticated');
  }

  // Change password
  await authService.changePassword(req.user.userId, oldPassword, newPassword);

  res.status(200).json({
    success: true,
    message: 'Password changed successfully',
  });
}

/**
 * GET /api/v1/auth/me
 */
export async function getCurrentUser(req: Request, res: Response) {
  if (!req.user) {
    throw new ValidationError('User not authenticated');
  }

  res.status(200).json({
    success: true,
    data: req.user,
  });
}

export default {
  login,
  refreshToken,
  logout,
  changePassword,
  getCurrentUser,
};

/** GET /auth/companies — empresas a las que este usuario tiene acceso. */
export async function misEmpresas(req: Request, res: Response) {
  const userId = (req as any).user?.userId;
  const empresas = await empresasDelUsuario(userId);
  res.status(200).json({ success: true, data: empresas });
}

/**
 * POST /auth/switch-company — cambia la empresa activa de la sesión.
 * Devuelve un token NUEVO; el frontend debe reemplazarlo y limpiar su memoria.
 */
export async function cambiarEmpresa(req: Request, res: Response) {
  const u = (req as any).user;
  const { companyId } = req.body || {};
  if (!companyId) throw new ValidationError('Indica la empresa a la que quieres cambiar.');
  const r = await cambiarDeEmpresa(u.userId, u.email, u.role, String(companyId));
  res.status(200).json({ success: true, message: `Ahora trabajas en ${r.company.business_name}`, data: r });
}
