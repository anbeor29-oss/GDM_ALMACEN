/**
 * nomina-pf.service — la vista fiscal de una PERSONA FÍSICA desde sus XML.
 *
 * Una persona física recibe CFDI de **nómina** (tipo `N`: sueldos y salarios,
 * asimilados a salarios, jubilación/pensión) como empleado, además de los CFDI
 * que EMITE (ingresos facturados) y los que RECIBE como gasto (egresos). Este
 * servicio lee lo ya guardado en `cfdi_recibidos` (la bóveda que llena la
 * descarga), parsea el complemento `nomina12` de los recibidos tipo N, y arma el
 * detalle + un resumen por mes con ingresos y egresos. NO vuelve a ir al SAT.
 */
import { query } from '../../config/database';

const attr = (s: string, n: string) => {
  const m = new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`).exec(s);
  return m ? m[1] : '';
};
const num = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** c_TipoRegimen del SAT → clase legible. 02 = sueldos; 05-11 = asimilados;
 *  03/04 = jubilación/pensión; el resto = otro. */
function claseRegimen(tipoRegimen: string): 'sueldos' | 'asimilados' | 'jubilacion' | 'otro' {
  if (tipoRegimen === '02') return 'sueldos';
  if (['05', '06', '07', '08', '09', '10', '11'].includes(tipoRegimen)) return 'asimilados';
  if (['03', '04'].includes(tipoRegimen)) return 'jubilacion';
  return 'otro';
}

export interface NominaPF {
  uuid: string; fecha: string; rfcEmisor: string; nombreEmisor: string; total: number;
  tipoNomina: string; regimen: string; clase: 'sueldos' | 'asimilados' | 'jubilacion' | 'otro';
  totalPercepciones: number; gravado: number; exento: number;
  totalDeducciones: number; isr: number; imss: number; otrasDeducciones: number;
  subsidio: number; otrosPagos: number; neto: number;
}

/** Lee el complemento nómina 1.2 del XML (regex, sin parser DOM). */
function parseNominaXml(xml: string): Omit<NominaPF, 'uuid' | 'fecha' | 'rfcEmisor' | 'nombreEmisor' | 'total'> | null {
  const nomNode = (/<(?:\w+:)?Nomina\b[^>]*>/.exec(xml) || [''])[0];
  if (!nomNode) return null;
  const tipoNomina = attr(nomNode, 'TipoNomina');
  const totalPercepciones = num(attr(nomNode, 'TotalPercepciones'));
  const totalDeducciones = num(attr(nomNode, 'TotalDeducciones'));
  const totalOtrosPagos = num(attr(nomNode, 'TotalOtrosPagos'));

  const percNode = (/<(?:\w+:)?Percepciones\b[^>]*>/.exec(xml) || [''])[0];
  const gravado = num(attr(percNode, 'TotalGravado'));
  const exento = num(attr(percNode, 'TotalExento'));

  // El Receptor con TipoRegimen es el de nómina (hay otro cfdi:Receptor sin él).
  let regimen = '';
  for (const rec of xml.match(/<(?:\w+:)?Receptor\b[^>]*>/g) || []) {
    const tr = attr(rec, 'TipoRegimen');
    if (tr) { regimen = tr; break; }
  }

  // Deducciones por tipo: 002 = ISR, 001 = seguridad social (IMSS), resto = otras.
  let isr = 0, imss = 0, otras = 0;
  for (const d of xml.match(/<(?:\w+:)?Deduccion\b[^>]*>/g) || []) {
    const t = attr(d, 'TipoDeduccion'); const imp = num(attr(d, 'Importe'));
    if (t === '002') isr += imp; else if (t === '001') imss += imp; else otras += imp;
  }

  // Subsidio al empleo (dentro de OtrosPagos).
  let subsidio = 0;
  for (const s of xml.match(/<(?:\w+:)?SubsidioAlEmpleo\b[^>]*>/g) || []) subsidio += num(attr(s, 'SubsidioCausado'));

  const neto = r2(totalPercepciones - totalDeducciones + totalOtrosPagos);
  return {
    tipoNomina, regimen, clase: claseRegimen(regimen),
    totalPercepciones: r2(totalPercepciones), gravado: r2(gravado), exento: r2(exento),
    totalDeducciones: r2(totalDeducciones), isr: r2(isr), imss: r2(imss), otrasDeducciones: r2(otras),
    subsidio: r2(subsidio), otrosPagos: r2(totalOtrosPagos), neto,
  };
}

/** Nómina RECIBIDA por la persona física (tipo N, recibidos) del año/mes. */
export async function nominaRecibidaPF(companyId: string, anio: number, mes = 0): Promise<NominaPF[]> {
  const r = await query<any>(
    `SELECT uuid, TO_CHAR(fecha_emision,'YYYY-MM-DD') AS fecha, rfc_emisor, nombre_emisor, total, xml
       FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion='recibidos' AND tipo_comprobante='N' AND xml IS NOT NULL
        AND EXTRACT(YEAR FROM fecha_emision)=$2
        AND ($3::int = 0 OR EXTRACT(MONTH FROM fecha_emision)=$3)
        AND (estado_sat IS NULL OR estado_sat <> 'Cancelado')
      ORDER BY fecha_emision DESC`,
    [companyId, anio, mes]);
  const out: NominaPF[] = [];
  for (const c of r.rows) {
    const n = parseNominaXml(String(c.xml));
    if (!n) continue;
    out.push({
      uuid: c.uuid, fecha: c.fecha, rfcEmisor: c.rfc_emisor,
      nombreEmisor: c.nombre_emisor || c.rfc_emisor || '', total: r2(c.total), ...n,
    });
  }
  return out;
}

/** ¿Cuántos recibidos de nómina quedaron SIN XML (sólo metadata)? — no se pueden
 *  desglosar; sirve para avisar que hay que re-descargar/subir su XML. */
async function nominaSinXml(companyId: string, anio: number): Promise<number> {
  const r = await query<any>(
    `SELECT COUNT(*)::int AS n FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion='recibidos' AND tipo_comprobante='N' AND xml IS NULL
        AND EXTRACT(YEAR FROM fecha_emision)=$2`, [companyId, anio]);
  return r.rows[0]?.n || 0;
}

/**
 * Resumen por MES del ejercicio: ingresos de nómina (sueldos/asimilados) con sus
 * retenciones (ISR/IMSS) y subsidio, los ingresos FACTURADOS (emitidos tipo I) y
 * los EGRESOS/gastos (recibidos tipo I). Pinta la foto fiscal de la persona física.
 */
export async function resumenPF(companyId: string, anio: number) {
  const nom = await nominaRecibidaPF(companyId, anio, 0);
  const meses = Array.from({ length: 12 }, (_, i) => ({
    mes: i + 1, sueldos: 0, asimilados: 0, otrosNom: 0, gravado: 0, exento: 0,
    isr: 0, imss: 0, subsidio: 0, neto: 0, docs: 0,
  }));
  for (const n of nom) {
    const m = Number(n.fecha.slice(5, 7)) - 1; if (m < 0 || m > 11) continue;
    const s = meses[m]; s.docs++;
    if (n.clase === 'sueldos') s.sueldos = r2(s.sueldos + n.totalPercepciones);
    else if (n.clase === 'asimilados') s.asimilados = r2(s.asimilados + n.totalPercepciones);
    else s.otrosNom = r2(s.otrosNom + n.totalPercepciones);
    s.gravado = r2(s.gravado + n.gravado); s.exento = r2(s.exento + n.exento);
    s.isr = r2(s.isr + n.isr); s.imss = r2(s.imss + n.imss);
    s.subsidio = r2(s.subsidio + n.subsidio); s.neto = r2(s.neto + n.neto);
  }

  const porMes = (direccion: string, tipo: string) => query<any>(
    `SELECT EXTRACT(MONTH FROM fecha_emision)::int AS mes, COUNT(*)::int AS n, COALESCE(SUM(total),0)::float AS t
       FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion=$2 AND tipo_comprobante=$3
        AND EXTRACT(YEAR FROM fecha_emision)=$4 AND (estado_sat IS NULL OR estado_sat <> 'Cancelado')
      GROUP BY 1`, [companyId, direccion, tipo, anio]);
  const [fact, egr] = await Promise.all([porMes('emitidos', 'I'), porMes('recibidos', 'I')]);
  const mapDe = (rows: any[]) => new Map(rows.map((x: any) => [x.mes, { n: x.n, t: r2(x.t) }]));
  const factMap = mapDe(fact.rows), egrMap = mapDe(egr.rows);

  const filas = meses.map((s) => ({
    ...s,
    ingresoNomina: r2(s.sueldos + s.asimilados + s.otrosNom),
    facturado: factMap.get(s.mes)?.t || 0, facturadoDocs: factMap.get(s.mes)?.n || 0,
    egresos: egrMap.get(s.mes)?.t || 0, egresosDocs: egrMap.get(s.mes)?.n || 0,
  }));
  const totales = filas.reduce((a, f) => ({
    ingresoNomina: r2(a.ingresoNomina + f.ingresoNomina), sueldos: r2(a.sueldos + f.sueldos),
    asimilados: r2(a.asimilados + f.asimilados), gravado: r2(a.gravado + f.gravado), exento: r2(a.exento + f.exento),
    isr: r2(a.isr + f.isr), imss: r2(a.imss + f.imss), subsidio: r2(a.subsidio + f.subsidio), neto: r2(a.neto + f.neto),
    facturado: r2(a.facturado + f.facturado), egresos: r2(a.egresos + f.egresos),
    nominaDocs: a.nominaDocs + f.docs,
  }), {
    ingresoNomina: 0, sueldos: 0, asimilados: 0, gravado: 0, exento: 0, isr: 0, imss: 0,
    subsidio: 0, neto: 0, facturado: 0, egresos: 0, nominaDocs: 0,
  });

  return { anio, filas, totales, nominaSinXml: await nominaSinXml(companyId, anio) };
}
