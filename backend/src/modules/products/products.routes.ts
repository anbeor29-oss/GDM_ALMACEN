/**
 * Products Routes with SAT Catalog Integration
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as productsController from './products.controller';
import * as plantilla from './products-plantilla.service';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';

const router = Router();
const uploadXlsx = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// All routes require authentication
router.use(authenticateToken);

/**
 * GET /api/v1/products/next-sku
 * Preview del siguiente SKU automático "P-N" para la empresa.
 */
router.get(
  '/next-sku',
  asyncHandler(productsController.getNextSku)
);

/**
 * GET /api/v1/products/sat-search?type=prodserv|unidad&q=texto
 * Búsqueda de claves SAT (autocomplete) por código o descripción.
 */
router.get(
  '/sat-search',
  asyncHandler(productsController.searchSAT)
);

/**
 * GET /api/v1/products/plantilla.xlsx
 * Exporta los productos actuales en una plantilla Excel (editable y re-cargable).
 */
router.get('/plantilla.xlsx', asyncHandler(async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId;
  if (!companyId) throw new ValidationError('Company ID is required');
  const { buffer, nombre } = await plantilla.plantillaProductosExcel(companyId);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(buffer);
}));

/**
 * POST /api/v1/products/importar-plantilla  (multipart: file = .xlsx)
 * Carga productos en lote desde la plantilla Excel (crea/actualiza por SKU).
 */
router.post('/importar-plantilla', uploadXlsx.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const companyId = (req as any).user?.companyId;
  if (!companyId) throw new ValidationError('Company ID is required');
  const file = (req as any).file;
  if (!file?.buffer) throw new ValidationError('Sube el archivo Excel (.xlsx) de la plantilla.');
  const data = await plantilla.importarProductosExcel(companyId, file.buffer);
  res.json({ success: true, data });
}));

/**
 * POST /api/v1/products
 * Create product with SAT validation
 */
router.post(
  '/',
  asyncHandler(productsController.createProduct)
);

/**
 * GET /api/v1/products
 * List products with filters
 */
router.get(
  '/',
  asyncHandler(productsController.listProducts)
);

/**
 * GET /api/v1/products/catalogs/claves
 * Get SAT product classification codes
 */
router.get(
  '/catalogs/claves',
  asyncHandler(productsController.getSATProductCodes)
);

/**
 * GET /api/v1/products/catalogs/units
 * Get SAT measurement units
 */
router.get(
  '/catalogs/units',
  asyncHandler(productsController.getSATUnits)
);

/**
 * GET /api/v1/products/catalogs/taxes
 * Get SAT tax types
 */
router.get(
  '/catalogs/taxes',
  asyncHandler(productsController.getSATTaxes)
);

/**
 * GET /api/v1/products/catalogs/rates
 * Get SAT tax rates
 */
router.get(
  '/catalogs/rates',
  asyncHandler(productsController.getSATRates)
);

/**
 * GET /api/v1/products/search/:clavesat
 * Search products by SAT Clave
 */
router.get(
  '/search/:clavesat',
  asyncHandler(productsController.searchByClavesat)
);

/**
 * GET /api/v1/products/:id
 * Get product by ID with SAT details
 */
router.get(
  '/:id',
  asyncHandler(productsController.getProduct)
);

/**
 * PUT /api/v1/products/:id
 * Update product with SAT validation
 */
router.put(
  '/:id',
  asyncHandler(productsController.updateProduct)
);

/**
 * DELETE /api/v1/products/:id
 * Delete product (soft delete)
 */
router.delete(
  '/:id',
  asyncHandler(productsController.deleteProduct)
);

export default router;
