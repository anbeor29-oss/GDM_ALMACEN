/**
 * revision-nomina.service — REVISIÓN ANUAL de los recibos de nómina del cliente.
 *
 * QUÉ HACE (etapa 1: armado de la base de datos)
 * Lee de la bóveda (`cfdi_recibidos`, EMITIDOS tipo N que la descarga del SAT ya
 * guardó) todos los recibos de nómina de un año y arma la base para revisarlos:
 *   · un renglón por recibo, con el TRABAJADOR (receptor), percepciones
 *     (gravado/exento), ISR, IMSS, Infonavit, otras deducciones y neto;
 *   · acumulados por TRABAJADOR, por MES y por SEMANA, y el total del año.
 *
 * NO vuelve al SAT: revisa lo que ya está respaldado (que es justo lo que el SAT
 * tiene). El recálculo legal (ISR/IMSS/Infonavit) es la etapa siguiente; esta
 * sienta la base organizada por fecha → RFC que pide esa revisión.
 */
import { query } from '../../config/database';

const attr = (s: string, n: string) => {
  const m = new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`).exec(s);
  return m ? m[1] : '';
};
const num = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Semana ISO (1–53) de una fecha; así los acumulados semanales son estándar. */
function semanaISO(iso: string): number {
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return 0;
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;         // lunes=0 … domingo=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3);   // al jueves de esa semana
  const primerJueves = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = (date.getTime() - primerJueves.getTime()) / 86400000;
  return 1 + Math.round((diff - 3 + ((primerJueves.getUTCDay() + 6) % 7)) / 7);
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export interface ReciboRevision {
  uuid: string; fecha: string; fechaPago: string; serieFolio: string;
  rfcTrabajador: string; nombreTrabajador: string; curp: string; nss: string;
  tipoNomina: string; diasPagados: number;
  percepciones: number; gravado: number; exento: number;
  deducciones: number; isr: number; imss: number; infonavit: number; otrasDed: number;
  subsidio: number; otrosPagos: number; neto: number;
  mes: number; semana: number;
}

/** Lee el complemento nómina 1.2 + el receptor (trabajador) de un CFDI tipo N. */
function parseRecibo(xml: string): Omit<ReciboRevision, 'uuid' | 'fecha' | 'serieFolio'> | null {
  const nomNode = (/<(?:\w+:)?Nomina\b[^>]*>/.exec(xml) || [''])[0];
  if (!nomNode) return null;
  const tipoNomina = attr(nomNode, 'TipoNomina');
  const fechaPago = attr(nomNode, 'FechaPago') || attr(nomNode, 'FechaFinalPago');
  const diasPagados = num(attr(nomNode, 'NumDiasPagados'));
  const percepciones = num(attr(nomNode, 'TotalPercepciones'));
  const deducciones = num(attr(nomNode, 'TotalDeducciones'));
  const otrosPagos = num(attr(nomNode, 'TotalOtrosPagos'));

  const percNode = (/<(?:\w+:)?Percepciones\b[^>]*>/.exec(xml) || [''])[0];
  const gravado = num(attr(percNode, 'TotalGravado'));
  const exento = num(attr(percNode, 'TotalExento'));

  // Trabajador: el cfdi:Receptor (el que trae Rfc); el nomina12:Receptor trae CURP/NSS.
  let rfcTrabajador = '', nombreTrabajador = '';
  for (const rec of xml.match(/<(?:\w+:)?Receptor\b[^>]*>/g) || []) {
    const rfc = attr(rec, 'Rfc');
    if (rfc) { rfcTrabajador = rfc.toUpperCase(); nombreTrabajador = attr(rec, 'Nombre'); break; }
  }
  const nomRec = (/<(?:\w+:)?Receptor\b[^>]*Curp[^>]*>/.exec(xml) || [''])[0]
    || (xml.match(/<(?:\w+:)?Receptor\b[^>]*>/g) || []).find((r) => attr(r, 'Curp')) || '';
  const curp = attr(nomRec, 'Curp');
  const nss = attr(nomRec, 'NumSeguridadSocial');

  // Deducciones por tipo: 002 = ISR, 001 = IMSS, 009 = Infonavit, resto = otras.
  let isr = 0, imss = 0, infonavit = 0, otras = 0;
  for (const d of xml.match(/<(?:\w+:)?Deduccion\b[^>]*>/g) || []) {
    const t = attr(d, 'TipoDeduccion'); const imp = num(attr(d, 'Importe'));
    if (t === '002') isr += imp;
    else if (t === '001') imss += imp;
    else if (t === '009') infonavit += imp;
    else otras += imp;
  }

  let subsidio = 0;
  for (const s of xml.match(/<(?:\w+:)?SubsidioAlEmpleo\b[^>]*>/g) || []) subsidio += num(attr(s, 'SubsidioCausado'));

  const neto = r2(percepciones - deducciones + otrosPagos);
  return {
    fechaPago, tipoNomina, diasPagados, rfcTrabajador, nombreTrabajador, curp, nss,
    percepciones: r2(percepciones), gravado: r2(gravado), exento: r2(exento),
    deducciones: r2(deducciones), isr: r2(isr), imss: r2(imss), infonavit: r2(infonavit), otrasDed: r2(otras),
    subsidio: r2(subsidio), otrosPagos: r2(otrosPagos), neto,
    mes: 0, semana: 0,
  };
}

/** Años con recibos de nómina EMITIDOS en la bóveda (para el selector del año). */
export async function aniosConNomina(companyId: string): Promise<number[]> {
  const r = await query<{ anio: number }>(
    `SELECT DISTINCT EXTRACT(YEAR FROM fecha_emision)::int AS anio
       FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion='emitidos' AND tipo_comprobante='N'
      ORDER BY anio DESC`,
    [companyId]);
  return r.rows.map((x) => x.anio);
}

interface Acum {
  recibos: number; percepciones: number; gravado: number; exento: number;
  isr: number; imss: number; infonavit: number; otrasDed: number; subsidio: number; neto: number;
}
const acumVacio = (): Acum => ({
  recibos: 0, percepciones: 0, gravado: 0, exento: 0,
  isr: 0, imss: 0, infonavit: 0, otrasDed: 0, subsidio: 0, neto: 0,
});
const sumar = (a: Acum, r: ReciboRevision) => {
  a.recibos++; a.percepciones += r.percepciones; a.gravado += r.gravado; a.exento += r.exento;
  a.isr += r.isr; a.imss += r.imss; a.infonavit += r.infonavit; a.otrasDed += r.otrasDed;
  a.subsidio += r.subsidio; a.neto += r.neto;
};
const redondear = (a: Acum): Acum => {
  for (const k of Object.keys(a) as (keyof Acum)[]) a[k] = r2(a[k]);
  return a;
};

/**
 * Revisión del año: recibos + acumulados por trabajador, mes y semana.
 * Base organizada por fecha → RFC, lista para la revisión de cálculos.
 */
export async function revisionAnual(companyId: string, anio: number) {
  const r = await query<any>(
    `SELECT uuid, TO_CHAR(fecha_emision,'YYYY-MM-DD') AS fecha, serie, folio, xml
       FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion='emitidos' AND tipo_comprobante='N' AND xml IS NOT NULL
        AND EXTRACT(YEAR FROM fecha_emision)=$2
        AND (estado_sat IS NULL OR estado_sat <> 'Cancelado')
      ORDER BY fecha_emision, serie, folio`,
    [companyId, anio]);

  const recibos: ReciboRevision[] = [];
  for (const c of r.rows) {
    const p = parseRecibo(String(c.xml));
    if (!p) continue;
    const fechaRef = /^\d{4}-\d{2}-\d{2}/.test(p.fechaPago) ? p.fechaPago.slice(0, 10) : c.fecha;
    recibos.push({
      ...p,
      uuid: c.uuid,
      fecha: c.fecha,
      fechaPago: p.fechaPago || c.fecha,
      serieFolio: [c.serie, c.folio].filter(Boolean).join('-'),
      mes: Number(fechaRef.slice(5, 7)) || Number(c.fecha.slice(5, 7)),
      semana: semanaISO(fechaRef),
    });
  }

  // Acumulado por TRABAJADOR
  const porRfc = new Map<string, Acum & { rfc: string; nombre: string }>();
  for (const x of recibos) {
    const key = x.rfcTrabajador || x.uuid;
    if (!porRfc.has(key)) porRfc.set(key, { rfc: x.rfcTrabajador, nombre: x.nombreTrabajador, ...acumVacio() });
    sumar(porRfc.get(key)!, x);
  }
  const trabajadores = Array.from(porRfc.values())
    .map((t) => ({ ...t, ...redondear(t) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  // Acumulado por MES (1–12 con datos)
  const porMesMap = new Map<number, Acum>();
  for (const x of recibos) {
    if (!porMesMap.has(x.mes)) porMesMap.set(x.mes, acumVacio());
    sumar(porMesMap.get(x.mes)!, x);
  }
  const porMes = Array.from(porMesMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([mes, a]) => ({ mes, nombreMes: MESES[mes - 1] || String(mes), ...redondear(a) }));

  // Acumulado por SEMANA ISO
  const porSemMap = new Map<number, Acum>();
  for (const x of recibos) {
    if (!porSemMap.has(x.semana)) porSemMap.set(x.semana, acumVacio());
    sumar(porSemMap.get(x.semana)!, x);
  }
  const porSemana = Array.from(porSemMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([semana, a]) => ({ semana, ...redondear(a) }));

  // Total del año
  const total = acumVacio();
  for (const x of recibos) sumar(total, x);

  return {
    anio,
    totalRecibos: recibos.length,
    totales: { ...redondear(total), trabajadores: trabajadores.length },
    trabajadores,
    porMes,
    porSemana,
    recibos,
  };
}
