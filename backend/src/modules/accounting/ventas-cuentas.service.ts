/**
 * Cuenta de ingreso por producto (ClaveProdServ → 401).
 *
 * La cuenta de venta depende del producto. Aquí se listan las ClaveProdServ que
 * aparecen en las facturas emitidas y se les asigna un 401; con eso la póliza de
 * venta parte cada factura por producto (una línea de abono por 401 distinto).
 */
import { query } from '../../config/database';

const iniDeMes = (a: number, m: number) => `${a}-${String(m).padStart(2, '0')}-01`;
const finDeMes = (a: number, m: number) => new Date(a, m, 0).toISOString().slice(0, 10);
const attr = (s: string, n: string) => {
  const m = new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`).exec(s);
  return m ? m[1] : '';
};

/** Un complemento de pago (tipo P): el monto pagado y el IVA trasladado que
 *  traen sus Pago/DoctoRelacionado. Es lo que respeta "el IVA de la factura
 *  original", porque el TrasladoDR lo trae calculado sobre lo pagado. */
export function complementoDeXml(xml: string): { monto: number; iva: number } {
  let monto = 0, iva = 0;
  for (const p of xml.match(/<(?:\w+:)?Pago\b[^>]*>/g) || []) monto += Number(attr(p, 'Monto')) || 0;
  for (const t of xml.match(/<(?:\w+:)?TrasladoDR\b[^>]*>/g) || []) iva += Number(attr(t, 'ImporteDR')) || 0;
  return { monto: Math.round(monto * 100) / 100, iva: Math.round(iva * 100) / 100 };
}

/** Los conceptos de un CFDI, leídos del XML sin parser completo. `importe` es el
 *  bruto (Concepto@Importe, antes de descuento) y `descuento` el del propio
 *  concepto; el NETO gravado es `importe − descuento`, que es sobre lo que se
 *  calcula el IVA y lo que debe ir a la cuenta de ingreso/gasto. */
export function conceptosDeXml(
  xml: string
): Array<{ clave: string; descripcion: string; importe: number; descuento: number }> {
  const out: Array<{ clave: string; descripcion: string; importe: number; descuento: number }> = [];
  for (const c of xml.match(/<(?:\w+:)?Concepto\b[^>]*>/g) || []) {
    out.push({
      clave: attr(c, 'ClaveProdServ'),
      descripcion: attr(c, 'Descripcion'),
      importe: Number(attr(c, 'Importe')) || 0,
      descuento: Number(attr(c, 'Descuento')) || 0,
    });
  }
  return out;
}

/** Las ClaveProdServ de los emitidos del mes, con su cuenta asignada. */
export async function clavesProdServDeEmitidos(companyId: string, anio: number, mes: number) {
  const r = await query<any>(
    `SELECT xml FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion='emitidos' AND tipo_comprobante='I'
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
    `SELECT clave_prod_serv, cuenta_codigo FROM venta_producto_cuenta WHERE company_id=$1`, [companyId]);
  const mapa = new Map<string, string>(asig.rows.map((x: any) => [x.clave_prod_serv, x.cuenta_codigo]));

  return Array.from(acc.values())
    .map((e) => ({ ...e, importe: Math.round(e.importe * 100) / 100, cuenta: mapa.get(e.clave) || null }))
    .sort((a, b) => b.importe - a.importe);
}

export async function asignarCuentaProducto(
  companyId: string, clave: string, descripcion: string | null, cuenta: string | null
): Promise<boolean> {
  if (!clave) return false;
  await query(
    `INSERT INTO venta_producto_cuenta (company_id, clave_prod_serv, descripcion, cuenta_codigo, updated_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (company_id, clave_prod_serv)
       DO UPDATE SET cuenta_codigo = EXCLUDED.cuenta_codigo,
                     descripcion   = COALESCE(EXCLUDED.descripcion, venta_producto_cuenta.descripcion),
                     updated_at    = NOW()`,
    [companyId, clave, descripcion || null, cuenta ? cuenta.trim().slice(0, 40) || null : null]);
  return true;
}

/** Mapa ClaveProdServ → cuenta 401 (sólo las asignadas), para la generación. */
export async function mapaProductoCuenta(companyId: string): Promise<Map<string, string>> {
  const r = await query<any>(
    `SELECT clave_prod_serv, cuenta_codigo FROM venta_producto_cuenta
      WHERE company_id=$1 AND cuenta_codigo IS NOT NULL`, [companyId]);
  return new Map<string, string>(r.rows.map((x: any) => [x.clave_prod_serv, x.cuenta_codigo]));
}
