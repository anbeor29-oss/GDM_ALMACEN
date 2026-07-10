/**
 * PAC Controller
 */

import { Request, Response } from 'express';
import * as pacService from './pac.service';
import { ValidationError } from '../../middleware/errorHandler';
import { MotivoCancelacion } from './pac.interface';

function getCompanyId(req: Request): string {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }
  return req.user.companyId;
}

/**
 * POST /api/v1/pac/stamp/:invoiceId
 * Timbrar factura. El mensaje/provider reales se toman del pac.service —
 * antes venían hardcoded como MOCK y confundían al usuario aunque el
 * timbrado se hubiera hecho contra SW Sapien real.
 */
export async function stamp(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const { invoiceId } = req.params;

  const result = await pacService.stampInvoice(companyId, invoiceId);
  const { active: activeProvider } = pacService.listProviders();
  const isMock = activeProvider === 'MOCK';

  res.status(200).json({
    success: true,
    message: isMock
      ? 'Factura timbrada (MODO SIMULACIÓN - sin validez fiscal)'
      : `Factura timbrada con ${activeProvider}`,
    data: {
      uuid: result.uuid,
      fecha_timbrado: result.fecha_timbrado,
      sello_sat: result.sello_sat?.substring(0, 20) + '...',
      qr_code: result.qr_code,
      provider: activeProvider,
      is_mock: isMock,
    },
  });
}

/**
 * POST /api/v1/pac/cancel/:invoiceId
 * Cancelar factura
 */
export async function cancel(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const { invoiceId } = req.params;
  const { motivo, folioSustitucion, forceLocal } = req.body;

  if (!motivo) {
    throw new ValidationError('motivo es requerido (01, 02, 03, 04)');
  }

  const result = await pacService.cancelInvoice(
    companyId,
    invoiceId,
    motivo as MotivoCancelacion,
    folioSustitucion,
    forceLocal === true
  );

  res.status(200).json({
    success: true,
    message: forceLocal
      ? 'Factura cancelada localmente (sin llamar al PAC)'
      : 'Factura cancelada',
    data: result,
  });
}

/**
 * GET /api/v1/pac/account-status
 * Estado de cuenta del PAC (timbres)
 */
export async function accountStatus(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const status = await pacService.getAccountStatus(companyId);

  res.status(200).json({ success: true, data: status });
}

/**
 * GET /api/v1/pac/test-connection
 * Probar conexión con PAC
 */
export async function testConnection(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const ok = await pacService.testConnection(companyId);

  res.status(200).json({
    success: ok,
    message: ok ? 'Conexión exitosa con PAC' : 'Falló la conexión con PAC',
  });
}

/**
 * GET /api/v1/pac/providers
 * Listar proveedores PAC disponibles
 */
export async function providers(_req: Request, res: Response) {
  const list = pacService.listProviders();
  const isMock = list.active === 'MOCK';

  res.status(200).json({
    success: true,
    message: isMock
      ? 'PAC en modo MOCK — los timbres NO tienen validez fiscal.'
      : `PAC real activo: ${list.active}. Los timbres son reales.`,
    data: {
      ...list,
      is_mock: isMock,
      env_pac_provider: process.env.PAC_PROVIDER || '(no configurado)',
      env_sw_env: process.env.SW_SAPIEN_ENV || '(no configurado)',
      env_sw_token_present: !!process.env.SW_SAPIEN_TOKEN,
    },
  });
}

export default {
  stamp,
  cancel,
  accountStatus,
  testConnection,
  providers,
};
