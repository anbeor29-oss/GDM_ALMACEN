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
import { crearPoliza, LineaPoliza } from '../accounting/polizas.service';

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

/* ═══════════════════════════════════════════════════════════════════════════
   CONTABILIZACIÓN de la NÓMINA RECIBIDA (pestaña Pólizas → Nómina → Recibida)
   Asiento (lo pidió el usuario): Cargo Banco (lo que entró, neto) + Cargo ISR
   retenido a FAVOR + (otras retenciones) / Abono Ingreso por nómina (sueldos o
   asimilados, según el régimen). Las cuentas salen de las Asignaciones; si no
   están, la nómina queda PENDIENTE (no se asienta nada incorrecto).
   Idempotente por origen_uuid = NOMREC:<uuid>.
   ═══════════════════════════════════════════════════════════════════════════ */
const PREF_NOMREC = 'NOMREC:';

async function ctaPorAgrup(companyId: string, agrupadores: string[]): Promise<{ id: string; codigo: string } | null> {
  const r = await query<any>(
    `SELECT id, codigo FROM accounting_accounts
      WHERE company_id=$1 AND codigo_agrupador = ANY($2::text[]) AND activa=true AND permite_movimientos=true
      ORDER BY codigo LIMIT 1`, [companyId, agrupadores]);
  return r.rows[0] || null;
}

/** Resuelve una cuenta de MOVIMIENTO por su CÓDIGO exacto (p. ej. la capturada en el combo). */
async function ctaPorCodigoMov(companyId: string, codigo?: string | null): Promise<{ id: string; codigo: string } | null> {
  if (!codigo) return null;
  const r = await query<any>(
    `SELECT id, codigo FROM accounting_accounts
      WHERE company_id=$1 AND codigo=$2 AND activa=true AND permite_movimientos=true LIMIT 1`,
    [companyId, String(codigo).trim()]);
  return r.rows[0] || null;
}

/** Nómina RECIBIDA del periodo con su estado contable (¿ya tiene póliza?). */
export async function nominaRecibidaContabilizable(companyId: string, anio: number, mes = 0) {
  const lista = await nominaRecibidaPF(companyId, anio, mes);
  if (!lista.length) return [];
  const uuids = lista.map((u) => u.uuid);
  const conPol = new Set<string>((await query<any>(
    `SELECT origen_uuid FROM journal_entries WHERE company_id=$1 AND origen_uuid = ANY($2::text[])`,
    [companyId, lista.map((u) => PREF_NOMREC + u.uuid)])).rows
    .map((r) => String(r.origen_uuid).slice(PREF_NOMREC.length)));
  // Las cuentas capturadas por el usuario (combo): ingreso y retención (ISR a favor).
  const ctas = new Map<string, { id: string; cuenta_contable: string | null; cuenta_contable_2: string | null }>();
  (await query<any>(
    `SELECT id, uuid, cuenta_contable, cuenta_contable_2 FROM cfdi_recibidos
      WHERE company_id=$1 AND uuid = ANY($2::text[])`, [companyId, uuids])).rows
    .forEach((r) => ctas.set(r.uuid, { id: r.id, cuenta_contable: r.cuenta_contable, cuenta_contable_2: r.cuenta_contable_2 }));
  return lista.map((n) => ({
    ...n, contabilizado: conPol.has(n.uuid),
    id: ctas.get(n.uuid)?.id || null,
    cuenta_contable: ctas.get(n.uuid)?.cuenta_contable || null,
    cuenta_contable_2: ctas.get(n.uuid)?.cuenta_contable_2 || null,
  }));
}

/** Contabiliza UNA nómina recibida. Idempotente por NOMREC:uuid. */
export async function generarPolizaNominaRecibida(
  companyId: string, uuid: string, userId?: string,
): Promise<{ ok: true; folio: number } | { error: string }> {
  const c = (await query<any>(
    `SELECT uuid, TO_CHAR(fecha_emision,'YYYY-MM-DD') AS fecha, nombre_emisor, rfc_emisor, cuenta_contable, cuenta_contable_2, xml
       FROM cfdi_recibidos WHERE company_id=$1 AND uuid=$2 AND direccion='recibidos' AND tipo_comprobante='N' LIMIT 1`,
    [companyId, uuid])).rows[0];
  if (!c || !c.xml) return { error: 'no se encontró la nómina recibida (o sin XML)' };
  const n = parseNominaXml(String(c.xml));
  if (!n) return { error: 'no se pudo leer el complemento de nómina' };

  const banco = await ctaPorAgrup(companyId, ['102.01']);
  if (!banco) return { error: 'falta la cuenta de banco (agrupador 102.01)' };
  // Las cuentas CAPTURADAS mandan: cuenta_contable = ingreso, cuenta_contable_2 = ISR a
  // favor. Si no se capturan, se resuelven (ingreso por agrupador; ISR por código
  // 1-1-60-02 «retención ISPT asimilados» o agrupador). Lo ÚNICO obligatorio es el
  // INGRESO (el abono); el ISR y otras retenciones son opcionales (si no hay cuenta, se
  // quedan dentro del ingreso para que el asiento SIEMPRE cuadre).
  const ingreso = (await ctaPorCodigoMov(companyId, c.cuenta_contable)) || await ctaPorAgrup(companyId,
    n.clase === 'asimilados' ? ['700.02', '700.01', '700', '401.02', '401.01', '401']
                             : ['700.01', '700', '401.01', '401']);
  if (!ingreso) return { error: 'asigna la cuenta de INGRESO por nómina recibida (combo «Cuenta ingreso» o agrupador 700/401)' };
  const neto = r2(n.neto), isr = r2(n.isr), otras = r2(n.imss + n.otrasDeducciones);
  const isrCta = isr > 0
    ? (await ctaPorCodigoMov(companyId, c.cuenta_contable_2))
      || (await ctaPorCodigoMov(companyId, '1-1-60-02'))
      || await ctaPorAgrup(companyId, ['113.01', '113'])
    : null;
  const otrasCta = otras > 0 ? await ctaPorAgrup(companyId, ['216', '205', '113']) : null;

  const lineas: LineaPoliza[] = [
    { account_id: banco.id, cargo: neto, concepto: 'Banco (nómina recibida)', uuid_cfdi: c.uuid },
  ];
  if (isr > 0 && isrCta) lineas.push({ account_id: isrCta.id, cargo: isr, concepto: 'ISR retenido a favor', uuid_cfdi: c.uuid });
  if (otras > 0 && otrasCta) lineas.push({ account_id: otrasCta.id, cargo: otras, concepto: 'Otras retenciones', uuid_cfdi: c.uuid });
  // El abono al ingreso cuadra EXACTO con la suma de los cargos (banco + lo que SÍ se
  // separó). Si no hubo cuenta de ISR/otras, se quedan dentro del ingreso.
  const abono = r2(neto + (isrCta ? isr : 0) + (otrasCta ? otras : 0));
  lineas.push({ account_id: ingreso.id, abono, concepto: `Ingreso nómina (${n.clase})`, uuid_cfdi: c.uuid });

  try {
    const pol = await crearPoliza(companyId, {
      tipo: 'INGRESO', fecha: c.fecha,
      concepto: `Nómina recibida · ${(c.nombre_emisor || c.rfc_emisor || '').toString().slice(0, 80)}`.trim(),
      origen: 'NOMINA', origen_uuid: PREF_NOMREC + c.uuid, regla: 'nomina_recibida_v1', lineas,
    }, userId);
    return { ok: true, folio: pol.folio };
  } catch (e: any) {
    if (e?.code === '23505' || /ya existe/i.test(e?.message || '')) return { error: 'esa nómina recibida ya tiene póliza' };
    return { error: (e?.message || 'no se pudo contabilizar').toString().slice(0, 140) };
  }
}

/** Contabiliza en BLOQUE la nómina recibida del mes. */
export async function generarPolizasNominaRecibidaMes(
  companyId: string, anio: number, mes: number, userId?: string,
): Promise<{ creadas: number; omitidas: Array<{ folio: string; motivo: string }> }> {
  const lista = await nominaRecibidaPF(companyId, anio, mes);
  let creadas = 0;
  const omitidas: Array<{ folio: string; motivo: string }> = [];
  for (const n of lista) {
    const r = await generarPolizaNominaRecibida(companyId, n.uuid, userId);
    if ('ok' in r) creadas++; else omitidas.push({ folio: String(n.uuid).slice(0, 8), motivo: r.error });
  }
  return { creadas, omitidas };
}
