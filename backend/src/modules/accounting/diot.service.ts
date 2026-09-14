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

/* ═══════════════════════════════════════════════════════════════════════════
   ARCHIVO DE CARGA MASIVA (.txt) PARA EL PORTAL DEL SAT — DIOT 2025
   ───────────────────────────────────────────────────────────────────────────
   Layout tomado del instructivo OFICIAL del SAT "Ayuda para el llenado del
   archivo para la carga masiva DIOT 2025": .txt UTF-8, campos separados por
   pipe (|), un renglón por operación (por proveedor), montos ENTEROS (sin
   decimales, sin separador de miles; acepta 0). Son 53 campos en este orden:

    1  Tipo de tercero              (04 nacional, 05 extranjero, 15 global)
    2  Tipo de operación           (02 enajenación, 03 serv. profesionales,
                                     06 uso o goce, 85 otros; 07/87 import/global)
    3  RFC                         (obligatorio nacional/global; opc. extranjero)
    4  Número de ID fiscal         (extranjero)
    5  Nombre del extranjero
    6  País/jurisdicción           (extranjero, 2 letras)
   VALOR DE LOS ACTOS O ACTIVIDADES PAGADOS (valor / devoluciones), por región:
    7  Valor · frontera norte      8  Devoluciones · frontera norte
    9  Valor · frontera sur       10  Devoluciones · frontera sur
   11  Valor · tasa 16%           12  Devoluciones · tasa 16%
   13  Valor · import. aduana tangibles 16%   14  Devoluciones ·  (idem)
   15  Valor · import. intangibles/serv. 16%  16  Devoluciones ·  (idem)
   IVA ACREDITABLE (exclusiva de gravadas / asociado a proporción), por región:
   17 excl · front norte   18 prop · front norte
   19 excl · front sur     20 prop · front sur
   21 excl · tasa 16%      22 prop · tasa 16%
   23 excl · imp tangibles 24 prop · imp tangibles
   25 excl · imp intang.   26 prop · imp intang.
   IVA NO ACREDITABLE (4 categorías) × 5 regiones = campos 27..46
   47 IVA retenido por el contribuyente
   48 Actos pagados en importación · exentos
   49 Actos o actividades pagados · exentos
   50 Demás actos pagados a tasa 0%
   51 Actos no objeto del IVA · territorio nacional
   52 Actos no objeto del IVA · sin establecimiento
   53 Manifiesto de efectos fiscales (01 Sí, 02 No)

   OJO (no se inventa): tipo de operación, si el IVA acreditable va a "exclusiva
   de gravadas" o a "proporción", y la región fronteriza NO vienen en el CFDI —
   son decisión del contribuyente. Llegan como `opts` desde la pantalla, con
   valores por defecto conservadores. Los extranjeros (05) salen con país e ID
   fiscal en blanco (el CFDI no los trae) y se listan aparte para captura manual.
   El archivo debe validarse en el propio aplicativo del SAT antes de enviarlo.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface DiotBatchOpts {
  tipoOperacion?: string;              // 02 | 03 | 06 | 85 …  (default 85)
  region?: 'none' | 'norte' | 'sur';   // dónde cae el 8% de frontera (default none)
  proporcion?: boolean;                // IVA acreditable a "proporción" (default false)
}

/** Entero como texto: sin decimales ni separador de miles (regla del SAT). */
const ent = (n: any) => String(Math.round(Number(n) || 0));

export async function diotBatchTxt(
  companyId: string, anio: number, mes: number, opts: DiotBatchOpts = {},
): Promise<{ txt: string; nombre: string; cuantos: number; extranjeros: number }> {
  const emp = await query<{ rfc: string }>(`SELECT rfc FROM companies WHERE id=$1`, [companyId]);
  const rfcEmp = (emp.rows[0]?.rfc || 'XAXX010101000').toUpperCase().trim();

  const tipoOp = (opts.tipoOperacion || '85').trim();
  const region = opts.region === 'norte' || opts.region === 'sur' ? opts.region : 'none';
  const prop = !!opts.proporcion;

  const d = await diot(companyId, anio, mes);

  let extranjeros = 0;
  const lineas = d.proveedores.map((p) => {
    const esExt = p.tipoTercero === '05';
    if (esExt) extranjeros++;
    // 8% = tasa de región fronteriza; su valor/IVA cae en norte o sur según opts.
    const f = new Array<string>(53).fill('0');
    f[0] = p.tipoTercero;                 // 1 tipo de tercero
    f[1] = esExt ? '07' : tipoOp;         // 2 tipo de operación (extranjero: importación)
    f[2] = esExt ? '' : p.rfc;            // 3 RFC (extranjero: en blanco / opc.)
    f[3] = '';                            // 4 ID fiscal extranjero (no viene en CFDI)
    f[4] = esExt ? p.nombre || '' : '';   // 5 nombre del extranjero
    f[5] = '';                            // 6 país (no viene en CFDI → captura manual)
    // Valor de los actos (BASE), por región:
    f[6]  = region === 'norte' ? ent(p.base8) : '0';   // 7  valor · frontera norte
    f[8]  = region === 'sur'   ? ent(p.base8) : '0';   // 9  valor · frontera sur
    f[10] = ent(p.base16);                              // 11 valor · tasa 16%
    // IVA acreditable (exclusiva gravadas vs proporción):
    if (region === 'norte') { f[prop ? 17 : 16] = ent(p.iva8); }   // 17/18 front norte
    if (region === 'sur')   { f[prop ? 19 : 18] = ent(p.iva8); }   // 19/20 front sur
    f[prop ? 21 : 20] = ent(p.iva16);                              // 21/22 tasa 16%
    // Resto de bloques (importaciones, no acreditable) quedan en 0.
    f[46] = ent(p.ivaRet);   // 47 IVA retenido
    f[48] = ent(p.exento);   // 49 actos exentos
    f[49] = ent(p.base0);    // 50 demás actos a tasa 0%
    f[52] = '01';            // 53 manifiesto de efectos fiscales = Sí
    return f.join('|');
  });

  return {
    txt: lineas.join('\r\n') + (lineas.length ? '\r\n' : ''),
    nombre: `DIOT_${rfcEmp}_${anio}${String(mes).padStart(2, '0')}.txt`,
    cuantos: lineas.length,
    extranjeros,
  };
}

export default { diot, impuestosDeXml, diotBatchTxt };
