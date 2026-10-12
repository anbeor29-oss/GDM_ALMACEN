/**
 * products-plantilla — layout en Excel para cargar/exportar productos en lote.
 *
 * EXPORTAR: baja los productos actuales en una hoja con el encabezado de la casa y
 * una fila de ejemplo cuando no hay ninguno. La MISMA hoja sirve de plantilla: el
 * usuario la edita y la vuelve a subir.
 * IMPORTAR (ver products-plantilla-import): lee esta misma hoja y crea/actualiza.
 *
 * El orden y los nombres de columna viven en COLUMNAS_PLANTILLA (una sola fuente),
 * para que exportar e importar siempre coincidan.
 */
import { query } from '../../config/database';
import {
  ExcelJS, C, titulo, dato, encabezado, celda, anchos, aBuffer,
} from '../nomina/estilo-excel';

export interface ColPlantilla { h: string; k: string; tipo: 'texto' | 'num' | 'bool'; req?: boolean; }

/** Columnas de la plantilla, en orden. `k` es la llave que entiende createProduct/updateProduct. */
export const COLUMNAS_PLANTILLA: ColPlantilla[] = [
  { h: 'SKU',                 k: 'sku',              tipo: 'texto' },
  { h: 'Nombre',              k: 'name',             tipo: 'texto', req: true },
  { h: 'Descripción',         k: 'description',      tipo: 'texto' },
  { h: 'Clave SAT (ProdServ)',k: 'claveSat',         tipo: 'texto', req: true },
  { h: 'Clave Unidad (SAT)',  k: 'unitCode',         tipo: 'texto', req: true },
  { h: 'Nombre unidad',       k: 'unitName',         tipo: 'texto' },
  { h: 'Precio base',         k: 'basePrice',        tipo: 'num' },
  { h: 'Precio mayoreo',      k: 'wholesalePrice',   tipo: 'num' },
  { h: 'Código de barras',    k: 'barcode',          tipo: 'texto' },
  { h: 'No. identificación',  k: 'noIdentificacion', tipo: 'texto' },
  { h: 'Moneda',              k: 'currency',         tipo: 'texto' },
  { h: 'Tasa IVA',            k: 'taxRate',          tipo: 'num' },
  { h: 'Exento',              k: 'isExempt',         tipo: 'bool' },
  { h: 'Deducible',           k: 'isDeductible',     tipo: 'bool' },
  { h: 'Aplica IEPS',         k: 'appliesIEPS',      tipo: 'bool' },
  { h: 'Existencia',          k: 'stockQuantity',    tipo: 'num' },
  { h: 'Mínimo',              k: 'stockMinimum',     tipo: 'num' },
  { h: 'Máximo',              k: 'stockMaximum',     tipo: 'num' },
  { h: 'Último costo',        k: 'lastCost',         tipo: 'num' },
];

const siNo = (b: any) => (b === true ? 'Sí' : b === false ? 'No' : '');

const EJEMPLO: Record<string, any> = {
  sku: 'P-1', name: 'Producto de ejemplo', description: '', claveSat: '01010101',
  unitCode: 'H87', unitName: 'Pieza', basePrice: 100, wholesalePrice: 90, barcode: '',
  noIdentificacion: '', currency: 'MXN', taxRate: 0.16, isExempt: 'No', isDeductible: 'Sí',
  appliesIEPS: 'No', stockQuantity: 0, stockMinimum: 0, stockMaximum: 0, lastCost: 0,
};

export async function plantillaProductosExcel(companyId: string): Promise<{ buffer: Buffer; nombre: string }> {
  const emp = (await query<any>('SELECT business_name, rfc FROM companies WHERE id=$1', [companyId])).rows[0] || {};
  const r = await query<any>(
    `SELECT sku, name, description, clave_sat, unit_code, unit_name, base_price, wholesale_price,
            barcode, no_identificacion, currency, tax_rate, is_exempt, is_deductible, applies_ieps,
            stock_quantity, stock_minimum, stock_maximum, last_cost
       FROM products WHERE company_id=$1 AND deleted_at IS NULL ORDER BY name`,
    [companyId]);

  const nCols = COLUMNAS_PLANTILLA.length;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GDM NEXO';
  const ws = wb.addWorksheet('Productos', { views: [{ state: 'frozen', ySplit: 6 }] });

  titulo(ws, 'Plantilla de productos (Almacén)', nCols);
  dato(ws, 3, 1, `Empresa:   ${emp.business_name || ''}`, true);
  dato(ws, 4, 1, 'Obligatorios: Nombre, Clave SAT (ProdServ) y Clave Unidad. Exento/Deducible/Aplica IEPS = Sí/No. SKU vacío = se autogenera.');
  encabezado(ws, 6, COLUMNAS_PLANTILLA.map((c) => ({ texto: c.h + (c.req ? ' *' : ''), color: C.identidad })));

  const filasDb = r.rows.map((p) => ({
    sku: p.sku, name: p.name, description: p.description, claveSat: p.clave_sat, unitCode: p.unit_code,
    unitName: p.unit_name, basePrice: Number(p.base_price), wholesalePrice: p.wholesale_price == null ? '' : Number(p.wholesale_price),
    barcode: p.barcode || '', noIdentificacion: p.no_identificacion || '', currency: p.currency || 'MXN',
    taxRate: p.tax_rate == null ? '' : Number(p.tax_rate), isExempt: siNo(p.is_exempt), isDeductible: siNo(p.is_deductible),
    appliesIEPS: siNo(p.applies_ieps), stockQuantity: Number(p.stock_quantity), stockMinimum: Number(p.stock_minimum),
    stockMaximum: Number(p.stock_maximum), lastCost: p.last_cost == null ? '' : Number(p.last_cost),
  }));
  const datos = filasDb.length ? filasDb : [EJEMPLO];

  let fila = 7;
  for (const d of datos) {
    COLUMNAS_PLANTILLA.forEach((c, i) => {
      const v = (d as any)[c.k];
      celda(ws, fila, i + 1, v === undefined || v === null ? '' : v, { centrado: false, pesos: c.tipo === 'num' && typeof v === 'number' });
    });
    fila++;
  }
  anchos(ws, [12, 30, 30, 18, 14, 16, 12, 12, 16, 16, 9, 9, 9, 10, 11, 11, 10, 10, 12]);

  return { buffer: await aBuffer(wb), nombre: `Plantilla_productos_${(emp.rfc || '').toUpperCase()}.xlsx` };
}
