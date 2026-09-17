/**
 * indicadores.service — los indicadores económicos oficiales que usa la
 * contabilidad y la nómina, en un solo lugar para consultarlos:
 *
 *   · INPC  — Índice Nacional de Precios al Consumidor (INEGI). MENSUAL. Se
 *             ACTUALIZA SOLO desde la API del Banco de Indicadores del INEGI
 *             (requiere un token gratuito en la variable de entorno INEGI_TOKEN).
 *             Vive en la tabla `fiscal_inpc`.
 *   · UMA / SM / UMI / Tarifa Art. 96 — ya viven versionados por año en
 *             `nomina_ejercicios` / `nomina_tarifa_isr` (se editan y confirman en
 *             Nómina → Parámetros). Aquí sólo se LEEN para mostrarlos juntos; no
 *             se duplican ni se editan desde aquí.
 *
 * POR QUÉ EL INPC SÍ SE BAJA SOLO Y LOS DEMÁS NO
 * El INPC tiene una API pública real (INEGI BIE) y cambia cada mes. La UMA se
 * publica una vez al año (INEGI, 1-feb), el salario mínimo otra (CONASAMI, 1-ene)
 * y la UMI otra (INFONAVIT, 1-ene) sin una API limpia; por eso ésos se capturan y
 * confirman a mano una vez al año, donde ya se hacía.
 */

import { query } from '../../config/database';

/* ── INPC almacenado ──────────────────────────────────────────────────────── */

export async function serieInpc(limite = 36) {
  const r = await query<any>(
    `SELECT anio, mes, valor::float, base, fuente,
            TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI') AS actualizado
       FROM fiscal_inpc ORDER BY anio DESC, mes DESC LIMIT $1`, [limite]);
  return r.rows;
}

async function ultimoInpc() {
  const r = await query<any>(
    `SELECT anio, mes, valor::float FROM fiscal_inpc ORDER BY anio DESC, mes DESC LIMIT 1`);
  return r.rows[0] || null;
}

/* ── Resumen combinado (lo que ve la pantalla) ────────────────────────────── */

export async function resumen() {
  const [inpc, ejercicios, tarifas] = await Promise.all([
    ultimoInpc(),
    query<any>(
      `SELECT anio, uma_diaria::float, uma_mensual::float, umi_diaria::float,
              smg_general::float, smg_frontera::float, confirmado
         FROM nomina_ejercicios ORDER BY anio DESC LIMIT 6`),
    query<any>(
      `SELECT anio, COUNT(*)::int AS renglones
         FROM nomina_tarifa_isr WHERE periodicidad='MENSUAL' GROUP BY anio`),
  ]);
  const isrPorAnio = new Map<number, number>(tarifas.rows.map((t: any) => [Number(t.anio), t.renglones]));
  const anios = ejercicios.rows.map((e: any) => ({
    anio: Number(e.anio),
    umaDiaria: e.uma_diaria, umaMensual: e.uma_mensual, umiDiaria: e.umi_diaria,
    smgGeneral: e.smg_general, smgFrontera: e.smg_frontera,
    confirmado: e.confirmado,
    renglonesIsr: isrPorAnio.get(Number(e.anio)) || 0,
  }));
  return {
    inpc: inpc ? { anio: Number(inpc.anio), mes: Number(inpc.mes), valor: inpc.valor } : null,
    ejercicios: anios,
    tieneToken: !!process.env.INEGI_TOKEN,
  };
}

/* ── Actualización automática del INPC desde el INEGI ─────────────────────── */

/* El indicador del INPC general (base 2ª quincena de julio 2018) en el Banco de
 * Indicadores del INEGI. Se puede sobreescribir con INEGI_INDICADOR_INPC si el
 * INEGI reasigna la clave (consolidó el BIE en dic-2025). */
const INDICADOR_INPC = process.env.INEGI_INDICADOR_INPC || '910417';
const FUENTE_INEGI = process.env.INEGI_FUENTE || 'BIE';

/** Baja la serie del INPC del INEGI y la guarda en `fiscal_inpc`. */
export async function actualizarInpc(): Promise<{ actualizados: number; desde?: string; hasta?: string; mensaje?: string }> {
  const token = process.env.INEGI_TOKEN;
  if (!token) {
    throw new Error(
      'Falta el token del INEGI. Regístrate gratis en la API del Banco de Indicadores del INEGI ' +
      'y pon el token en la variable de entorno INEGI_TOKEN (en Render).');
  }
  const url =
    `https://www.inegi.org.mx/app/api/indicadores/desarrolladores/jsonxml/INDICATOR/` +
    `${INDICADOR_INPC}/es/00/false/${FUENTE_INEGI}/2.0/${token}?type=json`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  let json: any;
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`El INEGI respondió ${resp.status}.`);
    json = await resp.json();
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('El INEGI no respondió a tiempo. Intenta de nuevo.');
    throw new Error(`No se pudo consultar el INEGI: ${e?.message || e}.`);
  } finally {
    clearTimeout(t);
  }

  // La API devuelve { Series: [ { OBSERVATIONS: [ { TIME_PERIOD:'2026/07', OBS_VALUE:'...' } ] } ] }
  const series = json?.Series?.[0]?.OBSERVATIONS || json?.series?.[0]?.OBSERVATIONS || [];
  if (!Array.isArray(series) || series.length === 0) {
    throw new Error('El INEGI no devolvió observaciones del INPC. Revisa el indicador (INEGI_INDICADOR_INPC).');
  }

  const filas: Array<{ anio: number; mes: number; valor: number }> = [];
  for (const o of series) {
    const per = String(o.TIME_PERIOD || o.time_period || '');
    const val = Number(o.OBS_VALUE ?? o.obs_value);
    const m = per.match(/^(\d{4})[/\-](\d{1,2})$/);   // 'YYYY/MM'
    if (!m || !Number.isFinite(val)) continue;
    filas.push({ anio: Number(m[1]), mes: Number(m[2]), valor: val });
  }
  if (!filas.length) throw new Error('No se pudieron interpretar las observaciones del INPC.');

  for (const f of filas) {
    await query(
      `INSERT INTO fiscal_inpc (anio, mes, valor, base, fuente, updated_at)
       VALUES ($1,$2,$3,$4,'INEGI API',NOW())
       ON CONFLICT (anio, mes) DO UPDATE
         SET valor=EXCLUDED.valor, base=EXCLUDED.base, fuente='INEGI API', updated_at=NOW()`,
      [f.anio, f.mes, f.valor, '2Q Jul 2018 = 100']);
  }

  filas.sort((a, b) => (a.anio - b.anio) || (a.mes - b.mes));
  const p = (x: { anio: number; mes: number }) => `${x.anio}-${String(x.mes).padStart(2, '0')}`;
  return { actualizados: filas.length, desde: p(filas[0]), hasta: p(filas[filas.length - 1]) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   CALCULADORAS QUE USAN EL INPC (a la orden cuando se necesiten)
   ═══════════════════════════════════════════════════════════════════════════ */

const r2 = (n: number) => Math.round(n * 100) / 100;
const f4 = (n: number) => Math.round(n * 10000) / 10000;   // factores: al diezmilésimo (Art. 17-A)

/** El INPC de un mes concreto; si no está, dice que se actualice. */
async function inpcDe(anio: number, mes: number): Promise<number> {
  const r = await query<any>(`SELECT valor::float FROM fiscal_inpc WHERE anio=$1 AND mes=$2`, [anio, mes]);
  if (!r.rows.length) {
    throw new Error(`No hay INPC de ${String(mes).padStart(2, '0')}/${anio}. Actualízalo desde INEGI (botón «Actualizar desde INEGI»).`);
  }
  return Number(r.rows[0].valor);
}

/** La tasa de recargos por mora del año (o la del año más cercano si falta). */
async function tasaRecargos(anio: number): Promise<number> {
  const r = await query<any>(`SELECT tasa_mora::float FROM fiscal_tasa_recargos WHERE anio=$1`, [anio]);
  if (r.rows.length) return Number(r.rows[0].tasa_mora);
  const f = await query<any>(`SELECT tasa_mora::float FROM fiscal_tasa_recargos ORDER BY ABS(anio-$1), anio DESC LIMIT 1`, [anio]);
  return f.rows.length ? Number(f.rows[0].tasa_mora) : 2.07;
}

interface Ymd { anio: number; mes: number; dia: number; }
function parseYmd(s: string): Ymd | null {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { anio: +m[1], mes: +m[2], dia: +m[3] };
}
const mesAnterior = (anio: number, mes: number) => mes <= 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
const mesSiguiente = (anio: number, mes: number) => mes >= 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 };

/* ── 1) Actualización + recargos (Art. 17-A y 21 CFF) — pagos extemporáneos ── */
export async function actualizacionRecargos(d: { monto: number; fechaDebio: string; fechaPago: string }) {
  const monto = Number(d.monto);
  if (!(monto > 0)) throw new Error('El monto debe ser mayor que cero.');
  const debio = parseYmd(d.fechaDebio), pago = parseYmd(d.fechaPago);
  if (!debio || !pago) throw new Error('Las fechas deben ser AAAA-MM-DD.');

  const clave = (x: Ymd) => x.anio * 372 + x.mes * 31 + x.dia;
  if (clave(pago) <= clave(debio)) {
    return { alCorriente: true, monto, fa: 1, montoActualizado: monto, actualizacion: 0, meses: 0, sumaTasas: 0, recargos: 0, total: monto };
  }

  // Actualización: INPC del mes anterior al pago / INPC del mes anterior al que debió pagarse.
  const antPago = mesAnterior(pago.anio, pago.mes);
  const antDebio = mesAnterior(debio.anio, debio.mes);
  const inpcPago = await inpcDe(antPago.anio, antPago.mes);
  const inpcDebio = await inpcDe(antDebio.anio, antDebio.mes);
  let fa = f4(inpcPago / inpcDebio);
  if (fa < 1) fa = 1;                                   // nunca a la baja (Art. 17-A)
  const montoActualizado = r2(monto * fa);
  const actualizacion = r2(montoActualizado - monto);

  // Meses de mora: cada mes o fracción a partir del día en que debió pagarse.
  let meses = (pago.anio - debio.anio) * 12 + (pago.mes - debio.mes);
  if (pago.dia > debio.dia) meses += 1;
  meses = Math.max(0, meses);

  // Recargos: suma de la tasa de cada mes de mora (la del año que corresponda).
  let sumaTasas = 0;
  const tasasPorAnio: Record<number, { tasa: number; meses: number }> = {};
  let cur = { anio: debio.anio, mes: debio.mes };
  for (let i = 0; i < meses; i++) {
    const t = await tasaRecargos(cur.anio);
    sumaTasas += t;
    tasasPorAnio[cur.anio] = { tasa: t, meses: (tasasPorAnio[cur.anio]?.meses || 0) + 1 };
    cur = mesSiguiente(cur.anio, cur.mes);
  }
  sumaTasas = f4(sumaTasas);
  const recargos = r2(montoActualizado * sumaTasas / 100);
  const total = r2(montoActualizado + recargos);

  return {
    alCorriente: false, monto, fa, montoActualizado, actualizacion,
    meses, sumaTasas, recargos, total,
    tasas: Object.entries(tasasPorAnio).map(([anio, v]) => ({ anio: Number(anio), tasa: v.tasa, meses: v.meses })),
    inpc: {
      pago: { anio: antPago.anio, mes: antPago.mes, valor: inpcPago },
      debio: { anio: antDebio.anio, mes: antDebio.mes, valor: inpcDebio },
    },
  };
}

/* ── 2) Ajuste anual por inflación (Art. 44 LISR) ── */
export async function ajusteAnualInflacion(d: { anio: number; saldoPromedioCreditos: number; saldoPromedioDeudas: number }) {
  const anio = Number(d.anio);
  const inpcDic = await inpcDe(anio, 12);
  const inpcDicPrev = await inpcDe(anio - 1, 12);
  const factor = f4(inpcDic / inpcDicPrev - 1);
  const creditos = Number(d.saldoPromedioCreditos) || 0;
  const deudas = Number(d.saldoPromedioDeudas) || 0;
  const diff = r2(deudas - creditos);
  const ajuste = r2(Math.abs(diff) * factor);
  const tipo = diff > 0 ? 'ACUMULABLE' : diff < 0 ? 'DEDUCIBLE' : 'NINGUNO';
  return { anio, factor, ajuste, tipo, base: Math.abs(diff), creditos, deudas, inpcDic, inpcDicPrev };
}

/* ── 3) Actualización de pérdida fiscal (Art. 57 LISR) ── */
export async function perdidaFiscalActualizada(d: { perdida: number; anioPerdida: number; anioAplicacion: number }) {
  const perdida = Number(d.perdida);
  const aP = Number(d.anioPerdida), aA = Number(d.anioAplicacion);
  if (!(perdida > 0)) throw new Error('La pérdida debe ser mayor que cero.');
  if (!Number.isInteger(aP) || !Number.isInteger(aA)) throw new Error('Años inválidos.');
  if (aA < aP) throw new Error('El año de aplicación no puede ser anterior al de la pérdida.');

  // 1ª actualización (cierre del año de la pérdida): dic / julio de ese año.
  const jul = await inpcDe(aP, 7);
  const dic = await inpcDe(aP, 12);
  const fa1 = f4(dic / jul);
  // 2ª actualización (al aplicarla): junio del año de aplicación / dic de la última actualización.
  let fa2 = 1, jun: number | null = null;
  if (aA > aP) { jun = await inpcDe(aA, 6); fa2 = f4(jun / dic); }
  const factorTotal = f4(fa1 * fa2);
  const actualizada = r2(perdida * fa1 * fa2);
  return { perdida, anioPerdida: aP, anioAplicacion: aA, fa1, fa2, factorTotal, actualizada, inpc: { jul, dic, jun } };
}

export default {
  serieInpc, resumen, actualizarInpc,
  actualizacionRecargos, ajusteAnualInflacion, perdidaFiscalActualizada,
};
