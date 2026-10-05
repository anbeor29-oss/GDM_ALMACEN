/**
 * /admin/satgo — configuración del proveedor fiscal SatGo (sólo SUPER_ADMIN).
 *
 *  GET   /admin/satgo/config      URL base, ambiente, si ya hay API key
 *  PUT   /admin/satgo/config      actualiza URL base / ambiente
 *  POST  /admin/satgo/bootstrap   { portalToken } → CreateKey → guarda la API key PERMANENTE cifrada
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler } from '../../middleware/errorHandler';
import { requireSuperAdmin, audit } from '../admin/admin.middleware';
import * as satgo from './satgo.service';
import * as fx from '../exchange-rates/exchange-rate.service';
import * as indicadores from '../accounting/indicadores.service';

const router = Router();
router.use(authenticateToken);
router.use(requireSuperAdmin);

router.get('/config', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await satgo.getConfig() });
}));

/**
 * GET /admin/satgo/conectores — tablero de TODOS los servicios externos de los
 * que depende NEXO, para vigilar de un vistazo si alguno cambió o dejó de
 * responder (es lo que pidió "coloca todos los conectores, para que se tenga en
 * cuenta cualquier cambio"):
 *   · SAT        — vía SatGo (CIF/CSF, 32-D, IMSS…).
 *   · Banco de México — tipo de cambio FIX/DOF (Art. 20 CFF). Token BANXICO_TOKEN.
 *   · INEGI      — INPC (actualización, recargos, pérdidas). Token INEGI_TOKEN.
 * Nunca rompe: cada bloque cae a "sin dato" si su servicio falla.
 */
router.get('/conectores', asyncHandler(async (_req: Request, res: Response) => {
  const satgoCfg = await satgo.getConfig().catch(() => null as any);

  // Banco de México — tipo de cambio.
  let banxico: any = { token: !!process.env.BANXICO_TOKEN };
  try {
    const log = await fx.getLog(30);
    const ok = log.find((l: any) => l.resultado === 'OK');
    const err = log.find((l: any) => l.resultado === 'ERROR');
    const usd = (await fx.getResumen()).find((r: any) => r.moneda === 'USD');
    banxico = {
      token: !!process.env.BANXICO_TOKEN,
      ultimaOk: ok?.ejecutadoEn ?? null,
      ultimoError: err ? { cuando: err.ejecutadoEn, detalle: err.detalle } : null,
      usd: usd ? { valor: (usd as any).valor, fecha: (usd as any).fecha, vigente: (usd as any).vigente } : null,
    };
  } catch { /* panel informativo: no debe tumbar nada */ }

  // INEGI — INPC.
  let inegi: any = { token: !!(process.env.INEGI_TOKEN || process.env.INEGI_INPC_URL) };
  try {
    const r = await indicadores.resumen();
    inegi = { token: r.tieneToken, inpc: r.inpc };
  } catch { /* idem */ }

  res.json({
    success: true,
    data: {
      satgo: satgoCfg
        ? { token: !!satgoCfg.tieneKey, baseUrl: satgoCfg.baseUrl, ambiente: satgoCfg.ambiente, bovedaLista: !!satgoCfg.bovedaLista }
        : null,
      banxico,
      inegi,
    },
  });
}));

router.put('/config', asyncHandler(async (req: Request, res: Response) => {
  const data = await satgo.setConfig({ baseUrl: req.body?.baseUrl, ambiente: req.body?.ambiente });
  await audit(req, { action: 'SATGO_CONFIG', targetKind: 'satgo_config', payload: { baseUrl: data.baseUrl, ambiente: data.ambiente } });
  res.json({ success: true, data });
}));

router.post('/bootstrap', asyncHandler(async (req: Request, res: Response) => {
  const data = await satgo.bootstrapApiKey(String(req.body?.portalToken || ''));
  await audit(req, { action: 'SATGO_BOOTSTRAP', targetKind: 'satgo_config' });
  res.json({ success: true, data });
}));

export default router;
