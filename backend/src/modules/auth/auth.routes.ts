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

export default router;
