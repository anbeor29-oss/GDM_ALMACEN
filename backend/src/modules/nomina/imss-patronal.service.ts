/**
 * imss-patronal.service — lo que la nómina le cuesta a la empresa ADEMÁS del sueldo.
 *
 * PARA QUÉ SIRVE
 * Para provisionar. La cuota obrera se retiene —sale del sueldo del trabajador—
 * pero la patronal es dinero de la empresa que hay que apartar cada periodo y
 * que se paga al IMSS al mes siguiente. Sin este número, contabilidad provisiona
 * a ojo.
 *
 * ES UNA ESTIMACIÓN, Y HAY QUE DECIRLO
 * El IMSS liquida con SUS registros: sus movimientos de alta y baja, sus días
 * cotizados, su prima de riesgo autorizada. Esto calcula con los del sistema. Se
 * parecerán mucho y servirán para reservar, pero la cifra que se paga es la que
 * emita el IMSS en su Sistema Único de Autodeterminación, no ésta.
 *
 * LAS RAMAS
 *   Enfermedad y maternidad   cuota fija sobre la UMA, excedente de 3 UMA,
 *                             prestaciones en dinero, gastos médicos de
 *                             pensionados
 *   Invalidez y vida          sobre el SBC
 *   Riesgos de trabajo        la prima de ESTA empresa — si no está capturada,
 *                             se dice, no se inventa
 *   Guarderías                sobre el SBC
 *   Retiro                    sobre el SBC
 *   Cesantía y vejez          escala por rango de salario; sube cada año hasta
 *                             2030 por la reforma de pensiones
 *   INFONAVIT                 5% del SBC — no es IMSS pero se paga junto y se
 *                             provisiona igual
 */

import { query } from '../../config/database';
import { pesos } from './motor';

export interface TasasImss {
  anio: number;
  em_cuota_fija_pct: number;
  em_excedente_patron_pct: number;
  em_dinero_patron_pct: number;
  em_pensionados_patron_pct: number;
  iv_patron_pct: number;
  guarderias_pct: number;
  retiro_pct: number;
  infonavit_pct: number;
  escalaCv: Array<{ desde_uma: number; hasta_uma: number | null; es_minimo: boolean; patron_pct: number }>;
  fuente?: string;
  confirmado?: boolean;
}

/** Las tasas del ejercicio. Sin ellas no se calcula: no se inventan. */
export async function cargarTasas(anio: number): Promise<TasasImss | null> {
  const t = await query<any>(`SELECT * FROM nomina_cuotas_imss WHERE anio = $1`, [anio]);
  if (t.rows.length === 0) return null;

  const cv = await query<any>(
    `SELECT desde_uma, hasta_uma, es_minimo, patron_pct
       FROM nomina_cuotas_cv_patron WHERE anio = $1 ORDER BY renglon`,
    [anio]
  );
  const n = (v: any) => Number(v);
  const r = t.rows[0];
  return {
    anio,
    em_cuota_fija_pct: n(r.em_cuota_fija_pct),
    em_excedente_patron_pct: n(r.em_excedente_patron_pct),
    em_dinero_patron_pct: n(r.em_dinero_patron_pct),
    em_pensionados_patron_pct: n(r.em_pensionados_patron_pct),
    iv_patron_pct: n(r.iv_patron_pct),
    guarderias_pct: n(r.guarderias_pct),
    retiro_pct: n(r.retiro_pct),
    infonavit_pct: n(r.infonavit_pct),
    escalaCv: cv.rows.map((x) => ({
      desde_uma: n(x.desde_uma),
      hasta_uma: x.hasta_uma === null ? null : n(x.hasta_uma),
      es_minimo: x.es_minimo,
      patron_pct: n(x.patron_pct),
    })),
    fuente: r.fuente,
    confirmado: r.confirmado,
  };
}

/**
 * El porcentaje de Cesantía y Vejez que le toca al patrón por ESTE trabajador.
 *
 * No es una tasa única: depende de cuántas UMA gana. Quien está al salario
 * mínimo se queda en la tasa base y no sube nunca —esa fue la protección de la
 * reforma—, y de ahí para arriba la escala crece por tramos.
 */
export function porcentajeCv(
  sbc: number,
  salarioMinimo: number,
  umaDiaria: number,
  escala: TasasImss['escalaCv']
): number {
  if (escala.length === 0) return 0;

  /* Al mínimo, la tasa base. Se compara contra el salario mínimo y no contra la
   * UMA porque así lo dice el transitorio: el renglón se llama "1 SM". */
  if (sbc <= salarioMinimo) {
    const base = escala.find((e) => e.es_minimo);
    if (base) return base.patron_pct;
  }

  const enUma = umaDiaria > 0 ? sbc / umaDiaria : 0;
  for (const e of escala) {
    if (e.es_minimo) continue;
    const dentro =
      enUma >= e.desde_uma && (e.hasta_uma === null || enUma <= e.hasta_uma);
    if (dentro) return e.patron_pct;
  }
  /* Arriba del último tramo: el último renglón es abierto y ya debió atrapar.
   * Si no lo hizo, se usa el mayor en vez de devolver cero, que provisionaría
   * de menos justo en los sueldos más caros. */
  return Math.max(...escala.map((e) => e.patron_pct));
}

export interface CuotaPatronal {
  emCuotaFija: number;
  emExcedente: number;
  emDinero: number;
  emPensionados: number;
  invalidezVida: number;
  riesgosTrabajo: number;
  guarderias: number;
  retiro: number;
  cesantiaVejez: number;
  totalImss: number;
  infonavit: number;
  /** IMSS + INFONAVIT: lo que de verdad hay que apartar. */
  total: number;
  cvPorcentaje: number;
  avisos: string[];
}

/**
 * La cuota patronal de UN trabajador en UN periodo.
 *
 * El SBC se topa a 25 UMA (Art. 28 LSS) igual que en la cuota obrera: cotizar
 * sobre más de eso pagaría de más y descuadraría contra la liquidación del
 * IMSS, que sí topa.
 */
export function calcularPatronal(d: {
  sbc: number;
  dias: number;
  umaDiaria: number;
  salarioMinimo: number;
  primaRiesgo: number | null;
  tasas: TasasImss;
}): CuotaPatronal {
  const avisos: string[] = [];
  const vacio: CuotaPatronal = {
    emCuotaFija: 0, emExcedente: 0, emDinero: 0, emPensionados: 0,
    invalidezVida: 0, riesgosTrabajo: 0, guarderias: 0, retiro: 0,
    cesantiaVejez: 0, totalImss: 0, infonavit: 0, total: 0,
    cvPorcentaje: 0, avisos,
  };

  const dias = Number(d.dias) || 0;
  const uma = Number(d.umaDiaria) || 0;
  if (dias <= 0 || uma <= 0) return vacio;

  const tope = uma * 25;
  const sbc = Math.min(Number(d.sbc) || 0, tope);
  if (sbc <= 0) return vacio;

  const t = d.tasas;
  const pct = (p: number) => p / 100;

  /* Cuota fija: es sobre la UMA, no sobre el salario. La paga igual el patrón
   * por el que gana el mínimo que por el director. */
  const emCuotaFija = uma * pct(t.em_cuota_fija_pct) * dias;

  /* Excedente: sólo lo que pasa de TRES UMA. Quien gana menos no lo causa. */
  const tresUma = uma * 3;
  const emExcedente = sbc > tresUma
    ? (sbc - tresUma) * pct(t.em_excedente_patron_pct) * dias
    : 0;

  const emDinero      = sbc * pct(t.em_dinero_patron_pct) * dias;
  const emPensionados = sbc * pct(t.em_pensionados_patron_pct) * dias;
  const invalidezVida = sbc * pct(t.iv_patron_pct) * dias;
  const guarderias    = sbc * pct(t.guarderias_pct) * dias;
  const retiro        = sbc * pct(t.retiro_pct) * dias;

  const cvPorcentaje = porcentajeCv(sbc, d.salarioMinimo, uma, t.escalaCv);
  const cesantiaVejez = sbc * pct(cvPorcentaje) * dias;

  /* Riesgos de trabajo: la prima es de CADA empresa y la autoriza el IMSS con
   * su siniestralidad. Sin ella no se adivina — se dice y la provisión queda
   * corta a sabiendas, que es mejor que quedar corta sin saberlo. */
  let riesgosTrabajo = 0;
  if (d.primaRiesgo === null || d.primaRiesgo === undefined || Number(d.primaRiesgo) <= 0) {
    avisos.push(
      'La empresa no tiene capturada su prima de riesgo de trabajo, así que esa ' +
      'rama va en cero y la provisión queda corta. Se captura en Nómina → Parámetros.'
    );
  } else {
    riesgosTrabajo = sbc * pct(Number(d.primaRiesgo)) * dias;
  }

  const infonavit = sbc * pct(t.infonavit_pct) * dias;

  const totalImss = emCuotaFija + emExcedente + emDinero + emPensionados +
                    invalidezVida + riesgosTrabajo + guarderias + retiro + cesantiaVejez;

  return {
    emCuotaFija:    pesos(emCuotaFija),
    emExcedente:    pesos(emExcedente),
    emDinero:       pesos(emDinero),
    emPensionados:  pesos(emPensionados),
    invalidezVida:  pesos(invalidezVida),
    riesgosTrabajo: pesos(riesgosTrabajo),
    guarderias:     pesos(guarderias),
    retiro:         pesos(retiro),
    cesantiaVejez:  pesos(cesantiaVejez),
    totalImss:      pesos(totalImss),
    infonavit:      pesos(infonavit),
    total:          pesos(totalImss + infonavit),
    cvPorcentaje,
    avisos,
  };
}
