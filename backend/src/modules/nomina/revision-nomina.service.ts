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
import * as ejercicios from './ejercicios.service';
import { calcularIsr, calcularImssObrero, calcularInfonavit, type DatosInfonavit, type Zona } from './motor';

/** Datos del trabajador en el expediente que hacen falta para recalcular. */
interface EmpInfonavit {
  zona: Zona;
  tiene: boolean; tipo: string | null; valor: number | null; seguro: number | null; desde: string | null;
}
const zonaDe = (z?: string): Zona =>
  String(z || '').toLowerCase().includes('frontera') ? 'frontera_norte' : 'general';

/** Carga el Infonavit y la zona de los empleados, indexados por RFC/NSS/CURP. */
async function cargarEmpleados(companyId: string) {
  const r = await query<any>(
    `SELECT rfc, curp, nss, zona_geografica,
            tiene_infonavit, infonavit_tipo_descuento, infonavit_descuento, infonavit_seguro_danos,
            TO_CHAR(infonavit_desde,'YYYY-MM-DD') AS infonavit_desde
       FROM nomina_empleados WHERE company_id=$1`,
    [companyId]);
  const porRfc = new Map<string, EmpInfonavit>();
  const porNss = new Map<string, EmpInfonavit>();
  const porCurp = new Map<string, EmpInfonavit>();
  for (const e of r.rows) {
    const d: EmpInfonavit = {
      zona: zonaDe(e.zona_geografica),
      tiene: !!e.tiene_infonavit, tipo: e.infonavit_tipo_descuento || null,
      valor: e.infonavit_descuento == null ? null : Number(e.infonavit_descuento),
      seguro: e.infonavit_seguro_danos == null ? null : Number(e.infonavit_seguro_danos),
      desde: e.infonavit_desde || null,
    };
    if (e.rfc) porRfc.set(String(e.rfc).toUpperCase(), d);
    if (e.nss) porNss.set(String(e.nss), d);
    if (e.curp) porCurp.set(String(e.curp).toUpperCase(), d);
  }
  return { porRfc, porNss, porCurp };
}

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

/** c_TipoRegimen: 02 = sueldos; 05–11 = asimilados (sin subsidio al empleo). */
const esAsimiladoRegimen = (r: string) => ['05', '06', '07', '08', '09', '10', '11'].includes(r);

export interface ReciboRevision {
  uuid: string; fecha: string; fechaPago: string; serieFolio: string;
  rfcTrabajador: string; nombreTrabajador: string; curp: string; nss: string;
  regimen: string;
  tipoNomina: string; diasPagados: number;
  sdi: number; sbc: number; sueldoBase: number;
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
  const regimen = attr(nomRec, 'TipoRegimen');
  const sdi = num(attr(nomRec, 'SalarioDiarioIntegrado'));   // SDI (base IMSS/Infonavit)
  const sbc = num(attr(nomRec, 'SalarioBaseCotApor'));       // SBC cotizado

  // Sueldo base del periodo: percepción 001 (gravado+exento) → salario diario aprox.
  let sueldoBase = 0;
  for (const p of xml.match(/<(?:\w+:)?Percepcion\b[^>]*>/g) || []) {
    if (attr(p, 'TipoPercepcion') === '001') sueldoBase += num(attr(p, 'ImporteGravado')) + num(attr(p, 'ImporteExento'));
  }

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
    fechaPago, tipoNomina, diasPagados, rfcTrabajador, nombreTrabajador, curp, nss, regimen,
    sdi: r2(sdi), sbc: r2(sbc), sueldoBase: r2(sueldoBase),
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
/** Lee y parsea los recibos de nómina EMITIDOS (tipo N) de un año desde la bóveda. */
export async function cargarRecibos(companyId: string, anio: number): Promise<ReciboRevision[]> {
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
  return recibos;
}

export async function revisionAnual(companyId: string, anio: number) {
  const recibos = await cargarRecibos(companyId, anio);

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

/**
 * Revisión de cálculos — ISR mensual (LISR Art. 96 + subsidio al empleo).
 *
 * Por trabajador y mes coteja el ISR NETO efectivamente retenido en el mes
 * (Σ ISR deducción 002 − Σ subsidio al empleo entregado) contra el ISR del mes
 * según la tarifa MENSUAL del Art. 96 aplicada al gravado acumulado del mes —el
 * MISMO motor y tarifa (cotejada contra el DOF) que usa la nómina—. La diferencia
 * marca a quién se le retuvo de más o de menos. Los asimilados (régimen 05–11) se
 * recalculan SIN subsidio.
 *
 * Es un cotejo MENSUAL: la retención por periodo (quincenal/semanal) difiere de
 * forma natural del cálculo mensual, así que sólo se RESALTAN las diferencias
 * relevantes (> $1 y > 0.5 % del ISR del mes), no los centavos.
 */
export async function revisionCalculosIsr(companyId: string, anio: number) {
  const recibos = await cargarRecibos(companyId, anio);

  let e;
  try { e = await ejercicios.cargar(anio); }
  catch {
    return vacioIsr(anio, `No hay parámetros de nómina cargados para ${anio}. Captúralos en Nómina → Parámetros para recalcular el ISR.`);
  }
  if (!e.tarifaIsr?.length) {
    return vacioIsr(anio, `No hay tarifa del Art. 96 cargada para ${anio}. Captúrala en Nómina → Parámetros para recalcular el ISR.`);
  }

  // Agrupar por trabajador + mes
  type Grupo = {
    rfc: string; nombre: string; mes: number; asimilado: boolean;
    gravado: number; isrRetenido: number; subsidio: number; recibos: number;
  };
  const grupos = new Map<string, Grupo>();
  for (const x of recibos) {
    const k = `${x.rfcTrabajador}|${x.mes}`;
    if (!grupos.has(k)) grupos.set(k, {
      rfc: x.rfcTrabajador, nombre: x.nombreTrabajador, mes: x.mes,
      asimilado: esAsimiladoRegimen(x.regimen),
      gravado: 0, isrRetenido: 0, subsidio: 0, recibos: 0,
    });
    const g = grupos.get(k)!;
    g.gravado += x.gravado; g.isrRetenido += x.isr; g.subsidio += x.subsidio; g.recibos++;
    if (esAsimiladoRegimen(x.regimen)) g.asimilado = true;
  }

  const filas = Array.from(grupos.values()).map((g) => {
    const gravadoMes = r2(g.gravado);
    /* El ISR retenido (deducción 002) de un recibo puede venir BRUTO (tarifa) o
     * NETO (tarifa − subsidio) según el timbrador. Para no marcar falsos positivos
     * en quien trae subsidio, se recalcula el Art. 96 de las DOS formas y la
     * diferencia es contra la MÁS CERCANA: la retención válida debe coincidir con
     * una de las dos. Los asimilados no tienen subsidio (bruto = neto). */
    const neto = calcularIsr(gravadoMes, 'MENSUAL', e!, { sinSubsidio: g.asimilado });
    const bruto = calcularIsr(gravadoMes, 'MENSUAL', e!, { sinSubsidio: true });
    const isrNetoTabla = r2(neto.isr);
    const isrBrutoTabla = r2(bruto.isr);
    const isrRetenido = r2(g.isrRetenido);
    const difNeto = r2(isrNetoTabla - isrRetenido);
    const difBruto = r2(isrBrutoTabla - isrRetenido);
    // + = la tabla pide más que lo retenido (faltó retener); − = se retuvo de más.
    const diferencia = Math.abs(difBruto) <= Math.abs(difNeto) ? difBruto : difNeto;
    const base = Math.abs(difBruto) <= Math.abs(difNeto) ? isrBrutoTabla : isrNetoTabla;
    const rel = base > 0 ? Math.abs(diferencia) / base : (Math.abs(diferencia) > 1 ? 1 : 0);
    return {
      rfc: g.rfc, nombre: g.nombre, mes: g.mes, nombreMes: MESES[g.mes - 1] || String(g.mes),
      asimilado: g.asimilado, recibos: g.recibos, gravado: gravadoMes,
      isrRetenido, subsidio: r2(g.subsidio),
      isrBrutoTabla, isrNetoTabla, subsidioTabla: r2(neto.subsidio), diferencia,
      marca: Math.abs(diferencia) > 1 && rel > 0.01,           // se resalta sólo lo relevante (>$1 y >1%)
    };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.mes - b.mes);

  const conDif = filas.filter((f) => f.marca);
  return {
    anio, anioParametros: e.anio, aviso: '',
    filas,
    resumen: {
      meses: filas.length,
      conDiferencia: conDif.length,
      totalDiferencia: r2(conDif.reduce((s, f) => s + f.diferencia, 0)),
    },
  };
}

function vacioIsr(anio: number, aviso: string) {
  return { anio, anioParametros: anio, aviso, filas: [] as any[], resumen: { meses: 0, conDiferencia: 0, totalDiferencia: 0 } };
}

/**
 * Revisión de cálculos — IMSS (cuota obrera) e Infonavit.
 *
 * IMSS: por recibo recalcula la cuota obrera (LSS Art. 106/147/168) con el SDI y
 * los días del propio CFDI (`motor.calcularImssObrero`, topes y exención de salario
 * mínimo incluidos) y la coteja, acumulada por mes, contra el IMSS retenido
 * (deducción 001). El SDI sale del complemento (`SalarioDiarioIntegrado`); el
 * salario diario para la exención del Art. 36 se aproxima con el sueldo (percepción
 * 001) entre los días. La ZONA sale del expediente cuando el trabajador existe.
 *
 * Infonavit: el CFDI NO trae las condiciones del crédito (tipo/factor). Cuando el
 * trabajador EXISTE en el expediente con crédito, se RECALCULA con sus datos
 * (`motor.calcularInfonavit`, Ley Infonavit Art. 29 Fr. III) y se coteja contra el
 * descuento (deducción 009), contra la más cercana entre crédito y crédito+seguro.
 * Si NO hay crédito en el expediente, se hace sólo una revisión de CONSISTENCIA:
 * se marca «posible omisión» cuando el trabajador trae crédito en otros meses pero
 * $0 en éste.
 */
export async function revisionCalculosImss(companyId: string, anio: number) {
  const recibos = await cargarRecibos(companyId, anio);

  let e;
  try { e = await ejercicios.cargar(anio); }
  catch { return vacioSs(anio, `No hay parámetros de nómina cargados para ${anio}. Captúralos en Nómina → Parámetros.`); }
  if (!e.umaDiaria || !e.smgGeneral) {
    return vacioSs(anio, `Faltan la UMA y/o el salario mínimo de ${anio}. Captúralos en Nómina → Parámetros para recalcular el IMSS.`);
  }

  const emps = await cargarEmpleados(companyId);
  const buscaEmp = (x: ReciboRevision): EmpInfonavit | null =>
    emps.porRfc.get((x.rfcTrabajador || '').toUpperCase())
    || (x.nss ? emps.porNss.get(x.nss) : undefined)
    || (x.curp ? emps.porCurp.get((x.curp || '').toUpperCase()) : undefined)
    || null;

  type G = {
    rfc: string; nombre: string; mes: number; dias: number; sdi: number;
    imssRetenido: number; imssRecalc: number;
    infonavit: number; infCredito: number; infTotal: number; conCredito: boolean; recibos: number;
  };
  const grupos = new Map<string, G>();
  const mesesInfonavit = new Map<string, Set<number>>();   // rfc → meses con descuento (para huecos)
  let faltaUmi = false;

  for (const x of recibos) {
    const dias = x.diasPagados || 0;
    const sdi = x.sdi || x.sbc || 0;
    const salarioDiario = dias > 0 && x.sueldoBase > 0 ? r2(x.sueldoBase / dias) : sdi;
    const emp = buscaEmp(x);
    const zona: Zona = emp?.zona || 'general';
    const imss = sdi > 0 && dias > 0 ? calcularImssObrero(salarioDiario, sdi, dias, zona, e!).total : 0;

    // Infonavit recalculado desde el crédito del expediente (si aplica a la fecha).
    let infCredito = 0, infTotal = 0, conCredito = false;
    if (emp?.tiene && emp.tipo && emp.valor != null && sdi > 0 && dias > 0) {
      const fechaRef = /^\d{4}-\d{2}-\d{2}/.test(x.fechaPago) ? x.fechaPago.slice(0, 10) : x.fecha;
      if (!emp.desde || fechaRef >= emp.desde) {
        const datos: DatosInfonavit = {
          tiene: true, tipo: emp.tipo as DatosInfonavit['tipo'], valor: emp.valor, seguroDanosDiario: emp.seguro,
        };
        try {
          const inf = calcularInfonavit(datos, sdi, dias, zona, e!);
          infCredito = inf.credito; infTotal = inf.total; conCredito = true;
        } catch { faltaUmi = true; }   // crédito en VSM sin UMI cargada: no se recalcula ése
      }
    }

    const k = `${x.rfcTrabajador}|${x.mes}`;
    if (!grupos.has(k)) grupos.set(k, {
      rfc: x.rfcTrabajador, nombre: x.nombreTrabajador, mes: x.mes,
      dias: 0, sdi: 0, imssRetenido: 0, imssRecalc: 0,
      infonavit: 0, infCredito: 0, infTotal: 0, conCredito: false, recibos: 0,
    });
    const g = grupos.get(k)!;
    g.dias += dias; g.sdi = sdi || g.sdi; g.imssRetenido += x.imss; g.imssRecalc += imss;
    g.infonavit += x.infonavit; g.infCredito += infCredito; g.infTotal += infTotal;
    if (conCredito) g.conCredito = true;
    g.recibos++;

    if (x.infonavit > 0) {
      if (!mesesInfonavit.has(x.rfcTrabajador)) mesesInfonavit.set(x.rfcTrabajador, new Set());
      mesesInfonavit.get(x.rfcTrabajador)!.add(x.mes);
    }
  }

  const filas = Array.from(grupos.values()).map((g) => {
    const imssRetenido = r2(g.imssRetenido);
    const imssRecalc = r2(g.imssRecalc);
    const difImss = r2(imssRecalc - imssRetenido);          // + = se retuvo de menos; − = de más
    const relI = imssRecalc > 0 ? Math.abs(difImss) / imssRecalc : (Math.abs(difImss) > 1 ? 1 : 0);

    const infonavit = r2(g.infonavit);                       // descontado (deducción 009)
    const infCredito = r2(g.infCredito);
    const infTotal = r2(g.infTotal);
    // Diferencia contra la más cercana (crédito solo o crédito+seguro), como en ISR/IMSS.
    const infRecalc = Math.abs(infonavit - infCredito) <= Math.abs(infonavit - infTotal) ? infCredito : infTotal;
    const difInf = g.conCredito ? r2(infRecalc - infonavit) : 0;
    const relInf = infRecalc > 0 ? Math.abs(difInf) / infRecalc : (Math.abs(difInf) > 1 ? 1 : 0);

    const mesesConInf = mesesInfonavit.get(g.rfc);
    const tieneCreditoHabitual = !!mesesConInf && mesesConInf.size >= 2;
    return {
      rfc: g.rfc, nombre: g.nombre, mes: g.mes, nombreMes: MESES[g.mes - 1] || String(g.mes),
      recibos: g.recibos, dias: g.dias, sdi: r2(g.sdi),
      imssRetenido, imssRecalc, difImss,
      marcaImss: Math.abs(difImss) > 5 && relI > 0.02,        // IMSS tolera un poco más (redondeos de topes)
      infonavit, conCredito: g.conCredito, infRecalc: r2(infRecalc), difInf,
      marcaInf: g.conCredito && Math.abs(difInf) > 5 && relInf > 0.02,
      posibleOmisionInf: !g.conCredito && tieneCreditoHabitual && g.infonavit <= 0,
    };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.mes - b.mes);

  const conDifImss = filas.filter((f) => f.marcaImss);
  const conDifInf = filas.filter((f) => f.marcaInf);
  const omisionesInf = filas.filter((f) => f.posibleOmisionInf);
  return {
    anio, anioParametros: e.anio, aviso: '',
    nota: faltaUmi ? `Algún crédito de Infonavit es en VSM y no hay UMI cargada para ${anio}; ése no se recalculó. Captúrala en Nómina → Parámetros.` : '',
    filas,
    resumen: {
      meses: filas.length,
      imssConDiferencia: conDifImss.length,
      imssTotalDiferencia: r2(conDifImss.reduce((s, f) => s + f.difImss, 0)),
      infonavitConDiferencia: conDifInf.length,
      infonavitTotalDiferencia: r2(conDifInf.reduce((s, f) => s + f.difInf, 0)),
      infonavitPosiblesOmisiones: omisionesInf.length,
    },
  };
}

function vacioSs(anio: number, aviso: string) {
  return {
    anio, anioParametros: anio, aviso, nota: '', filas: [] as any[],
    resumen: {
      meses: 0, imssConDiferencia: 0, imssTotalDiferencia: 0,
      infonavitConDiferencia: 0, infonavitTotalDiferencia: 0, infonavitPosiblesOmisiones: 0,
    },
  };
}
