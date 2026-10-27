/**
 * ecommerce-envios.service — MÉTODOS DE ENVÍO por tienda (rebanada 8).
 *
 * Cada tienda define cómo cobra el envío: nombre + costo base (sin IVA) y, opcional,
 * «envío gratis desde» cierto total. El comprador elige uno en el checkout; el costo
 * se congela en el pedido y, al facturar, entra como renglón de flete en el CFDI.
 * Todo acotado por `company_id` + `store_id` (candado multi-tenant).
 */
import { query } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';

export const IVA_ENVIO = 0.16;
const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

/** La tienda debe ser de la empresa. */
async function assertTiendaDeEmpresa(companyId: string, storeId: string) {
  const r = await query<any>(
    `SELECT 1 FROM ec_store WHERE id=$1 AND company_id=$2 AND deleted_at IS NULL`, [storeId, companyId]);
  if (!r.rows[0]) throw new NotFoundError('Tienda no encontrada en esta empresa.');
}

const costoValido = (v: any): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError('El costo de envío no puede ser negativo.');
  return r2(n);
};
const gratisDesde = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError('«Envío gratis desde» no puede ser negativo.');
  return r2(n);
};

/** Métodos de una tienda (cockpit: incluye inactivos). */
export async function listarMetodos(companyId: string, storeId: string) {
  await assertTiendaDeEmpresa(companyId, storeId);
  const r = await query<any>(
    `SELECT id, nombre, costo::float AS costo, gratis_desde::float AS gratis_desde, activo, orden
       FROM ec_shipping_method WHERE store_id=$1 ORDER BY orden, nombre`, [storeId]);
  return r.rows;
}

export async function crearMetodo(companyId: string, storeId: string, d: any) {
  await assertTiendaDeEmpresa(companyId, storeId);
  const nombre = String(d?.nombre || '').trim();
  if (!nombre) throw new ValidationError('Captura el nombre del método de envío.');
  const r = await query<any>(
    `INSERT INTO ec_shipping_method (company_id, store_id, nombre, costo, gratis_desde, activo, orden)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, nombre, costo::float AS costo, gratis_desde::float AS gratis_desde, activo, orden`,
    [companyId, storeId, nombre.slice(0, 120), costoValido(d?.costo), gratisDesde(d?.gratisDesde),
     d?.activo === false ? false : true, Number(d?.orden) || 0]);
  return r.rows[0];
}

export async function actualizarMetodo(companyId: string, id: string, d: any) {
  const sets: string[] = []; const vals: any[] = [id, companyId]; let i = 3;
  if (d?.nombre !== undefined) {
    const nombre = String(d.nombre || '').trim();
    if (!nombre) throw new ValidationError('El nombre no puede quedar vacío.');
    sets.push(`nombre=$${i++}`); vals.push(nombre.slice(0, 120));
  }
  if (d?.costo !== undefined) { sets.push(`costo=$${i++}`); vals.push(costoValido(d.costo)); }
  if (d?.gratisDesde !== undefined) { sets.push(`gratis_desde=$${i++}`); vals.push(gratisDesde(d.gratisDesde)); }
  if (d?.activo !== undefined) { sets.push(`activo=$${i++}`); vals.push(!!d.activo); }
  if (d?.orden !== undefined) { sets.push(`orden=$${i++}`); vals.push(Number(d.orden) || 0); }
  if (!sets.length) return { actualizado: false };
  const r = await query<any>(
    `UPDATE ec_shipping_method SET ${sets.join(', ')}, updated_at=NOW()
      WHERE id=$1 AND company_id=$2
      RETURNING id, nombre, costo::float AS costo, gratis_desde::float AS gratis_desde, activo, orden`, vals);
  if (!r.rows[0]) throw new NotFoundError('Método de envío no encontrado.');
  return r.rows[0];
}

export async function borrarMetodo(companyId: string, id: string) {
  const r = await query<any>(
    `DELETE FROM ec_shipping_method WHERE id=$1 AND company_id=$2 RETURNING nombre`, [id, companyId]);
  if (!r.rows[0]) throw new NotFoundError('Método de envío no encontrado.');
  return { nombre: r.rows[0].nombre };
}

/** Métodos ACTIVOS de la tienda para el storefront (con su costo visible con IVA). */
export async function metodosPublicos(storeId: string) {
  const r = await query<any>(
    `SELECT id, nombre, costo::float AS costo, gratis_desde::float AS gratis_desde
       FROM ec_shipping_method WHERE store_id=$1 AND activo=TRUE ORDER BY orden, nombre`, [storeId]);
  return r.rows.map((m: any) => ({
    id: m.id, nombre: m.nombre,
    costo: r2(m.costo), costoConIva: r2(Number(m.costo) * (1 + IVA_ENVIO)),
    gratisDesde: m.gratis_desde != null ? r2(m.gratis_desde) : null,
  }));
}

/**
 * Costo del envío de un método dado el total (CON IVA) de los productos. Si el
 * método tiene «gratis desde» y el total lo alcanza, el envío es 0. Devuelve base
 * (sin IVA), IVA (16%) y total; `gratis` indica si se aplicó el envío gratis.
 */
export function calcularCostoEnvio(
  metodo: { costo: number; gratis_desde: number | null }, totalProductosConIva: number,
): { base: number; iva: number; total: number; gratis: boolean } {
  const umbral = metodo.gratis_desde;
  const gratis = umbral != null && Number(totalProductosConIva) >= Number(umbral);
  const base = gratis ? 0 : r2(metodo.costo);
  const iva = r2(base * IVA_ENVIO);
  return { base, iva, total: r2(base + iva), gratis };
}
