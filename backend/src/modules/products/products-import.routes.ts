/**
 * POST /api/v1/products/import-xml — multipart/form-data, campo "files" (1..N XMLs)
 *
 * Importa los conceptos de los CFDIs al catálogo de productos. Si los XMLs son
 * EMITIDOS por la empresa actual, también actualiza la "memoria" cliente↔producto.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import { importXMLs } from './products-import.service';
import logger from '../../middleware/logger';

const router = Router();
router.use(authenticateToken);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 100 },
});

router.post(
  '/import-xml',
  upload.array('files', 100),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.companyId) throw new ValidationError('Company ID is required');
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      throw new ValidationError('Sube al menos un archivo XML en el campo "files"');
    }

    const xmlFiles = files
      .filter((f) => /\.xml$/i.test(f.originalname) || /xml/i.test(f.mimetype))
      .map((f) => ({ name: f.originalname, buffer: f.buffer }));

    if (xmlFiles.length === 0) {
      throw new ValidationError('Ningún archivo es .xml');
    }

    const summary = await importXMLs(req.user.companyId, xmlFiles);
    logger.info(
      `Import XML: ${summary.files_ok}/${summary.total_files} OK, ` +
      `creados=${summary.products_created} actualizados=${summary.products_updated}`
    );

    res.status(200).json({
      success: summary.files_failed === 0,
      message:
        `Procesados ${summary.files_ok}/${summary.total_files} archivos. ` +
        `Productos creados: ${summary.products_created}, actualizados: ${summary.products_updated}.`,
      data: summary,
    });
  })
);

export default router;
