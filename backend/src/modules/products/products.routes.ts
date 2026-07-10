/**
 * Products Routes with SAT Catalog Integration
 */

import { Router } from 'express';
import * as productsController from './products.controller';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler } from '../../middleware/errorHandler';

const router = Router();

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
