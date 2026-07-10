/**
 * Catálogos SAT — endpoint genérico de consulta
 * GET /catalogs/:name  → lista entradas activas del catálogo (key + descripción)
 *
 * Acepta los nombres oficiales SAT (c_RegimenFiscal, c_UsoCFDI, c_Estado, ...)
 * o aliases cortos (regimenFiscal | usoCfdi | estado | formaPago | etc).
 */

import { Router, Request, Response } from 'express';
import { query } from '../../config/database';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';

const router = Router();
router.use(authenticateToken);

// Alias amigables → nombre oficial SAT
const ALIASES: Record<string, string> = {
  regimenfiscal: 'c_RegimenFiscal',
  c_regimenfiscal: 'c_RegimenFiscal',
  usocfdi: 'c_UsoCFDI',
  c_usocfdi: 'c_UsoCFDI',
  estado: 'c_Estado',
  c_estado: 'c_Estado',
  formapago: 'c_FormaPago',
  c_formapago: 'c_FormaPago',
  metodopago: 'c_MetodoPago',
  c_metodopago: 'c_MetodoPago',
  moneda: 'c_Moneda',
  c_moneda: 'c_Moneda',
  claveunidad: 'c_ClaveUnidad',
  c_claveunidad: 'c_ClaveUnidad',
  claveprodserv: 'c_ClaveProdServ',
  c_claveprodserv: 'c_ClaveProdServ',
  impuesto: 'c_Impuesto',
  c_impuesto: 'c_Impuesto',
  tasaocuota: 'c_TasaOCuota',
  c_tasaocuota: 'c_TasaOCuota',
};

router.get(
  '/:name',
  asyncHandler(async (req: Request, res: Response) => {
    const raw = (req.params.name || '').trim();
    const resolved = ALIASES[raw.toLowerCase()] || raw;

    if (!/^c_[A-Za-z]+$/.test(resolved)) {
      throw new ValidationError(
        `Catálogo no reconocido: "${raw}". Usa el nombre oficial (c_RegimenFiscal, c_UsoCFDI, ...) o un alias.`
      );
    }

    const result = await query<{ catalog_key: string; description: string }>(
      `SELECT catalog_key, description
         FROM sat_catalogs
        WHERE catalog_name = $1
          AND (vigence_end IS NULL OR vigence_end > NOW())
        ORDER BY catalog_key ASC`,
      [resolved]
    );

    res.status(200).json({
      success: true,
      data: {
        catalog: resolved,
        count: result.rows.length,
        entries: result.rows,
      },
    });
  })
);

export default router;
