/**
 * Cédulas fiscales (papel de trabajo) — determinación mensual de impuestos.
 *
 *   · ISR de PERSONA FÍSICA con Actividad Empresarial y Profesional (régimen 612):
 *     pago provisional ACUMULADO. Ingresos acumulables − deducciones acumuladas −
 *     pérdida fiscal = base; se aplica la tarifa del Art. 96 ACUMULADA al mes
 *     (límite inferior, excedente × %, + cuota fija, todo × número de mes); menos
 *     pagos provisionales previos, subsidio e ISR retenido = ISR por pagar.
 *
 *   · CÉDULA DE IVA (mensual, definitivo) — sirve para TODOS los regímenes: IVA
 *     trasladado (16/8/0/exento − retenido) contra IVA acreditable, con arrastre
 *     del saldo a favor.
 *
 * Los datos salen de la bóveda de CFDI: ingresos = EMITIDOS (tipo I), deducciones
 * = RECIBIDOS con XML. La tarifa ISR mensual vive en `nomina_tarifa_isr` (la misma
 * que cotejó Nómina). PRIMERA VERSIÓN: validar contra el papel de trabajo del
 * contador (base de flujo/efectivo, deducciones personales y pérdidas quedan como
 * afinación posterior).
 */
import { query } from '../../config/database';
import { impuestosDeXml } from './diot.service';
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

/** Agrupa por mes (1..12) los CFDI tipo I con XML de una dirección, con su desglose. */
async function porMes(companyId: string, direccion: 'emitidos' | 'recibidos', anio: number): Promise<MesAgg[]> {
  const r = await query<any>(
    `SELECT EXTRACT(MONTH FROM fecha_emision)::int AS mes, xml
       FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion=$2 AND tipo_comprobante='I' AND xml IS NOT NULL
        AND (estado_sat IS NULL OR estado_sat <> 'Cancelado')
        AND EXTRACT(YEAR FROM fecha_emision) = $3`,
    [companyId, direccion, anio]);
  const meses: MesAgg[] = Array.from({ length: 12 }, mesVacio);
  for (const row of r.rows) {
    const m = Number(row.mes);
    if (m < 1 || m > 12) continue;
    const imp = impuestosDeXml(String(row.xml));
    const a = meses[m - 1];
    a.base16 += imp.base16; a.iva16 += imp.iva16;
    a.base8 += imp.base8; a.iva8 += imp.iva8;
    a.base0 += imp.base0; a.exento += imp.exento; a.ivaRet += imp.ivaRet;
    a.isrRet += isrRetenidoDeXml(String(row.xml));
    a.subtotal += imp.base16 + imp.base8 + imp.base0 + imp.exento;
  }
  return meses.map((a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, r2(v)])) as unknown as MesAgg);
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
    porMes(companyId, 'emitidos', anio),
    porMes(companyId, 'recibidos', anio),
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
    porMes(companyId, 'emitidos', anio),
    porMes(companyId, 'recibidos', anio),
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

/** El régimen fiscal de la empresa (para activar la cédula correcta). */
export async function regimenEmpresa(companyId: string): Promise<string> {
  const r = await query<any>(`SELECT fiscal_regime FROM companies WHERE id=$1`, [companyId]);
  if (!r.rows.length) throw new NotFoundError('Empresa no encontrada');
  return String(r.rows[0].fiscal_regime || '');
}
