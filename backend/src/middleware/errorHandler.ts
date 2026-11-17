/**
 * Global Error Handler Middleware
 * Catches and formats errors consistently
 */

import { Request, Response, NextFunction } from 'express';
import logger from './logger';

export interface AppError extends Error {
  statusCode?: number;
  message: string;
}

/**
 * Error handler middleware
 */
export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Log error
  logger.error(`${statusCode} - ${message}`, {
    method: req.method,
    url: req.path,
    ip: req.ip,
    error: err.stack,
  });

  // Send response
  res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

/**
 * Not found handler
 */
export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const error: AppError = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};

/**
 * Async error wrapper
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Responde un proceso LARGO sin que el navegador vea «Network Error».
 *
 * Imports grandes (p. ej. el libro diario de Contalink: miles de pólizas → decenas
 * de miles de consultas) tardan varios minutos. Mientras el server trabaja NO fluye
 * ningún byte y algunos proxies/entornos cierran la conexión «inactiva»; el navegador
 * lo reporta como `Network Error` aunque el proceso siga vivo o termine bien.
 *
 * Solución: se envía un byte de relleno (un espacio, que es BLANCO válido en JSON)
 * cada pocos segundos para que la conexión nunca quede inactiva, y al final se escribe
 * el cuerpo JSON real. `JSON.parse` ignora el blanco inicial, así que axios lo parsea
 * sin cambios y el contrato `{ success, data, message }` se conserva intacto.
 *
 * `work()` devuelve el objeto a serializar. Si lanza, se responde `{ success:false }`:
 * con su status si aún no empezó el streaming, o con 200 + cuerpo de error si ya se
 * mandaron espacios (ya no se puede cambiar el status). El cliente debe tratar
 * `success:false` como error (ver `importarContalink*` en `api.ts`).
 */
export async function responderConLatido(
  res: Response,
  work: () => Promise<any>,
  cadaMs: number = 15000
): Promise<void> {
  res.status(200);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx/proxy: no bufferear la respuesta
  let latiendo = true;
  const latido = setInterval(() => {
    if (latiendo && !res.writableEnded) {
      try { res.write(' '); } catch { /* conexión ya cerrada */ }
    }
  }, cadaMs);
  // Si el cliente se desconecta a media corrida, dejamos de latir (el proceso de BD
  // sigue; al reimportar continúa por ser idempotente).
  const detener = () => { latiendo = false; clearInterval(latido); };
  res.on('close', detener);
  try {
    const data = await work();
    detener();
    if (!res.writableEnded) { res.write(JSON.stringify(data)); res.end(); }
  } catch (e: any) {
    detener();
    if (res.writableEnded) return;
    const message = (e?.message || 'Error en el proceso.').toString();
    const statusCode = e?.statusCode || 400;
    if (!res.headersSent) {
      res.status(statusCode).json({ success: false, statusCode, message });
    } else {
      try { res.write(JSON.stringify({ success: false, message })); } catch { /* ignore */ }
      res.end();
    }
  }
}

/**
 * Create application error
 */
export class AppException extends Error implements AppError {
  statusCode: number;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppException';

    // Set prototype explicitly for proper instanceof checks
    Object.setPrototypeOf(this, AppException.prototype);
  }
}

/**
 * Validation error
 */
export class ValidationError extends AppException {
  constructor(message: string = 'Validation Error') {
    super(message, 400);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Unauthorized error
 */
export class UnauthorizedError extends AppException {
  constructor(message: string = 'Unauthorized') {
    super(message, 401);
    this.name = 'UnauthorizedError';
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

/**
 * Forbidden error
 */
export class ForbiddenError extends AppException {
  constructor(message: string = 'Forbidden') {
    super(message, 403);
    this.name = 'ForbiddenError';
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

/**
 * Not found error
 */
export class NotFoundError extends AppException {
  constructor(message: string = 'Resource not found') {
    super(message, 404);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Conflict error
 */
export class ConflictError extends AppException {
  constructor(message: string = 'Resource already exists') {
    super(message, 409);
    this.name = 'ConflictError';
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

export default {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  AppException,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
};
