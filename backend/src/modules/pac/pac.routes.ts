/**
 * PAC Routes
 *
 * NOTA: PAC en modo MOCK (simulación). La integración con un PAC real
 * está pendiente hasta validar el flujo completo y elegir proveedor.
 */

import { Router } from 'express';
import * as pacController from './pac.controller';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler } from '../../middleware/errorHandler';

const router = Router();

router.use(authenticateToken);

// Específicas primero
router.get('/providers', asyncHandler(pacController.providers));
router.get('/account-status', asyncHandler(pacController.accountStatus));
router.get('/test-connection', asyncHandler(pacController.testConnection));

router.post('/stamp/:invoiceId', asyncHandler(pacController.stamp));
router.post('/cancel/:invoiceId', asyncHandler(pacController.cancel));

export default router;
