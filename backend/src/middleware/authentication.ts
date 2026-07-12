/**
 * JWT Authentication Middleware
 * Handles token verification and user authentication
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/environment';
import { UnauthorizedError } from './errorHandler';
import logger from './logger';

// Extend Express Request to include user info
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        role: string;
        companyId?: string;
        /** Si presente, indica que el SUPER_ADMIN está suplantando a este usuario. */
        impersonatedBy?: { userId: string; email: string };
      };
      token?: string;
    }
  }
}

interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  companyId?: string;
  /** Trazabilidad de impersonación — el JWT del usuario suplantado lleva quién lo está suplantando. */
  impersonatedBy?: { userId: string; email: string };
  iat?: number;
  exp?: number;
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    return decoded as TokenPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Token has expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new UnauthorizedError('Invalid token');
    }
    throw error;
  }
}

/**
 * Generate JWT token
 */
export function generateToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
  const options: jwt.SignOptions = {
    expiresIn: config.jwt.expiration as jwt.SignOptions['expiresIn'],
  };
  return jwt.sign(payload, config.jwt.secret, options);
}

/**
 * Generate refresh token
 */
export function generateRefreshToken(
  payload: Omit<TokenPayload, 'iat' | 'exp'>
): string {
  const options: jwt.SignOptions = {
    expiresIn: config.jwt.refreshExpiration as jwt.SignOptions['expiresIn'],
  };
  return jwt.sign(payload, config.jwt.refreshSecret, options);
}

/**
 * Verify refresh token
 */
export function verifyRefreshToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, config.jwt.refreshSecret);
    return decoded as TokenPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Refresh token has expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new UnauthorizedError('Invalid refresh token');
    }
    throw error;
  }
}

/**
 * Extract token from request headers
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');

  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Authentication middleware
 * Verifies JWT token and attaches user to request
 */
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = extractToken(req);

    if (!token) {
      throw new UnauthorizedError('No token provided');
    }

    const payload = verifyToken(token);

    req.user = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      companyId: payload.companyId,
      impersonatedBy: payload.impersonatedBy,
    };
    req.token = token;

    // Si el token es viejo (no incluye companyId) o cambió la empresa del usuario,
    // recuperamos el company_id actual desde BD para que el request no falle.
    if (!req.user.companyId) {
      try {
        const { query } = await import('../config/database');
        const r = await query<{ company_id: string | null }>(
          'SELECT company_id FROM users WHERE id = $1 AND deleted_at IS NULL',
          [payload.userId]
        );
        if (r.rows[0]?.company_id) {
          req.user.companyId = r.rows[0].company_id;
          logger.debug(`Recovered companyId from DB for ${payload.email}`);
        }
      } catch (e) {
        logger.warn('Could not recover companyId from DB', {
          error: e instanceof Error ? e.message : 'unknown',
        });
      }
    }

    logger.debug(`User authenticated: ${payload.email}`);
    return next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return res.status(401).json({
        success: false,
        message: error.message,
      });
    }

    logger.error('Authentication error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return res.status(401).json({
      success: false,
      message: 'Authentication failed',
    });
  }
};

/**
 * Optional authentication middleware
 * Does not require token, but verifies if present
 */
export const optionalAuthentication = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = extractToken(req);

    if (token) {
      const payload = verifyToken(token);
      req.user = {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        companyId: payload.companyId,
      };
      req.token = token;
      logger.debug(`User authenticated: ${payload.email}`);
    }
  } catch (error) {
    logger.debug('Optional authentication skipped - no valid token');
  }

  next();
};

/**
 * Role-based authorization middleware
 */
export const authorize = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(`Unauthorized access attempt by ${req.user.email}`, {
        allowedRoles,
        userRole: req.user.role,
      });

      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
      });
    }

    return next();
  };
};

/**
 * Capability-based authorization (§8 ALMACEN) — capa fina sobre roles.
 *
 *  Pasa si el usuario tiene la capacidad EFECTIVA:
 *   · SUPER_ADMIN / ADMIN / MANAGER → siempre (conservan su acceso operativo).
 *   · USER → sólo si tiene la capacidad en su base o se la otorgó su ADMIN.
 *
 *  Es NO-rompiente respecto de `authorize('ADMIN','MANAGER','SUPER_ADMIN')`:
 *  esos tres roles siguen pasando exactamente igual; el cambio es que ahora
 *  un USER puede ser elevado a una capacidad concreta.
 */
export const requireCapability = (capability: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    try {
      const { userHasCapability } = await import('../modules/auth/capabilities');
      const ok = await userHasCapability(req.user.userId, req.user.role, capability);
      if (!ok) {
        logger.warn(`Capability denied: ${req.user.email} carece de '${capability}'`);
        return res.status(403).json({
          success: false,
          message: `No tienes la capacidad requerida (${capability}). Pide a tu administrador que te la otorgue.`,
        });
      }
      return next();
    } catch (e) {
      logger.error('requireCapability error', { error: e instanceof Error ? e.message : 'unknown' });
      return res.status(500).json({ success: false, message: 'Error verificando permisos' });
    }
  };
};

export default {
  verifyToken,
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  extractToken,
  authenticateToken,
  optionalAuthentication,
  authorize,
  requireCapability,
};
