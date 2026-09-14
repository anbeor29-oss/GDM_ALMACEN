/**
 * DIOT — Declaración Informativa de Operaciones con Terceros.
 *
 * Suma las COMPRAS (CFDI recibidos tipo I con XML) del periodo por proveedor, con
 * el IVA desglosado por tasa (16 % / 8 % / 0 % / exento) y el IVA retenido. Es la
 * base de la declaración: se alimenta de los XML descargados/subidos.
 *
 * OJO: el desglose sale del bloque de impuestos A NIVEL COMPROBANTE (el que va
 * DESPUÉS de </Conceptos>), no de los conceptos, para no contar doble.
 */
import { query } from '../../config/database';

const iniDeMes = (a: number, m: number) => `${a}-${String(m).padStart(2, '0')}-01`;
const finDeMes = (a: number, m: number) => new Date(a, m, 0).toISOString().slice(0, 10);
const attr = (s: string, n: string) => {
  const m = new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`).exec(s);
  return m ? m[1] : '';
};

export interface ImpuestosCfdi {
  base16: number; iva16: number; base8: number; iva8: number;
  base0: number; exento: number; ivaRet: number;
}

/** Impuestos a nivel comprobante de un CFDI recibido (compra). */
export function impuestosDeXml(xml: string): ImpuestosCfdi {
  const out: ImpuestosCfdi = { base16: 0, iva16: 0, base8: 0, iva8: 0, base0: 0, exento: 0, ivaRet: 0 };
  const iConc = xml.search(/<\/(?:\w+:)?Conceptos>/);
  const cuerpo = iConc >= 0 ? xml.slice(iConc) : xml;   // sólo el resumen del comprobante

  for (const t of cuerpo.match(/<(?:\w+:)?Traslado\b[^>]*?\/?>/g) || []) {
    if (attr(t, 'Impuesto') !== '002') continue;         // 002 = IVA
    const factor = attr(t, 'TipoFactor');
    let base = Number(attr(t, 'Base')) || 0;
    const importe = Number(attr(t, 'Importe')) || 0;
    if (factor === 'Exento') { out.exento += base; continue; }
    const tasa = Number(attr(t, 'TasaOCuota'));
    // CFDI 3.3 no traía Base a nivel comprobante: se deriva del importe y la tasa.
    if (!base && importe && tasa) base = importe / tasa;
    if (Math.abs(tasa - 0.16) < 0.0001) { out.base16 += base; out.iva16 += importe; }
    else if (Math.abs(tasa - 0.08) < 0.0001) { out.base8 += base; out.iva8 += importe; }
    else if (tasa === 0) { out.base0 += base; }
  }
  for (const r of cuerpo.match(/<(?:\w+:)?Retencion\b[^>]*?\/?>/g) || []) {
    if (attr(r, 'Impuesto') !== '002') continue;
    out.ivaRet += Number(attr(r, 'Importe')) || 0;
  }
  return out;
}

export interface RenglonDiot extends ImpuestosCfdi {
  rfc: string; nombre: string; comprobantes: number; tipoTercero: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function diot(companyId: string, anio: number, mes: number) {
  const r = await query<any>(
    `SELECT rfc_emisor, nombre_emisor, xml FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion='recibidos' AND tipo_comprobante='I'
        AND xml IS NOT NULL AND fecha_emision::date BETWEEN $2 AND $3`,
    [companyId, iniDeMes(anio, mes), finDeMes(anio, mes)]);

  const porProv = new Map<string, RenglonDiot>();
  for (const row of r.rows) {
    const rfc = String(row.rfc_emisor || '').toUpperCase().trim();
    if (!rfc) continue;
    const imp = impuestosDeXml(String(row.xml));
    // Tercero: 04 nacional (RFC de 12/13), 05 extranjero.
    const tipoTercero = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc) ? '04' : '05';
    const e = porProv.get(rfc) || {
      rfc, nombre: row.nombre_emisor || '', comprobantes: 0, tipoTercero,
      base16: 0, iva16: 0, base8: 0, iva8: 0, base0: 0, exento: 0, ivaRet: 0,
    };
    e.comprobantes++;
    e.base16 += imp.base16; e.iva16 += imp.iva16;
    e.base8 += imp.base8; e.iva8 += imp.iva8;
    e.base0 += imp.base0; e.exento += imp.exento; e.ivaRet += imp.ivaRet;
    if (!e.nombre && row.nombre_emisor) e.nombre = row.nombre_emisor;
    porProv.set(rfc, e);
  }

  const proveedores = [...porProv.values()]
    .map((e) => ({
      ...e,
      base16: r2(e.base16), iva16: r2(e.iva16), base8: r2(e.base8), iva8: r2(e.iva8),
      base0: r2(e.base0), exento: r2(e.exento), ivaRet: r2(e.ivaRet),
    }))
    .sort((a, b) => (b.iva16 + b.iva8) - (a.iva16 + a.iva8));

  const tot = proveedores.reduce((t, e) => ({
    base16: t.base16 + e.base16, iva16: t.iva16 + e.iva16,
    base8: t.base8 + e.base8, iva8: t.iva8 + e.iva8,
    base0: t.base0 + e.base0, exento: t.exento + e.exento, ivaRet: t.ivaRet + e.ivaRet,
  }), { base16: 0, iva16: 0, base8: 0, iva8: 0, base0: 0, exento: 0, ivaRet: 0 });

  return {
    anio, mes,
    proveedores,
    totales: Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, r2(v as number)])),
    cuantos: proveedores.length,
  };
}

export default { diot, impuestosDeXml };
