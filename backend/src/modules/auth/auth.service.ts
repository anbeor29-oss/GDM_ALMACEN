/**
 * Auth Service
 * Business logic for authentication
 */

import bcryptjs from 'bcryptjs';
import { query, transaction } from '../../config/database';
import { generateToken, generateRefreshToken } from '../../middleware/authentication';
import { UnauthorizedError, ConflictError, NotFoundError, ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import * as redis from '../../config/redis';
import { User, AuthResponse } from '../../types';

/**
 * Hash password
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcryptjs.genSalt(10);
  return bcryptjs.hash(password, salt);
}

/**
 * Compare passwords
 */
export async function comparePasswords(password: string, hash: string): Promise<boolean> {
  return bcryptjs.compare(password, hash);
}

/**
 * Login user
 */
export async function login(email: string, password: string): Promise<AuthResponse> {
  // Find user by email
  const result = await query<User>(
    'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL',
    [email]
  );

  if (result.rows.length === 0) {
    logger.warn(`Login attempt with non-existent email: ${email}`);
    throw new UnauthorizedError('Email or password is incorrect');
  }

  const user = result.rows[0];

  // Check if user is locked
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    logger.warn(`Login attempt for locked user: ${email}`);
    throw new UnauthorizedError('Account is temporarily locked due to failed login attempts');
  }

  // Verify password
  const passwordMatch = await comparePasswords(password, user.password_hash);
  if (!passwordMatch) {
    // Increment failed login attempts
    const failedAttempts = user.failed_login_attempts + 1;
    const lockUntil = failedAttempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000) : null;

    await query(
      'UPDATE users SET failed_login_attempts = $1, locked_until = $2, updated_at = NOW() WHERE id = $3',
      [failedAttempts, lockUntil, user.id]
    );

    logger.warn(`Failed login attempt ${failedAttempts} for user: ${email}`);
    throw new UnauthorizedError('Email or password is incorrect');
  }

  // Check if user is active
  if (!user.is_active) {
    logger.warn(`Login attempt with inactive user: ${email}`);
    throw new UnauthorizedError('User account is inactive');
  }

  // Reset failed login attempts and update last login
  await query(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login = NOW(), updated_at = NOW() WHERE id = $1',
    [user.id]
  );

  // Generate tokens
  const token = generateToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    companyId: user.company_id,
    workGroup: (user as any).work_group || 'ADMIN_ALL',
  });

  const refreshToken = generateRefreshToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  // Store refresh token in Redis (7 days TTL)
  await redis.set(`refresh_token:${user.id}`, refreshToken, 7 * 24 * 60 * 60);

  logger.info(`User logged in successfully: ${email}`);

  return {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.first_name ? `${user.first_name} ${user.last_name || ''}` : undefined,
      role: user.role,
      companyId: user.company_id,
      workGroup: (user as any).work_group || 'ADMIN_ALL',
      // Flag para que el frontend fuerce el cambio de contraseña antes de
      // entregarle la app (super-admin recién creado, reset reciente, etc.)
      passwordChangeRequired: Boolean((user as any).password_change_required),
    },
    token,
    refreshToken,
  };
}

/**
 * Refresh token
 */
export async function refreshAccessToken(userId: string, refreshToken: string): Promise<AuthResponse> {
  // Verify refresh token exists in Redis
  const storedToken = await redis.get<string>(`refresh_token:${userId}`);

  if (!storedToken || storedToken !== refreshToken) {
    logger.warn(`Invalid refresh token attempt for user: ${userId}`);
    throw new UnauthorizedError('Invalid refresh token');
  }

  // Get user info
  const result = await query<User>(
    'SELECT * FROM users WHERE id = $1 AND is_active = true AND deleted_at IS NULL',
    [userId]
  );

  if (result.rows.length === 0) {
    await redis.del(`refresh_token:${userId}`);
    throw new NotFoundError('User not found');
  }

  const user = result.rows[0];

  // Generate new token
  const newToken = generateToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    companyId: user.company_id,
  });

  logger.info(`Token refreshed for user: ${user.email}`);

  return {
    success: true,
    token: newToken,
  };
}

/**
 * Logout user
 */
export async function logout(userId: string): Promise<void> {
  // Delete refresh token from Redis
  await redis.del(`refresh_token:${userId}`);

  logger.info(`User logged out: ${userId}`);
}

/**
 * Create user (register or admin creation)
 */
export async function createUser(data: {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  role: string;
  companyId?: string;
}): Promise<User> {
  // Check if user already exists
  const existingUser = await query<User>(
    'SELECT id FROM users WHERE email = $1',
    [data.email]
  );

  if (existingUser.rows.length > 0) {
    throw new ConflictError('User with this email already exists');
  }

  // Hash password
  const passwordHash = await hashPassword(data.password);

  // Insert user
  const result = await query<User>(
    `INSERT INTO users (email, password_hash, first_name, last_name, phone, role, company_id, is_active, failed_login_attempts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, 0)
     RETURNING *`,
    [data.email, passwordHash, data.firstName, data.lastName, data.phone, data.role, data.companyId]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create user');
  }

  logger.info(`User created: ${data.email}`);

  return result.rows[0];
}

/**
 * Change password
 */
export async function changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
  // Get user
  const result = await query<User>(
    'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL',
    [userId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('User not found');
  }

  const user = result.rows[0];

  // Verify old password
  const passwordMatch = await comparePasswords(oldPassword, user.password_hash);
  if (!passwordMatch) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  // Hash new password
  const newPasswordHash = await hashPassword(newPassword);

  // Update password + apaga el flag de "cambio pendiente" (primer login).
  await query(
    `UPDATE users SET password_hash = $1, password_change_required = FALSE,
                       failed_login_attempts = 0, locked_until = NULL, updated_at = NOW()
      WHERE id = $2`,
    [newPasswordHash, userId]
  );

  // Logout all sessions (delete refresh tokens)
  await redis.del(`refresh_token:${userId}`);

  logger.info(`Password changed for user: ${user.email}`);
}

/**
 * Validate RFC (basic check, detailed validation in API)
 */
export function validateRFC(rfc: string): boolean {
  const rfcRegex = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}(\d{3})?$/;
  return rfcRegex.test(rfc.trim().toUpperCase());
}

export default {
  hashPassword,
  comparePasswords,
  login,
  refreshAccessToken,
  logout,
  createUser,
  changePassword,
  validateRFC,
};
