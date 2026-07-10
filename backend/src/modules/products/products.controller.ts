/**
 * Products Controller
 * HTTP request handlers for products with SAT validation
 */

import { Request, Response } from 'express';
import * as productsService from './products.service';
import { query } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import { searchClaveProdServ, getClaveProdServCount } from './clave-prodserv-index';

/**
 * GET /api/v1/products/next-sku
 * Devuelve el próximo SKU "P-N" para la empresa actual.
 */
export async function getNextSku(req: Request, res: Response) {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  const sku = await productsService.getNextProductSku(req.user.companyId);
  res.status(200).json({ success: true, data: { nextSku: sku } });
}

/**
 * GET /api/v1/products/sat-search?type=prodserv|unidad&q=texto&limit=20
 * Búsqueda en catálogo SAT — autocomplete para combos del frontend.
 */
export async function searchSAT(req: Request, res: Response) {
  const type = String(req.query.type || 'prodserv').toLowerCase();
  const q = String(req.query.q || '').trim();
  const limit = Math.min(parseInt(String(req.query.limit || '20'), 10) || 20, 100);

  const catalog = type === 'unidad' ? 'c_ClaveUnidad' : 'c_ClaveProdServ';
  const like = `%${q}%`;

  // 1) Resultados del catálogo SAT
  // Para c_ClaveProdServ: SI hay índice en memoria (52k claves del SAT),
  // lo usamos en vez de la BD (la BD solo tiene un subset chiquito).
  let catalogRows: Array<{ catalog_key: string; description: string }>;
  if (type !== 'unidad' && getClaveProdServCount() > 100) {
    catalogRows = searchClaveProdServ(q, limit);
  } else {
    const catalogR = await query<{ catalog_key: string; description: string }>(
      `SELECT catalog_key, description
         FROM sat_catalogs
        WHERE catalog_name = $1
          AND (catalog_key ILIKE $2 OR description ILIKE $2)
        ORDER BY
          CASE WHEN catalog_key ILIKE $3 THEN 0 ELSE 1 END,
          LENGTH(description) ASC
        LIMIT $4`,
      [catalog, like, `${q}%`, limit]
    );
    catalogRows = catalogR.rows;
  }

  // 2) Para c_ClaveProdServ además sumamos las claves YA usadas en productos
  //    de la empresa actual (memoria viva: lo que tú facturas/importas).
  //    OJO: la description NO incluye la clave (el frontend ya la muestra a la izquierda).
  let extra: Array<{ catalog_key: string; description: string }> = [];
  if (type !== 'unidad' && req.user?.companyId) {
    const r2 = await query<{ catalog_key: string; description: string }>(
      `SELECT clave_sat AS catalog_key, MAX(name) AS description
         FROM products
        WHERE company_id = $1
          AND clave_sat IS NOT NULL
          AND (clave_sat ILIKE $2 OR name ILIKE $2)
          AND deleted_at IS NULL
        GROUP BY clave_sat
        LIMIT $3`,
      [req.user.companyId, like, limit]
    );
    extra = r2.rows;
  }

  // Merge sin duplicar (las del catálogo SAT tienen prioridad)
  const seen = new Set(catalogRows.map((x) => x.catalog_key));
  const merged = [
    ...catalogRows,
    ...extra.filter((x) => !seen.has(x.catalog_key)),
  ].slice(0, limit);

  res.status(200).json({
    success: true,
    data: { catalog, count: merged.length, entries: merged },
  });
}

/**
 * POST /api/v1/products
 * Create product with SAT validation
 */
export async function createProduct(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const {
    sku,
    name,
    description,
    claveSat,
    unitCode,
    basePrice,
    taxType,
    taxRate,
    isDeductible,
    isExempt,
    appliesIEPS,
    stockQuantity,
    stockMinimum,
    stockMaximum,
    lastCost,
    noIdentificacion,
    currency,
    taxPresetId,
  } = req.body;

  // Validate required fields (SKU es opcional: si falta, el service lo auto-genera "P-N")
  if (!name || !claveSat || !unitCode) {
    throw new ValidationError('Nombre, Clave SAT y Clave Unidad son obligatorios');
  }

  // Create product (SAT validation happens in service)
  const product = await productsService.createProduct(req.user.companyId, {
    sku,
    name,
    description,
    claveSat,
    unitCode,
    basePrice,
    taxType,
    taxRate,
    isDeductible,
    isExempt,
    appliesIEPS,
    stockQuantity,
    stockMinimum,
    stockMaximum,
    lastCost,
    noIdentificacion,
    currency,
    taxPresetId,
  });

  res.status(201).json({
    success: true,
    message: 'Product created successfully with SAT validation',
    data: product,
  });
}

/**
 * GET /api/v1/products/:id
 * Get product by ID
 */
export async function getProduct(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { id } = req.params;
  const result = await productsService.getProductWithSATDetails(req.user.companyId, id);

  res.status(200).json({
    success: true,
    data: result,
  });
}

/**
 * GET /api/v1/products
 * List products with filters
 */
export async function listProducts(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const search = req.query.search as string | undefined;
  const sortBy = (req.query.sortBy as string) || 'created_at';
  const sortOrder = (req.query.sortOrder as 'ASC' | 'DESC') || 'DESC';

  if (page < 1 || limit < 1) {
    throw new ValidationError('Page and limit must be positive numbers');
  }

  const offset = (page - 1) * limit;

  const { products, total } = await productsService.listProducts(req.user.companyId, {
    search,
    limit,
    offset,
    sortBy: sortBy as any,
    sortOrder,
  });

  res.status(200).json({
    success: true,
    data: {
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    },
  });
}

/**
 * PUT /api/v1/products/:id
 * Update product with SAT validation
 */
export async function updateProduct(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { id } = req.params;
  const updateData = req.body;

  const product = await productsService.updateProduct(req.user.companyId, id, updateData);

  res.status(200).json({
    success: true,
    message: 'Product updated successfully',
    data: product,
  });
}

/**
 * DELETE /api/v1/products/:id
 * Delete product (soft delete)
 */
export async function deleteProduct(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { id } = req.params;

  await productsService.deleteProduct(req.user.companyId, id);

  res.status(200).json({
    success: true,
    message: 'Product deleted successfully',
  });
}

/**
 * GET /api/v1/products/catalogs/claves
 * Get SAT product classification codes (c_ClaveProdServ)
 */
export async function getSATProductCodes(req: Request, res: Response) {
  const catalogs = await productsService.getSATCatalogs('products');

  res.status(200).json({
    success: true,
    data: catalogs,
    totalCodes: catalogs.length,
  });
}

/**
 * GET /api/v1/products/catalogs/units
 * Get SAT measurement units (c_ClaveUnidad)
 */
export async function getSATUnits(req: Request, res: Response) {
  const catalogs = await productsService.getSATCatalogs('units');

  res.status(200).json({
    success: true,
    data: catalogs,
    totalUnits: catalogs.length,
  });
}

/**
 * GET /api/v1/products/catalogs/taxes
 * Get SAT tax types (c_Impuesto)
 */
export async function getSATTaxes(req: Request, res: Response) {
  const catalogs = await productsService.getSATCatalogs('taxes');

  res.status(200).json({
    success: true,
    data: catalogs,
  });
}

/**
 * GET /api/v1/products/catalogs/rates
 * Get SAT tax rates (c_TasaOCuota)
 */
export async function getSATRates(req: Request, res: Response) {
  const catalogs = await productsService.getSATCatalogs('rates');

  res.status(200).json({
    success: true,
    data: catalogs,
    totalRates: catalogs.length,
  });
}

/**
 * GET /api/v1/products/search/:clavesat
 * Search products by SAT Clave
 */
export async function searchByClavesat(req: Request, res: Response) {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }

  const { clavesat } = req.params;

  const products = await productsService.searchProductsByClavesat(req.user.companyId, clavesat);

  res.status(200).json({
    success: true,
    data: products,
    count: products.length,
  });
}

export default {
  getNextSku,
  searchSAT,
  createProduct,
  getProduct,
  listProducts,
  updateProduct,
  deleteProduct,
  getSATProductCodes,
  getSATUnits,
  getSATTaxes,
  getSATRates,
  searchByClavesat,
};
