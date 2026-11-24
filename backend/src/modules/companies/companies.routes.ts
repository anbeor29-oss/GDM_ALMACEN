/**
 * Companies Routes
 */

import { Router } from 'express';
import * as companiesController from './companies.controller';
import { authenticateToken, authorize } from '../../middleware/authentication';
import { asyncHandler } from '../../middleware/errorHandler';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * POST /api/v1/companies
 * Create company (admin only)
 */
router.post(
  '/',
  authorize('ADMIN'),
  asyncHandler(companiesController.createCompany)
);

/**
 * GET /api/v1/companies
 * List companies (admin only)
 */
router.get(
  '/',
  authorize('ADMIN'),
  asyncHandler(companiesController.listCompanies)
);

/**
 * GET /api/v1/companies/:id
 * Get company by ID
 */
router.get(
  '/:id',
  asyncHandler(companiesController.getCompany)
);

/**
 * PUT /api/v1/companies/:id
 * Update company
 */
router.put(
  '/:id',
  asyncHandler(companiesController.updateCompany)
);

/**
 * DELETE /api/v1/companies/:id
 * Delete company (admin only)
 */
router.delete(
  '/:id',
  authorize('ADMIN'),
  asyncHandler(companiesController.deleteCompany)
);

/**
 * PATCH /api/v1/companies/:id/smtp — actualiza configuración SMTP de la empresa
 * Body: { mail_host, mail_port, mail_secure, mail_user, mail_pass, mail_from }
 * La password se cifra con AES-256-GCM antes de guardar.
 */
router.patch(
  '/:id/smtp',
  authorize('ADMIN'),
  asyncHandler(companiesController.updateSMTP),
);

/**
 * POST /api/v1/companies/:id/smtp/test — envía un correo de prueba al ADMIN.
 * Usa el SMTP configurado en la empresa (si existe) para verificar creds.
 */
router.post(
  '/:id/smtp/test',
  authorize('ADMIN'),
  asyncHandler(companiesController.testSMTP),
);

/**
 * PATCH /api/v1/companies/:id/mail-mensaje — párrafo de la casa y bloque de
 * depósito (encendido/apagado) para los correos que manda esta empresa.
 */
router.patch(
  '/:id/mail-mensaje',
  authorize('ADMIN'),
  asyncHandler(companiesController.updateMailMensaje),
);

export default router;
