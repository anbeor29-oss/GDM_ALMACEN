/**
 * /contract — contrato de prestación de servicios firmado con e.firma.
 *
 *  GET  /contract          estado: texto vigente + firma (si existe)
 *  POST /contract/sign     firma con e.firma { cerB64, keyB64, password }
 *  GET  /contract/verify   recalcula el hash del texto guardado (integridad)
 *
 * La empresa se toma SIEMPRE del JWT — nadie firma el contrato de otra.
 * Firmar es un acto del contratante: se exige rol ADMIN (el USER no obliga a
 * la empresa). El SUPER_ADMIN no firma por el cliente.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as contractsService from './contracts.service';
import { audit } from '../admin/admin.middleware';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

/** Solo el ADMIN de la empresa obliga contractualmente a la empresa. */
function requireCompanyAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Solo el administrador de la empresa puede firmar el contrato',
    });
  }
  return next();
}

/* Estado del contrato: qué dice hoy y si ya se firmó. */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const data = await contractsService.getContractStatus(companyId(req));
  res.status(200).json({ success: true, data });
}));

/* Firma con e.firma del contratante. */
router.post('/sign', requireCompanyAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { cerB64, keyB64, password } = req.body as any;
  const result = await contractsService.signContract({
    companyId: companyId(req),
    userId: req.user!.userId,
    cerB64, keyB64, password,
    ip: req.ip || req.socket?.remoteAddress,
    userAgent: String(req.headers['user-agent'] || ''),
  });

  // La contraseña de la e.firma NO entra al payload: audit() la redactaría de
  // todos modos, pero no se envía siquiera.
  await audit(req, {
    action: 'CONTRACT_SIGNED', targetKind: 'company', targetId: companyId(req),
    payload: { version: result.version, signerRfc: result.signerRfc, sha256: result.contractSha256 },
  });

  res.status(201).json({
    success: true,
    message: 'Contrato firmado con e.firma.',
    data: result,
  });
}));

/* Integridad del contrato guardado. */
router.get('/verify', asyncHandler(async (req: Request, res: Response) => {
  const data = await contractsService.verifyContract(companyId(req));
  res.status(200).json({ success: true, data });
}));

/* ─── Documentos públicos (Aviso de Privacidad y texto de T&C vigente) ─── */
export const publicLegalRouter = Router();

publicLegalRouter.get('/privacy-notice', asyncHandler(async (_req: Request, res: Response) => {
  const { PRIVACY_VERSION, buildPrivacyNoticeText } = await import('./privacy-notice-text');
  res.type('text/plain; charset=utf-8').set('X-Version', PRIVACY_VERSION).send(buildPrivacyNoticeText());
}));

publicLegalRouter.get('/terms', asyncHandler(async (_req: Request, res: Response) => {
  // Texto vigente sin datos de cliente (para consulta pública). El texto con
  // datos del cliente se sirve solo autenticado en GET /contract.
  const { CONTRACT_VERSION, buildContractText, PROVIDER } = await import('./contract-text');
  const text = buildContractText({
    client: { rfc: '[RFC DEL CLIENTE]', businessName: '[RAZÓN SOCIAL DEL CLIENTE]' },
    signedAt: new Date('2026-07-20T00:00:00-06:00'),
  }).replace(/^Fecha de aceptación: .*$/m, 'Fecha de aceptación: [se genera al firmar]');
  res.type('text/plain; charset=utf-8')
    .set('X-Version', CONTRACT_VERSION)
    .set('X-Provider-Rfc', PROVIDER.rfc)
    .send(text);
}));

export default router;
