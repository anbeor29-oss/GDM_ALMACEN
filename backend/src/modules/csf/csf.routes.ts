/**
 * CSF Routes — sube un PDF de Constancia de Situación Fiscal y devuelve campos.
 *
 * POST /csf/extract  (multipart/form-data, campo "pdf")
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import { extractCSFRaw, mapCSFToCustomer } from './csf.service';
import logger from '../../middleware/logger';

const router = Router();
router.use(authenticateToken);

// Hasta 5 MB; CSF reales suelen ser <500 KB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post(
  '/extract',
  upload.single('pdf'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new ValidationError('Falta el archivo PDF (campo "pdf")');
    }
    if (req.file.mimetype && !req.file.mimetype.includes('pdf')) {
      throw new ValidationError(`Tipo de archivo no soportado: ${req.file.mimetype}`);
    }

    const raw = await extractCSFRaw(req.file.buffer);
    const mapped = await mapCSFToCustomer(raw);

    logger.info(`CSF extraída: RFC=${raw.rfc} | régimen "${raw.regimen}" → ${mapped.fiscalRegime}`);

    res.status(200).json({
      success: true,
      message: 'CSF procesada',
      data: mapped,
    });
  })
);

export default router;
