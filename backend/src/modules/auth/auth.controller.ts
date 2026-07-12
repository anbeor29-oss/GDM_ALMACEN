/**
 * Auth Controller
 * HTTP request handlers for authentication
 */

import { Request, Response } from 'express';
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

  // Capacidades efectivas (§8) — el frontend las usa para mostrar/ocultar acciones
  const { getEffectiveCapabilities } = await import('./capabilities');
  const capabilities = await getEffectiveCapabilities(req.user.userId, req.user.role);

  res.status(200).json({
    success: true,
    data: { ...req.user, capabilities },
  });
}

export default {
  login,
  refreshToken,
  logout,
  changePassword,
  getCurrentUser,
};
