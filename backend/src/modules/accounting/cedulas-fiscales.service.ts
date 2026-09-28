/**
 * Cédulas fiscales (papel de trabajo) — determinación mensual de impuestos.
 *
 *   · ISR de PERSONA FÍSICA con Actividad Empresarial y Profesional (régimen 612):
 *     pago provisional ACUMULADO. Ingresos acumulables − deducciones acumuladas −
 *     pérdida fiscal = base; se aplica la tarifa del Art. 96 ACUMULADA al mes
 *     (límite inferior, excedente × %, + cuota fija, todo × número de mes); menos
 *     pagos provisionales previos, subsidio e ISR retenido = ISR por pagar.
 *
 *   · ISR del RÉGIMEN SIMPLIFICADO DE CONFIANZA (626, RESICO PF): ingresos cobrados
 *     × tasa de la tabla del Art. 113-E, sin deducciones; menos el ISR retenido.
 *
 *   · CÉDULA DE IVA (mensual, definitivo) — sirve para TODOS los regímenes: IVA
 *     trasladado (16/8/0/exento − retenido) contra IVA acreditable, con arrastre
 *     del saldo a favor.
 *
 * BASE DE FLUJO DE EFECTIVO: se reconoce lo COBRADO/PAGADO — los CFDI PUE en su mes
 * de emisión y los PPD en el mes de su complemento de pago (tipo P). Los datos salen
 * de la bóveda de CFDI (ingresos = EMITIDOS, deducciones = RECIBIDOS); la tarifa ISR
 * mensual vive en `nomina_tarifa_isr`. PRIMERA VERSIÓN: validar contra el papel de
 * trabajo del contador (deducciones personales, pérdidas y el desglose por tasa del
 * complemento quedan como afinación posterior).
 */
import { query } from '../../config/database';
import { impuestosDeXml } from './diot.service';
import { complementoDeXml } from './ventas-cuentas.service';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const attr = (s: string, n: string) => {
  const m = new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`).exec(s);
  return m ? m[1] : '';
};
/** ISR retenido a nivel comprobante (retención impuesto 001). */
function isrRetenidoDeXml(xml: string): number {
  const i = xml.search(/<\/(?:\w+:)?Conceptos>/);
  const cuerpo = i >= 0 ? xml.slice(i) : xml;
  let isr = 0;
  for (const r of cuerpo.match(/<(?:\w+:)?Retencion\b[^>]*?\/?>/g) || []) {
    if (attr(r, 'Impuesto') === '001') isr += Number(attr(r, 'Importe')) || 0;
  }
  return isr;
}

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

interface MesAgg {
  base16: number; iva16: number; base8: number; iva8: number; base0: number; exento: number;
  ivaRet: number; isrRet: number; subtotal: number;
}
const mesVacio = (): MesAgg => ({ base16: 0, iva16: 0, base8: 0, iva8: 0, base0: 0, exento: 0, ivaRet: 0, isrRet: 0, subtotal: 0 });

function sumaImp(a: MesAgg, imp: ReturnType<typeof impuestosDeXml>, isrRet: number) {
  a.base16 += imp.base16; a.iva16 += imp.iva16;
  a.base8 += imp.base8; a.iva8 += imp.iva8;
  a.base0 += imp.base0; a.exento += imp.exento; a.ivaRet += imp.ivaRet;
  a.isrRet += isrRet;
  a.subtotal += imp.base16 + imp.base8 + imp.base0 + imp.exento;
}
const redondearMes = (a: MesAgg): MesAgg =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, r2(v)])) as unknown as MesAgg;

/**
 * Agrupa por mes (1..12) en BASE DE FLUJO DE EFECTIVO (lo cobrado/pagado):
 *   · CFDI tipo I con MetodoPago = PUE (pago en una exhibición) → en su mes de emisión.
 *   · Complementos de pago (tipo P) → en el mes del complemento (lo cobrado/pagado de
 *     los PPD). Los PPD tipo I NO se cuentan al emitirse: se reconocen al pagarse.
 * (v1: el desglose del complemento va a la tasa 16 %; el total sí es exacto.)
 */
async function porMesFlujo(companyId: string, direccion: 'emitidos' | 'recibidos', anio: number): Promise<MesAgg[]> {
  const meses: MesAgg[] = Array.from({ length: 12 }, mesVacio);

  const pue = await query<any>(
    `SELECT EXTRACT(MONTH FROM fecha_emision)::int AS mes, xml
       FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion=$2 AND tipo_comprobante='I' AND metodo_pago='PUE' AND xml IS NOT NULL
        AND (estado_sat IS NULL OR estado_sat <> 'Cancelado')
        AND EXTRACT(YEAR FROM fecha_emision) = $3`,
    [companyId, direccion, anio]);
  for (const row of pue.rows) {
    const m = Number(row.mes); if (m < 1 || m > 12) continue;
    sumaImp(meses[m - 1], impuestosDeXml(String(row.xml)), isrRetenidoDeXml(String(row.xml)));
  }

  const comp = await query<any>(
    `SELECT EXTRACT(MONTH FROM fecha_emision)::int AS mes, xml
       FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion=$2 AND tipo_comprobante='P' AND xml IS NOT NULL
        AND (estado_sat IS NULL OR estado_sat <> 'Cancelado')
        AND EXTRACT(YEAR FROM fecha_emision) = $3`,
    [companyId, direccion, anio]);
  for (const row of comp.rows) {
    const m = Number(row.mes); if (m < 1 || m > 12) continue;
    const c = complementoDeXml(String(row.xml));
    const base = r2(c.monto - c.iva);   // Monto incluye IVA; la base cobrada es la diferencia.
    const a = meses[m - 1];
    a.base16 += base; a.iva16 += c.iva; a.subtotal += base;
    a.isrRet += isrRetenidoDeXml(String(row.xml));
  }

  return meses.map(redondearMes);
}

/** La tarifa ISR mensual (Art. 96) del año, para derivar la acumulada del mes. */
async function tarifaMensual(anio: number) {
  const r = await query<any>(
    `SELECT limite_inferior, limite_superior, cuota_fija, porcentaje
       FROM nomina_tarifa_isr WHERE anio=$1 AND periodicidad='MENSUAL'
      ORDER BY limite_inferior`, [anio]);
  if (!r.rows.length) {
    throw new ValidationError(`Faltan las tarifas de ISR mensual de ${anio}. Cárgalas en Nómina → Parámetros.`);
  }
  return r.rows.map((t: any) => ({
    li: Number(t.limite_inferior), ls: t.limite_superior == null ? Infinity : Number(t.limite_superior),
    cuota: Number(t.cuota_fija), pct: Number(t.porcentaje),
  }));
}

/** ISR sobre una base con la tarifa ACUMULADA al mes N (tarifa mensual × N). */
function isrDeBase(base: number, tarifa: Array<{ li: number; ls: number; cuota: number; pct: number }>, n: number) {
  if (base <= 0) return { li: 0, excedente: 0, pct: 0, marginal: 0, cuota: 0, determinado: 0 };
  // Renglón cuya (li×n) ≤ base ≤ (ls×n).
  let row = tarifa[0];
  for (const t of tarifa) { if (base >= t.li * n) row = t; else break; }
  const li = r2(row.li * n), cuota = r2(row.cuota * n);
  const excedente = r2(base - li);
  const marginal = r2(excedente * row.pct);
  return { li, excedente, pct: row.pct, marginal, cuota, determinado: r2(marginal + cuota) };
}

/** Cédula de ISR — PF con Actividad Empresarial y Profesional (612). */
export async function cedulaIsrPF(companyId: string, anio: number) {
  const [ingresos, deducciones, tarifa] = await Promise.all([
    porMesFlujo(companyId, 'emitidos', anio),
    porMesFlujo(companyId, 'recibidos', anio),
    tarifaMensual(anio),
  ]);

  const filas: any[] = [];
  let ingAcum = 0, dedAcum = 0, isrRetAcum = 0, pagosPrevios = 0;
  for (let i = 0; i < 12; i++) {
    const ingMes = ingresos[i].subtotal;
    const dedMes = deducciones[i].subtotal;
    ingAcum = r2(ingAcum + ingMes);
    dedAcum = r2(dedAcum + dedMes);
    isrRetAcum = r2(isrRetAcum + ingresos[i].isrRet);
    const base = Math.max(0, r2(ingAcum - dedAcum));
    const t = isrDeBase(base, tarifa, i + 1);
    const porPagar = Math.max(0, r2(t.determinado - pagosPrevios - isrRetAcum));
    filas.push({
      mes: MESES[i], n: i + 1,
      ingresoMes: ingMes, ingresoAcum: ingAcum,
      deduccionMes: dedMes, deduccionAcum: dedAcum,
      base, limiteInferior: t.li, excedente: t.excedente, pct: t.pct,
      marginal: t.marginal, cuotaFija: t.cuota, determinado: t.determinado,
      pagosProvPrevios: pagosPrevios, isrRetenidoAcum: isrRetAcum, isrPorPagar: porPagar,
    });
    pagosPrevios = r2(pagosPrevios + porPagar);
  }
  return { anio, regimen: '612', filas };
}

/** Cédula de IVA (mensual definitivo) — para cualquier régimen. */
export async function cedulaIva(companyId: string, anio: number) {
  const [ing, ded] = await Promise.all([
    porMesFlujo(companyId, 'emitidos', anio),
    porMesFlujo(companyId, 'recibidos', anio),
  ]);
  const filas: any[] = [];
  let saldoFavor = 0;
  for (let i = 0; i < 12; i++) {
    const trasladado = r2(ing[i].iva16 + ing[i].iva8 - ing[i].ivaRet);   // menos lo que le retuvieron
    const acreditable = r2(ded[i].iva16 + ded[i].iva8);
    const aCargoBruto = Math.max(0, r2(trasladado - acreditable));
    const aFavorMes = Math.max(0, r2(acreditable - trasladado));
    // El saldo a favor previo reduce el cargo; lo que sobra se arrastra.
    const acreditadoDeSaldo = Math.min(saldoFavor, aCargoBruto);
    const aCargo = r2(aCargoBruto - acreditadoDeSaldo);
    saldoFavor = r2(saldoFavor - acreditadoDeSaldo + aFavorMes);
    filas.push({
      mes: MESES[i], n: i + 1,
      base16Ing: ing[i].base16, base8Ing: ing[i].base8, base0Ing: ing[i].base0, exentoIng: ing[i].exento,
      trasladado16: ing[i].iva16, trasladado8: ing[i].iva8, ivaRetenido: ing[i].ivaRet, trasladado,
      baseAcred: r2(ded[i].base16 + ded[i].base8), acreditable16: ded[i].iva16, acreditable8: ded[i].iva8, acreditable,
      aCargoPeriodo: aCargoBruto, aFavorPeriodo: aFavorMes, saldoFavorArrastre: saldoFavor, aCargo,
    });
  }
  return { anio, filas };
}

/* Tarifa mensual del RESICO (Art. 113-E LISR): tasa sobre ingresos cobrados. */
const TABLA_RESICO: Array<{ hasta: number; tasa: number }> = [
  { hasta: 25000, tasa: 0.01 },
  { hasta: 50000, tasa: 0.011 },
  { hasta: 83333.33, tasa: 0.015 },
  { hasta: 208333.33, tasa: 0.02 },
  { hasta: 3500000, tasa: 0.025 },
];
const tasaResico = (ingreso: number) =>
  (TABLA_RESICO.find((t) => ingreso <= t.hasta) || TABLA_RESICO[TABLA_RESICO.length - 1]).tasa;

/**
 * Cédula de ISR — Régimen Simplificado de Confianza (626, PF): el ISR del mes es
 * los ingresos EFECTIVAMENTE COBRADOS × la tasa de la tabla (SIN deducciones para
 * ISR); menos el ISR retenido (1.25 % que retienen las personas morales, Art. 113-J).
 */
export async function cedulaResico(companyId: string, anio: number) {
  const ing = await porMesFlujo(companyId, 'emitidos', anio);
  const filas: any[] = [];
  for (let i = 0; i < 12; i++) {
    const ingreso = ing[i].subtotal;
    const tasa = tasaResico(ingreso);
    const determinado = r2(ingreso * tasa);
    const isrRet = ing[i].isrRet;
    const porPagar = Math.max(0, r2(determinado - isrRet));
    filas.push({ mes: MESES[i], n: i + 1, ingreso, tasa, isrDeterminado: determinado, isrRetenido: isrRet, isrPorPagar: porPagar });
  }
  return { anio, regimen: '626', filas };
}

/** Agrupa por mes en base DEVENGADA (todos los tipo I en su mes de emisión). Para
 *  personas MORALES (601), cuyo ISR provisional es sobre ingresos NOMINALES. */
async function porMesDevengado(companyId: string, direccion: 'emitidos' | 'recibidos', anio: number): Promise<MesAgg[]> {
  const meses: MesAgg[] = Array.from({ length: 12 }, mesVacio);
  const r = await query<any>(
    `SELECT EXTRACT(MONTH FROM fecha_emision)::int AS mes, xml
       FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion=$2 AND tipo_comprobante='I' AND xml IS NOT NULL
        AND (estado_sat IS NULL OR estado_sat <> 'Cancelado')
        AND EXTRACT(YEAR FROM fecha_emision) = $3`,
    [companyId, direccion, anio]);
  for (const row of r.rows) {
    const m = Number(row.mes); if (m < 1 || m > 12) continue;
    sumaImp(meses[m - 1], impuestosDeXml(String(row.xml)), isrRetenidoDeXml(String(row.xml)));
  }
  return meses.map(redondearMes);
}

/** Coeficiente de utilidad capturado (empresa/año); 0 si no se ha capturado. */
export async function getCoeficiente(companyId: string, anio: number): Promise<number> {
  const r = await query<any>(`SELECT coeficiente FROM cedula_pm_coeficiente WHERE company_id=$1 AND anio=$2`, [companyId, anio]);
  return r.rows.length ? Number(r.rows[0].coeficiente) : 0;
}
export async function setCoeficiente(companyId: string, anio: number, coef: any): Promise<{ coeficiente: number }> {
  const c = Math.max(0, Number(coef) || 0);
  if (c > 9.9999) throw new ValidationError('El coeficiente parece inválido (debe ir en fracción, p. ej. 0.1234).');
  await query(
    `INSERT INTO cedula_pm_coeficiente (company_id, anio, coeficiente, updated_at) VALUES ($1,$2,$3,NOW())
     ON CONFLICT (company_id, anio) DO UPDATE SET coeficiente=EXCLUDED.coeficiente, updated_at=NOW()`,
    [companyId, anio, c]);
  return { coeficiente: c };
}

/**
 * Cédula ISR — Persona Moral, Régimen General de Ley (601): pago provisional con el
 * COEFICIENTE DE UTILIDAD. Ingresos NOMINALES acumulados × coeficiente = utilidad
 * estimada; × 30 % = ISR; − pagos provisionales previos − ISR retenido = por pagar.
 * (v1: sin PTU ni pérdidas de ejercicios anteriores.)
 */
export async function cedulaPM601(companyId: string, anio: number) {
  const [ing, coef] = await Promise.all([porMesDevengado(companyId, 'emitidos', anio), getCoeficiente(companyId, anio)]);
  const filas: any[] = [];
  let ingAcum = 0, isrRetAcum = 0, pagosPrevios = 0;
  for (let i = 0; i < 12; i++) {
    const ingMes = ing[i].subtotal;
    ingAcum = r2(ingAcum + ingMes);
    isrRetAcum = r2(isrRetAcum + ing[i].isrRet);
    const utilidad = r2(ingAcum * coef);
    const determinado = r2(utilidad * 0.30);
    const porPagar = Math.max(0, r2(determinado - pagosPrevios - isrRetAcum));
    filas.push({
      mes: MESES[i], n: i + 1, ingresoMes: ingMes, ingresoAcum: ingAcum,
      coeficiente: coef, utilidad, tasa: 0.30, isrDeterminado: determinado,
      pagosProvPrevios: pagosPrevios, isrRetenidoAcum: isrRetAcum, isrPorPagar: porPagar,
    });
    pagosPrevios = r2(pagosPrevios + porPagar);
  }
  return { anio, regimen: '601', coeficiente: coef, filas };
}

/* ─────────────── PLATAFORMAS DIGITALES (625) ─────────────── */

/** Actividades de plataformas con su tasa de retención de ISR (Art. 113-A LISR). */
export const ACTIVIDADES_PLATAFORMA: Array<{ clave: string; nombre: string; tasaIsr: number }> = [
  { clave: 'PASAJE_ENTREGA', nombre: 'Transporte de pasajeros y entrega de bienes', tasaIsr: 0.021 },
  { clave: 'HOSPEDAJE', nombre: 'Servicios de hospedaje', tasaIsr: 0.04 },
  { clave: 'ENAJENACION', nombre: 'Enajenación de bienes y prestación de servicios', tasaIsr: 0.01 },
];
const CLAVES_PLAT = ACTIVIDADES_PLATAFORMA.map((a) => a.clave);

/** Guarda (batch) los ingresos capturados por actividad y mes. */
export async function setPlataformas(companyId: string, anio: number, filas: Array<{ mes: number; actividad: string; ingreso: number }>) {
  let n = 0;
  for (const f of filas || []) {
    const mes = Number(f.mes);
    if (mes < 1 || mes > 12 || !CLAVES_PLAT.includes(f.actividad)) continue;
    await query(
      `INSERT INTO cedula_plataformas (company_id, anio, mes, actividad, ingreso, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (company_id, anio, mes, actividad) DO UPDATE SET ingreso=EXCLUDED.ingreso, updated_at=NOW()`,
      [companyId, anio, mes, f.actividad, r2(f.ingreso)]);
    n++;
  }
  return { guardadas: n };
}

/**
 * Cédula de Plataformas Digitales (625): por ACTIVIDAD y mes, el ISR retenido por la
 * plataforma (ingreso × tasa Art. 113-A) y el IVA (causado 16 %, retenido 8 %). Los
 * ingresos salen de la captura (`cedula_plataformas`); la vía automática desde los
 * CFDI de retención queda pendiente (hoy esos CFDI no se ingestan como tipo I).
 */
export async function cedulaPlataformas(companyId: string, anio: number) {
  const r = await query<any>(
    `SELECT mes, actividad, ingreso FROM cedula_plataformas WHERE company_id=$1 AND anio=$2`,
    [companyId, anio]);
  const capt = new Map<string, number>();   // `${mes}|${actividad}` → ingreso
  for (const row of r.rows) capt.set(`${row.mes}|${row.actividad}`, Number(row.ingreso) || 0);

  const actividades = ACTIVIDADES_PLATAFORMA.map((act) => {
    const filas = [];
    for (let m = 1; m <= 12; m++) {
      const ingreso = r2(capt.get(`${m}|${act.clave}`) || 0);
      filas.push({
        mes: MESES[m - 1], n: m, ingreso,
        isrRetenido: r2(ingreso * act.tasaIsr),
        ivaCausado: r2(ingreso * 0.16),
        ivaRetenido: r2(ingreso * 0.08),
      });
    }
    return { clave: act.clave, nombre: act.nombre, tasaIsr: act.tasaIsr, filas };
  });
  return { anio, actividades };
}

/** El régimen fiscal de la empresa (para activar la cédula correcta). */
export async function regimenEmpresa(companyId: string): Promise<string> {
  const r = await query<any>(`SELECT fiscal_regime FROM companies WHERE id=$1`, [companyId]);
  if (!r.rows.length) throw new NotFoundError('Empresa no encontrada');
  return String(r.rows[0].fiscal_regime || '');
}
