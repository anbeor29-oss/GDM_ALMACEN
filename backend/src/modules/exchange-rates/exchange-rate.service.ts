/**
 * ExchangeRateService — el único componente autorizado a consultar fuentes
 * externas de tipo de cambio. Todo lo demás del ERP lee de la base.
 *
 * Base: TIPOS_CAMBIO_BANXICO.MD (HCGM Advisors v1.0).
 *
 * Qué tipo de cambio entrega
 * --------------------------
 * El del DOF, que es el que el Art. 20 del CFF pide para efectos fiscales:
 * el FIX que Banxico determinó el día hábil ANTERIOR. Banxico publica una
 * serie de "fecha de determinación"; nosotros la desplazamos al siguiente día
 * hábil, que es el día en que ese valor rige.
 *
 *     Banxico determina el viernes  →  ese valor rige el lunes
 *
 * Guardamos las dos fechas para que una auditoría pueda rehacer el cálculo
 * sin adivinar cuál se usó.
 *
 * Por qué nunca bloquea la facturación
 * ------------------------------------
 * Si Banxico no responde, el servicio devuelve el último tipo de cambio
 * vigente y deja la advertencia en la bitácora. Una factura no se puede
 * detener porque un servicio externo esté caído; lo que sí importa es que
 * quede constancia de que el dato no es del día.
 */

import { pool } from '../../config/database';

export type Moneda = 'MXN' | 'USD' | 'EUR' | 'GBP';
export const MONEDAS: Moneda[] = ['MXN', 'USD', 'EUR', 'GBP'];
export const MONEDAS_EXTRANJERAS: Moneda[] = ['USD', 'EUR', 'GBP'];

const BANXICO_BASE = 'https://www.banxico.org.mx/SieAPIRest/service/v1/series';

export interface TipoCambio {
  moneda: Moneda;
  valor: number;
  fecha: string;                 // día al que aplica (YYYY-MM-DD)
  fechaDeterminacion?: string;   // día hábil en que Banxico lo calculó
  fuente: string;
  vigente: boolean;              // false = se está usando uno anterior
}

/* ─── Utilidades de fecha ────────────────────────────────────────── */

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * "Hoy" en México, no en UTC.
 *
 * El CFDI es un documento fiscal mexicano y su fecha es la local. Con UTC,
 * una factura emitida a las 7 de la noche del lunes caía ya en martes y
 * buscaba un tipo de cambio que todavía no existe. México va de UTC-6 a
 * UTC-7, así que el desfase aparece todas las tardes a partir de las 18:00.
 */
function hoyMexico(): string {
  // en-CA da directamente aaaa-mm-dd.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Sábado o domingo. No contempla días festivos: para eso está el dato real. */
const esFinDeSemana = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

/** Siguiente día hábil — el día en que rige un FIX determinado en `d`. */
function siguienteHabil(d: Date): Date {
  const x = new Date(d);
  do { x.setUTCDate(x.getUTCDate() + 1); } while (esFinDeSemana(x));
  return x;
}

function diasAtras(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return iso(d);
}

/* ─── Bitácora ───────────────────────────────────────────────────── */

async function log(
  moneda: string | null,
  resultado: 'OK' | 'SIN_DATO' | 'ERROR' | 'OMITIDO',
  detalle: string,
  valor?: number,
  origen: 'CRON' | 'MANUAL' | 'API' = 'CRON',
) {
  await pool.query(
    `INSERT INTO exchange_rate_log (moneda, resultado, detalle, valor, origen)
     VALUES ($1,$2,$3,$4,$5)`,
    [moneda, resultado, detalle.slice(0, 2000), valor ?? null, origen],
  ).catch(() => { /* la bitácora nunca debe tumbar la operación */ });
}

/* ─── Cliente Banxico SIE ────────────────────────────────────────── */

interface SerieDato { fecha: string; dato: string }

/**
 * Consulta un rango de la serie y devuelve los datos ordenados del más
 * reciente al más viejo. Se pide un rango y no "oportuno" porque si el último
 * día fue inhábil no hay dato y necesitamos el anterior.
 */
async function consultarBanxico(serie: string, desde: string, hasta: string): Promise<SerieDato[]> {
  const token = process.env.BANXICO_TOKEN;
  if (!token) throw new Error('BANXICO_TOKEN no configurado');

  const url = `${BANXICO_BASE}/${encodeURIComponent(serie)}/datos/${desde}/${hasta}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetch(url, {
      headers: { 'Bmx-Token': token, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`Banxico respondió HTTP ${r.status}`);
    const j: any = await r.json();
    const datos: SerieDato[] = j?.bmx?.series?.[0]?.datos ?? [];
    return datos
      // Banxico marca los días sin cotización con 'N/E'.
      .filter(d => d.dato && d.dato !== 'N/E')
      .map(d => ({ fecha: normalizaFecha(d.fecha), dato: d.dato }))
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  } finally {
    clearTimeout(t);
  }
}

/** Banxico entrega dd/mm/aaaa; la base quiere aaaa-mm-dd. */
function normalizaFecha(f: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(f);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : f;
}

/* ─── Guardado ───────────────────────────────────────────────────── */

async function guardar(
  moneda: Moneda,
  fecha: string,
  valor: number,
  fuente: string,
  fechaDeterminacion?: string,
  usuario?: string,
) {
  await pool.query(
    `INSERT INTO exchange_rates
       (fecha, moneda, valor, fuente, fecha_determinacion, usuario_actualizacion)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (fecha, moneda) DO UPDATE
       SET valor = EXCLUDED.valor,
           fuente = EXCLUDED.fuente,
           fecha_determinacion = EXCLUDED.fecha_determinacion,
           hora_actualizacion = NOW(),
           usuario_actualizacion = EXCLUDED.usuario_actualizacion,
           activo = TRUE`,
    [fecha, moneda, valor, fuente, fechaDeterminacion ?? null, usuario ?? null],
  );
}

/* ─── API pública ────────────────────────────────────────────────── */

/**
 * Tipo de cambio de una moneda para una fecha (hoy si se omite).
 *
 * MXN vale 1 y no se consulta a nadie — así lo pide el SAT.
 *
 * Si no hay dato exacto para esa fecha devuelve el más reciente anterior y lo
 * marca `vigente: false`, para que quien lo use sepa que está trabajando con
 * un valor arrastrado (fin de semana, festivo o Banxico caído).
 */
export async function getExchangeRate(moneda: string, fecha?: string): Promise<TipoCambio> {
  const m = String(moneda || 'MXN').toUpperCase() as Moneda;
  const dia = fecha || hoyMexico();

  if (m === 'MXN') {
    return { moneda: 'MXN', valor: 1, fecha: dia, fuente: 'FIJO', vigente: true };
  }
  if (!MONEDAS_EXTRANJERAS.includes(m)) {
    throw new Error(`Moneda no soportada: ${m}. Disponibles: ${MONEDAS.join(', ')}`);
  }

  const r = await pool.query(
    `SELECT valor, fecha::text, fecha_determinacion::text, fuente
       FROM exchange_rates
      WHERE moneda = $1 AND activo AND fecha <= $2
      ORDER BY fecha DESC LIMIT 1`,
    [m, dia],
  );
  if (!r.rowCount) {
    throw new Error(
      `No hay tipo de cambio registrado para ${m}. ` +
      `Actualiza desde Banxico o captúralo a mano antes de facturar en esta moneda.`,
    );
  }

  const row = r.rows[0];
  return {
    moneda: m,
    valor: Number(row.valor),
    fecha: row.fecha,
    fechaDeterminacion: row.fecha_determinacion ?? undefined,
    fuente: row.fuente,
    vigente: row.fecha === dia,
  };
}

/**
 * Trae de Banxico el último valor de una moneda y lo guarda con la fecha en
 * que RIGE (el día hábil siguiente al de determinación), que es la que el DOF
 * publica y la que el SAT espera en el comprobante.
 */
export async function updateExchangeRate(
  moneda: Moneda,
  origen: 'CRON' | 'MANUAL' | 'API' = 'CRON',
): Promise<TipoCambio> {
  if (moneda === 'MXN') {
    await log('MXN', 'OMITIDO', 'El peso vale 1 por definición; no se consulta', 1, origen);
    return { moneda: 'MXN', valor: 1, fecha: hoyMexico(), fuente: 'FIJO', vigente: true };
  }

  const src = await pool.query(
    'SELECT proveedor, serie, activo FROM exchange_rate_sources WHERE moneda = $1',
    [moneda],
  );
  if (!src.rowCount || !src.rows[0].activo) {
    await log(moneda, 'OMITIDO', 'Sin fuente activa configurada', undefined, origen);
    throw new Error(`${moneda} no tiene fuente activa en exchange_rate_sources`);
  }
  const { proveedor, serie } = src.rows[0];
  if (proveedor !== 'BANXICO' || !serie) {
    await log(moneda, 'OMITIDO', `Proveedor ${proveedor} sin consulta automática`, undefined, origen);
    throw new Error(`${moneda} está configurada como ${proveedor}: se captura a mano`);
  }

  try {
    // Ventana de 10 días: cubre puentes largos sin traer histórico de más.
    const datos = await consultarBanxico(serie, diasAtras(10), hoyMexico());
    if (!datos.length) {
      await log(moneda, 'SIN_DATO', `Serie ${serie} sin cotizaciones en los últimos 10 días`, undefined, origen);
      throw new Error(`Banxico no devolvió datos para ${moneda} (serie ${serie})`);
    }

    const ultimo = datos[0];
    const valor = Number(ultimo.dato);
    if (!Number.isFinite(valor) || valor <= 0) {
      await log(moneda, 'ERROR', `Valor inválido "${ultimo.dato}" en serie ${serie}`, undefined, origen);
      throw new Error(`Banxico devolvió un valor inválido para ${moneda}: ${ultimo.dato}`);
    }

    // El FIX determinado el día D rige el siguiente día hábil.
    const rige = iso(siguienteHabil(new Date(`${ultimo.fecha}T00:00:00Z`)));
    await guardar(moneda, rige, valor, 'BANXICO_DOF', ultimo.fecha, origen === 'CRON' ? 'cron' : undefined);
    await log(moneda, 'OK', `Determinado ${ultimo.fecha}, rige ${rige}`, valor, origen);

    return {
      moneda, valor, fecha: rige,
      fechaDeterminacion: ultimo.fecha,
      fuente: 'BANXICO_DOF',
      vigente: rige === hoyMexico(),
    };
  } catch (e: any) {
    const msg = e?.message || String(e);
    await log(moneda, 'ERROR', msg, undefined, origen);
    throw e;
  }
}

export interface ResultadoActualizacion {
  actualizadas: TipoCambio[];
  fallidas: { moneda: Moneda; error: string }[];
}

/**
 * Actualiza USD, EUR y GBP. No se detiene en la primera falla: que Banxico no
 * publique la libra no debe dejar sin actualizar el dólar.
 */
export async function updateExchangeRates(
  origen: 'CRON' | 'MANUAL' | 'API' = 'CRON',
): Promise<ResultadoActualizacion> {
  const actualizadas: TipoCambio[] = [];
  const fallidas: { moneda: Moneda; error: string }[] = [];

  for (const m of MONEDAS_EXTRANJERAS) {
    try {
      actualizadas.push(await updateExchangeRate(m, origen));
    } catch (e: any) {
      fallidas.push({ moneda: m, error: e?.message || String(e) });
    }
  }
  return { actualizadas, fallidas };
}

/**
 * Captura manual. El MD la pide expresamente y es la red de seguridad: sin
 * token, sin internet o con Banxico caído, la facturación sigue.
 */
export async function setManualRate(
  moneda: Moneda,
  fecha: string,
  valor: number,
  usuario: string,
): Promise<TipoCambio> {
  if (moneda === 'MXN') throw new Error('El peso vale 1; no admite captura manual');
  if (!MONEDAS_EXTRANJERAS.includes(moneda)) throw new Error(`Moneda no soportada: ${moneda}`);
  if (!Number.isFinite(valor) || valor <= 0) throw new Error('El tipo de cambio debe ser mayor a cero');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('La fecha debe venir como AAAA-MM-DD');

  await guardar(moneda, fecha, valor, 'MANUAL', undefined, usuario);
  await log(moneda, 'OK', `Captura manual de ${usuario} para ${fecha}`, valor, 'MANUAL');
  return { moneda, valor, fecha, fuente: 'MANUAL', vigente: fecha === hoyMexico() };
}

/** Histórico de una moneda, del más reciente al más viejo. */
export async function getHistory(moneda: string, limite = 60) {
  const r = await pool.query(
    `SELECT fecha::text, valor, fuente, fecha_determinacion::text AS "fechaDeterminacion",
            hora_actualizacion AS "horaActualizacion", usuario_actualizacion AS "usuario"
       FROM exchange_rates
      WHERE moneda = $1 AND activo
      ORDER BY fecha DESC LIMIT $2`,
    [String(moneda).toUpperCase(), Math.min(limite, 400)],
  );
  return r.rows;
}

/** Últimos movimientos de la bitácora, para ver por qué no se actualizó algo. */
export async function getLog(limite = 50) {
  const r = await pool.query(
    `SELECT ejecutado_en AS "ejecutadoEn", moneda, resultado, detalle, valor, origen
       FROM exchange_rate_log ORDER BY ejecutado_en DESC LIMIT $1`,
    [Math.min(limite, 200)],
  );
  return r.rows;
}

/** Cuadro de las cuatro monedas para pintar el panel de un vistazo. */
export async function getResumen(fecha?: string) {
  const dia = fecha || hoyMexico();
  const out: (TipoCambio & { error?: string })[] = [];
  for (const m of MONEDAS) {
    try {
      out.push(await getExchangeRate(m, dia));
    } catch (e: any) {
      out.push({
        moneda: m, valor: 0, fecha: dia, fuente: 'NINGUNA',
        vigente: false, error: e?.message || String(e),
      });
    }
  }
  return out;
}
