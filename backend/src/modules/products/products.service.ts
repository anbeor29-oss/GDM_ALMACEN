/**
 * Products Service
 * Business logic for product management with SAT catalog validation
 */

import { query } from '../../config/database';
import { ConflictError, NotFoundError, ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import { Product } from '../../types';

/**
 * Validate SAT Clave Producto/Servicio (c_ClaveProdServ)
 */
export async function validateSATClaveProdServ(clavesat: string): Promise<any> {
  // 1) Índice en memoria con las 52,513 claves del SAT (fuente principal).
  //    Lo importamos perezosamente para evitar ciclos.
  try {
    const { searchClaveProdServ, getClaveProdServCount } = await import('./clave-prodserv-index');
    if (getClaveProdServCount() > 100) {
      const hit = searchClaveProdServ(clavesat, 1).find((e) => e.catalog_key === clavesat);
      if (hit) {
        return { catalog_key: hit.catalog_key, description: hit.description };
      }
      // Si el índice está cargado y la clave NO está → es inválida de verdad
      throw new ValidationError(`Clave SAT de producto no válida: ${clavesat}. No existe en catálogo SAT.`);
    }
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    // Si el índice no cargó por alguna razón, caer al fallback de BD.
  }

  // 2) Fallback: BD (cuando el índice no está disponible)
  const result = await query(
    `SELECT * FROM sat_catalogs
     WHERE catalog_name = 'c_ClaveProdServ'
       AND catalog_key = $1
       AND (vigence_end IS NULL OR vigence_end > NOW())`,
    [clavesat]
  );

  if (result.rows.length === 0) {
    throw new ValidationError(`Clave SAT de producto no válida: ${clavesat}. No existe en catálogo SAT.`);
  }

  return result.rows[0];
}

/**
 * Validate SAT Clave Unidad (c_ClaveUnidad)
 */
export async function validateSATClaveUnidad(unitCode: string): Promise<any> {
  const result = await query(
    `SELECT * FROM sat_catalogs
     WHERE catalog_name = 'c_ClaveUnidad'
       AND catalog_key = $1
       AND (vigence_end IS NULL OR vigence_end > NOW())`,
    [unitCode]
  );

  if (result.rows.length === 0) {
    throw new ValidationError(`Unidad de medida no válida: ${unitCode}. No existe en catálogo SAT.`);
  }

  return result.rows[0];
}

/**
 * Validate SAT Impuesto (c_Impuesto)
 */
export async function validateSATImpuesto(impuesto: string): Promise<any> {
  const result = await query(
    `SELECT * FROM sat_catalogs
     WHERE catalog_name = 'c_Impuesto'
       AND catalog_key = $1
       AND (vigence_end IS NULL OR vigence_end > NOW())`,
    [impuesto]
  );

  if (result.rows.length === 0) {
    throw new ValidationError(`Tipo de impuesto no válido: ${impuesto}. No existe en catálogo SAT.`);
  }

  return result.rows[0];
}

/**
 * Validate SAT Tasa o Cuota (c_TasaOCuota)
 */
export async function validateSATTasaOCuota(tasa: number): Promise<any> {
  const tasaStr = tasa.toString();

  const result = await query(
    `SELECT * FROM sat_catalogs
     WHERE catalog_name = 'c_TasaOCuota'
       AND catalog_key = $1
       AND (vigence_end IS NULL OR vigence_end > NOW())`,
    [tasaStr]
  );

  if (result.rows.length === 0) {
    logger.warn(`Tasa SAT no encontrada exactamente: ${tasa}. Permitiendo igualmente (puede ser válida).`);
    // En producción podrías ser más estricto aquí
    return { catalog_key: tasaStr };
  }

  return result.rows[0];
}

/**
 * Get SAT Catalogs for dropdowns/selects
 */
export async function getSATCatalogs(type: 'products' | 'units' | 'taxes' | 'rates') {
  const catalogNames: { [key: string]: string } = {
    products: 'c_ClaveProdServ',
    units: 'c_ClaveUnidad',
    taxes: 'c_Impuesto',
    rates: 'c_TasaOCuota',
  };

  const catalogName = catalogNames[type];
  if (!catalogName) {
    throw new ValidationError('Invalid catalog type');
  }

  const result = await query(
    `SELECT catalog_key, description FROM sat_catalogs
     WHERE catalog_name = $1
       AND (vigence_end IS NULL OR vigence_end > NOW())
     ORDER BY catalog_key ASC`,
    [catalogName]
  );

  return result.rows;
}

/**
 * Próximo SKU automático estilo "P-N" para una empresa.
 * Toma el mayor N actual de SKUs que matchen /^P-(\d+)$/ y suma 1.
 */
export async function getNextProductSku(companyId: string): Promise<string> {
  const r = await query<{ max_n: number | null }>(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(sku FROM '^P-(\\d+)$') AS INTEGER)), 0) AS max_n
       FROM products
      WHERE company_id = $1
        AND sku ~ '^P-\\d+$'
        AND deleted_at IS NULL`,
    [companyId]
  );
  const n = (r.rows[0]?.max_n ?? 0) + 1;
  return `P-${n}`;
}

/**
 * Create product with SAT validation. Si `sku` viene vacío, se auto-genera.
 */
export async function createProduct(companyId: string, data: {
  sku?: string;               // opcional — si falta, se auto-genera "P-N"
  name: string;
  description?: string;
  claveSat: string;           // Debe validarse contra c_ClaveProdServ
  unitCode: string;           // Debe validarse contra c_ClaveUnidad
  basePrice?: number;
  taxType?: string;           // IVA, IEPS, etc - validar contra c_Impuesto
  taxRate?: number;           // Validar contra c_TasaOCuota
  isDeductible?: boolean;
  isExempt?: boolean;
  appliesIEPS?: boolean;
  stockQuantity?: number;
  stockMinimum?: number;
  stockMaximum?: number;
  lastCost?: number;
  noIdentificacion?: string;  // NoIdentificacion del CFDI cuando aplica
  currency?: string;          // ISO 4217: 'MXN', 'USD', 'EUR', etc. (c_Moneda)
  taxPresetId?: string;       // preset del catálogo de impuestos (iva16/hon_pf_pm/resico_pf_pm/…)
}): Promise<Product> {
  // Validate SAT Clave Producto/Servicio
  logger.info(`Validando clave SAT de producto: ${data.claveSat}`);
  const satClaveProduct = await validateSATClaveProdServ(data.claveSat);

  // Validate SAT Clave Unidad
  logger.info(`Validando unidad de medida: ${data.unitCode}`);
  const satClaveUnidad = await validateSATClaveUnidad(data.unitCode);

  // Validate tax type if provided
  if (data.taxType) {
    logger.info(`Validando tipo de impuesto: ${data.taxType}`);
    await validateSATImpuesto(data.taxType);
  }

  // Validate tax rate if provided
  if (data.taxRate !== undefined) {
    logger.info(`Validando tasa de impuesto: ${data.taxRate}`);
    await validateSATTasaOCuota(data.taxRate);
  }

  // SKU: si viene vacío o nulo, se auto-genera como "P-N" (N consecutivo por empresa)
  let sku = (data.sku || '').toString().trim().toUpperCase();
  if (!sku) {
    sku = await getNextProductSku(companyId);
  }

  // Check if SKU already exists in company
  const existing = await query<Product>(
    'SELECT id FROM products WHERE company_id = $1 AND sku = $2 AND deleted_at IS NULL',
    [companyId, sku]
  );

  if (existing.rows.length > 0) {
    throw new ConflictError('Product with this SKU already exists in this company');
  }

  // Anti-duplicados (requerimiento ALMACEN): mismo (clave SAT + nombre
  // normalizado) = mismo producto aunque el SKU sea distinto — es el criterio
  // de match que usa la importación de XML de compras. Sin este guard, una
  // alta manual duplicaría el producto y partiría sus existencias en dos.
  const nameNorm = (data.name || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const dupName = await query<{ sku: string }>(
    `SELECT sku FROM products
      WHERE company_id = $1 AND clave_sat = $2
        AND UPPER(REGEXP_REPLACE(TRIM(name), '\\s+', ' ', 'g')) = $3
        AND deleted_at IS NULL
      LIMIT 1`,
    [companyId, data.claveSat, nameNorm]
  );
  if (dupName.rows.length > 0) {
    throw new ConflictError(
      `Ya existe un producto con la misma clave SAT y nombre (SKU ${dupName.rows[0].sku}). ` +
      `Usa ese producto o cambia el nombre si realmente es distinto.`
    );
  }

  // Insert product with SAT references
  const result = await query<Product>(
    `INSERT INTO products
     (company_id, sku, name, description, clave_sat, unit_code, unit_name,
      base_price, tax_type, tax_rate, is_deductible, is_exempt, applies_ieps,
      stock_quantity, stock_minimum, stock_maximum, last_cost, no_identificacion, currency,
      tax_preset_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, true)
     RETURNING *`,
    [
      companyId,
      sku,
      data.name,
      data.description,
      data.claveSat,                           // Validado contra SAT
      data.unitCode,                           // Validado contra SAT
      satClaveUnidad.description,              // Nombre de la unidad del catálogo
      data.basePrice || 0,
      data.taxType,
      data.taxRate,
      data.isDeductible !== false,
      data.isExempt || data.taxType === 'EXENTO' || false,
      data.appliesIEPS || data.taxType === 'IEPS' || false,
      data.stockQuantity || 0,
      data.stockMinimum || 0,
      data.stockMaximum || 0,
      data.lastCost || 0,
      (data as any).noIdentificacion || null,
      data.currency || 'MXN',
      data.taxPresetId || null,
    ]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create product');
  }

  logger.info(`Product created: ${data.sku} (SAT Clave: ${data.claveSat})`);

  return result.rows[0];
}

/**
 * Get product by ID
 */
export async function getProductById(companyId: string, productId: string): Promise<Product> {
  const result = await query<Product>(
    'SELECT * FROM products WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL',
    [productId, companyId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Product not found');
  }

  return result.rows[0];
}

/**
 * Get product by SKU
 */
export async function getProductBySKU(companyId: string, sku: string): Promise<Product> {
  const result = await query<Product>(
    'SELECT * FROM products WHERE company_id = $1 AND sku = $2 AND deleted_at IS NULL',
    [companyId, sku.toUpperCase()]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Product not found');
  }

  return result.rows[0];
}

/**
 * List products with filters
 */
export async function listProducts(
  companyId: string,
  options: {
    search?: string;
    active?: boolean;
    limit?: number;
    offset?: number;
    sortBy?: 'name' | 'sku' | 'price' | 'created_at';
    sortOrder?: 'ASC' | 'DESC';
  } = {}
): Promise<{ products: Product[]; total: number }> {
  const {
    search,
    active = true,
    limit = 10,
    offset = 0,
    sortBy = 'created_at',
    sortOrder = 'DESC',
  } = options;

  let whereClause = 'WHERE company_id = $1 AND deleted_at IS NULL';
  const params: any[] = [companyId];
  let paramCount = 2;

  if (active !== undefined) {
    whereClause += ` AND is_active = $${paramCount++}`;
    params.push(active);
  }

  if (search) {
    whereClause += ` AND (name ILIKE $${paramCount} OR sku ILIKE $${paramCount} OR clave_sat ILIKE $${paramCount})`;
    params.push(`%${search}%`);
    paramCount++;
  }

  const validSortFields = ['name', 'sku', 'price', 'created_at'];
  const validSortOrders = ['ASC', 'DESC'];

  if (!validSortFields.includes(sortBy) || !validSortOrders.includes(sortOrder)) {
    throw new ValidationError('Invalid sort parameters');
  }

  const sortFieldMap = {
    name: 'name',
    sku: 'sku',
    price: 'base_price',
    created_at: 'created_at',
  };

  const sortField = sortFieldMap[sortBy as keyof typeof sortFieldMap];

  const productsResult = await query<Product>(
    `SELECT * FROM products ${whereClause}
     ORDER BY ${sortField} ${sortOrder}
     LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
    [...params, limit, offset]
  );

  const totalResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM products ${whereClause}`,
    params
  );

  const total = parseInt(totalResult.rows[0].count, 10);

  return {
    products: productsResult.rows,
    total,
  };
}

/**
 * Update product with SAT validation
 */
export async function updateProduct(
  companyId: string,
  productId: string,
  data: Partial<Product>
): Promise<Product> {
  const product = await getProductById(companyId, productId);

  // Validate new SAT clave if changed
  if (data.clave_sat && data.clave_sat !== product.clave_sat) {
    logger.info(`Revalidating SAT clave: ${data.clave_sat}`);
    await validateSATClaveProdServ(data.clave_sat);
  }

  // Validate new unit code if changed
  if (data.unit_code && data.unit_code !== product.unit_code) {
    logger.info(`Revalidating unit code: ${data.unit_code}`);
    await validateSATClaveUnidad(data.unit_code);
  }

  // Validate new tax type if changed
  if (data.tax_type && data.tax_type !== product.tax_type) {
    logger.info(`Revalidating tax type: ${data.tax_type}`);
    await validateSATImpuesto(data.tax_type);
  }

  // Validate new tax rate if changed
  if (data.tax_rate !== undefined && data.tax_rate !== product.tax_rate) {
    logger.info(`Revalidating tax rate: ${data.tax_rate}`);
    await validateSATTasaOCuota(data.tax_rate);
  }

  // Build update query
  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (data.sku) {
    fields.push(`sku = $${paramCount++}`);
    values.push(data.sku.toUpperCase());
  }
  if (data.name) {
    fields.push(`name = $${paramCount++}`);
    values.push(data.name);
  }
  if (data.description !== undefined) {
    fields.push(`description = $${paramCount++}`);
    values.push(data.description);
  }
  if (data.clave_sat) {
    fields.push(`clave_sat = $${paramCount++}`);
    values.push(data.clave_sat);
  }
  if (data.unit_code) {
    fields.push(`unit_code = $${paramCount++}`);
    values.push(data.unit_code);
  }
  if (data.base_price !== undefined) {
    fields.push(`base_price = $${paramCount++}`);
    values.push(data.base_price);
  }
  if (data.tax_type) {
    fields.push(`tax_type = $${paramCount++}`);
    values.push(data.tax_type);
  }
  if (data.tax_rate !== undefined) {
    fields.push(`tax_rate = $${paramCount++}`);
    values.push(data.tax_rate);
  }
  if ((data as any).tax_preset_id !== undefined || (data as any).taxPresetId !== undefined) {
    fields.push(`tax_preset_id = $${paramCount++}`);
    values.push((data as any).tax_preset_id ?? (data as any).taxPresetId);
  }
  if (data.is_exempt !== undefined) {
    fields.push(`is_exempt = $${paramCount++}`);
    values.push(data.is_exempt);
  }
  if (data.applies_ieps !== undefined) {
    fields.push(`applies_ieps = $${paramCount++}`);
    values.push(data.applies_ieps);
  }
  if (data.is_active !== undefined) {
    fields.push(`is_active = $${paramCount++}`);
    values.push(data.is_active);
  }

  if (fields.length === 0) {
    return product;
  }

  fields.push(`updated_at = NOW()`);
  values.push(productId);

  const result = await query<Product>(
    `UPDATE products SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to update product');
  }

  logger.info(`Product updated: ${productId}`);

  return result.rows[0];
}

/**
 * Delete product (soft delete)
 */
export async function deleteProduct(companyId: string, productId: string): Promise<void> {
  const product = await getProductById(companyId, productId);

  // Guard: no borrar si el producto está en alguna factura (SAT obliga retención 5 años).
  const usageR = await query<{ n: string; sample: string | null }>(
    `SELECT COUNT(*)::text AS n,
            (SELECT CONCAT(i.serie, '-', i.folio)
               FROM invoice_items ii
               JOIN invoices i ON i.id = ii.invoice_id
              WHERE ii.product_id = $1 LIMIT 1) AS sample
       FROM invoice_items
      WHERE product_id = $1`,
    [productId]
  );
  const uses = parseInt(usageR.rows[0]?.n || '0', 10);
  if (uses > 0) {
    const sample = usageR.rows[0]?.sample || '';
    throw new ValidationError(
      `No se puede eliminar el producto "${product.sku}" — está usado en ${uses} concepto(s) de factura` +
      (sample ? ` (ej. ${sample})` : '') +
      '. Marca el producto como inactivo desde el catálogo si ya no se usará.'
    );
  }

  await query(
    'UPDATE products SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1',
    [productId]
  );

  logger.info(`Product deleted: ${product.sku}`);
}

/**
 * Search products by SAT Clave
 */
export async function searchProductsByClavesat(
  companyId: string,
  clavesat: string
): Promise<Product[]> {
  const result = await query<Product>(
    `SELECT * FROM products
     WHERE company_id = $1 AND clave_sat = $2 AND deleted_at IS NULL`,
    [companyId, clavesat]
  );

  return result.rows;
}

/**
 * Get product with SAT catalog details
 */
export async function getProductWithSATDetails(companyId: string, productId: string) {
  const product = await getProductById(companyId, productId);

  // Get SAT catalog details
  const claveProductResult = await query(
    `SELECT * FROM sat_catalogs
     WHERE catalog_name = 'c_ClaveProdServ' AND catalog_key = $1`,
    [product.clave_sat]
  );

  const unidadResult = await query(
    `SELECT * FROM sat_catalogs
     WHERE catalog_name = 'c_ClaveUnidad' AND catalog_key = $1`,
    [product.unit_code]
  );

  return {
    product,
    satDetails: {
      claveProdServ: claveProductResult.rows[0] || null,
      claveUnidad: unidadResult.rows[0] || null,
    },
  };
}

export default {
  validateSATClaveProdServ,
  validateSATClaveUnidad,
  validateSATImpuesto,
  validateSATTasaOCuota,
  getSATCatalogs,
  createProduct,
  getNextProductSku,
  getProductById,
  getProductBySKU,
  listProducts,
  updateProduct,
  deleteProduct,
  searchProductsByClavesat,
  getProductWithSATDetails,
};
