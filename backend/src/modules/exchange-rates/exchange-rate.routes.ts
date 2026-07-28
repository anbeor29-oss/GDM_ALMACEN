/**
 * exchange-rate.routes — API interna de tipos de cambio.
 *
 *   GET  /exchange-rates                 → cuadro de las 4 monedas
 *   GET  /exchange-rates/log             → bitácora de actualizaciones
 *   GET  /exchange-rates/:moneda         → TC vigente (o de una fecha)
 *   GET  /exchange-rates/:moneda/history → histórico
 *   POST /exchange-rates/update          → forzar consulta a Banxico
 *   POST /exchange-rates/manual          → captura manual
 *
 * Consultar es de cualquier usuario autenticado (la pantalla de factura lo
 * necesita). Escribir es de ADMIN: un tipo de cambio equivocado altera la
 * base gravable de todo lo que se emita ese día.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import {
  getExchangeRate, getHistory, getLog, getResumen,
  setManualRate, updateExchangeRate, updateExchangeRates,
  MONEDAS, type Moneda,
} from './exchange-rate.service';

const router = Router();
router.use(authenticateToken);

function soloAdmin(req: Request) {
  const rol = req.user?.role;
  if (rol !== 'ADMIN' && rol !== 'SUPER_ADMIN') {
    throw new ValidationError('Solo un administrador puede modificar tipos de cambio');
  }
}

function parseMoneda(v: unknown): Moneda {
  const m = String(v || '').toUpperCase();
  if (!MONEDAS.includes(m as Moneda)) {
    throw new ValidationError(`Moneda no soportada: ${m}. Disponibles: ${MONEDAS.join(', ')}`);
  }
  return m as Moneda;
}

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await getResumen(req.query.fecha as string | undefined) });
}));

router.get('/log', asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await getLog(Number(req.query.limit) || 50) });
}));

router.post('/update', asyncHandler(async (req: Request, res: Response) => {
  soloAdmin(req);
  const moneda = req.body?.moneda;
  if (moneda) {
    res.json({ actualizadas: [await updateExchangeRate(parseMoneda(moneda), 'MANUAL')], fallidas: [] });
    return;
  }
  res.json(await updateExchangeRates('MANUAL'));
}));

router.post('/manual', asyncHandler(async (req: Request, res: Response) => {
  soloAdmin(req);
  const { moneda, fecha, valor } = req.body || {};
  const r = await setManualRate(
    parseMoneda(moneda),
    String(fecha || ''),
    Number(valor),
    req.user?.email || 'desconocido',
  );
  res.status(201).json(r);
}));

// Va al final: si estuviera antes, /log y /update entrarían aquí como si
// fueran nombres de moneda.
router.get('/:moneda', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getExchangeRate(parseMoneda(req.params.moneda), req.query.fecha as string | undefined));
}));

router.get('/:moneda/history', asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await getHistory(parseMoneda(req.params.moneda), Number(req.query.limit) || 60) });
}));

export default router;
