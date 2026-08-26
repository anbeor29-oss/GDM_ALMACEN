/**
 * Cuenta de compra por producto (ClaveProdServ → 115 inventario / 601 gasto).
 * Espejo de ventas-cuentas, del lado de los recibidos. La póliza de compra parte
 * cada factura recibida por producto usando este mapeo.
 *
 * OJO: de recibidos el SAT entrega METADATOS (sin XML), así que aquí sólo salen
 * los productos de los recibidos que SÍ tengan XML. Sin XML no hay conceptos.
 */
import { query } from '../../config/database';
import { conceptosDeXml } from './ventas-cuentas.service';

const iniDeMes = (a: number, m: number) => `${a}-${String(m).padStart(2, '0')}-01`;
const finDeMes = (a: number, m: number) => new Date(a, m, 0).toISOString().slice(0, 10);

/** Las ClaveProdServ de los recibidos del mes (con XML), con su cuenta asignada. */
export async function clavesProdServDeRecibidos(companyId: string, anio: number, mes: number) {
  const r = await query<any>(
    `SELECT xml FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion='recibidos'
        AND xml IS NOT NULL AND fecha_emision::date BETWEEN $2 AND $3`,
    [companyId, iniDeMes(anio, mes), finDeMes(anio, mes)]);

  const acc = new Map<string, { clave: string; descripcion: string; veces: number; importe: number }>();
  for (const row of r.rows) {
    for (const c of conceptosDeXml(String(row.xml))) {
      if (!c.clave) continue;
      const e = acc.get(c.clave) || { clave: c.clave, descripcion: c.descripcion, veces: 0, importe: 0 };
      e.veces++; e.importe += c.importe;
      if (!e.descripcion) e.descripcion = c.descripcion;
      acc.set(c.clave, e);
    }
  }

  const asig = await query<any>(
    `SELECT clave_prod_serv, cuenta_codigo FROM compra_producto_cuenta WHERE company_id=$1`, [companyId]);
  const mapa = new Map<string, string>(asig.rows.map((x: any) => [x.clave_prod_serv, x.cuenta_codigo]));

  return Array.from(acc.values())
    .map((e) => ({ ...e, importe: Math.round(e.importe * 100) / 100, cuenta: mapa.get(e.clave) || null }))
    .sort((a, b) => b.importe - a.importe);
}

export async function asignarCuentaProductoCompra(
  companyId: string, clave: string, descripcion: string | null, cuenta: string | null
): Promise<boolean> {
  if (!clave) return false;
  await query(
    `INSERT INTO compra_producto_cuenta (company_id, clave_prod_serv, descripcion, cuenta_codigo, updated_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (company_id, clave_prod_serv)
       DO UPDATE SET cuenta_codigo = EXCLUDED.cuenta_codigo,
                     descripcion   = COALESCE(EXCLUDED.descripcion, compra_producto_cuenta.descripcion),
                     updated_at    = NOW()`,
    [companyId, clave, descripcion || null, cuenta ? cuenta.trim().slice(0, 40) || null : null]);
  return true;
}

export async function mapaProductoCuentaCompra(companyId: string): Promise<Map<string, string>> {
  const r = await query<any>(
    `SELECT clave_prod_serv, cuenta_codigo FROM compra_producto_cuenta
      WHERE company_id=$1 AND cuenta_codigo IS NOT NULL`, [companyId]);
  return new Map<string, string>(r.rows.map((x: any) => [x.clave_prod_serv, x.cuenta_codigo]));
}
