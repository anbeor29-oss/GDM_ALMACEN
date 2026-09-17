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

export default { serieInpc, resumen, actualizarInpc };
