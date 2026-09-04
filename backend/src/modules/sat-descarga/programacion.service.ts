/**
 * Programación de la descarga: el día a día y los ejercicios completos.
 *
 * ── LO QUE FALTABA ──
 * El motor sabía AVANZAR trabajos, pero nadie los CREABA solo. El cron corría
 * cada quince minutos sobre una lista que sólo crecía cuando alguien entraba a
 * la pantalla y pulsaba el botón. Los días que nadie entra no había CFDI, y
 * ese hueco se descubre meses después — cuando el SAT ya no lo devuelve porque
 * la solicitud caducó y el mes ya se declaró.
 *
 * ── POR QUÉ SE PIDEN TRES DÍAS ATRÁS Y NO SÓLO AYER ──
 * El SAT no publica al instante. Un CFDI timbrado el día 30 a las 23:50 no
 * está disponible el día 1 a las 6 de la mañana. Pedir sólo el día anterior
 * deja huecos que nadie ve: la descarga "funcionó", simplemente no traía todo.
 *
 * Pedir una ventana que se traslapa cuesta poco —el índice de CFDI descarta lo
 * repetido por UUID— y cierra el hueco.
 *
 * ── EL PRESUPUESTO ──
 * Traer un ejercicio completo de golpe topa los límites del SAT y deja sin
 * cupo a la descarga del día. Se reparte por día: el histórico tarda una
 * semana en bajar, y está bien. Lo que no puede pasar es que bajar el
 * histórico apague la operación diaria.
 */

import { query, transaction, transactionQuery } from '../../config/database';
import logger from '../../middleware/logger';
import { crearTrabajo } from './descarga.service';

export interface ConfigDescarga {
  companyId: string;
  diariaActiva: boolean;
  diariaRecibidos: boolean;
  diariaEmitidos: boolean;
  diasAtras: number;
  xmlPorDia: number;
  solicitudesPorDia: number;
}

const PREDETERMINADO = {
  diariaActiva: true, diariaRecibidos: true, diariaEmitidos: true,
  diasAtras: 3, xmlPorDia: 2000, solicitudesPorDia: 40,
};

/* ═══════════════════════════════════════════════════════════════════════════
   1. CONFIGURACIÓN
   ═══════════════════════════════════════════════════════════════════════════ */

export async function configDe(companyId: string): Promise<ConfigDescarga> {
  const r = await query<any>(
    `SELECT * FROM sat_config_descarga WHERE company_id = $1`, [companyId]);
  if (!r.rows.length) return { companyId, ...PREDETERMINADO };
  const c = r.rows[0];
  return {
    companyId,
    diariaActiva: c.diaria_activa,
    diariaRecibidos: c.diaria_recibidos,
    diariaEmitidos: c.diaria_emitidos,
    diasAtras: c.dias_atras,
    xmlPorDia: c.xml_por_dia,
    solicitudesPorDia: c.solicitudes_por_dia,
  };
}

export async function guardarConfig(
  companyId: string, d: Partial<Omit<ConfigDescarga, 'companyId'>>,
): Promise<ConfigDescarga> {
  const actual = await configDe(companyId);
  const n = { ...actual, ...d };
  await query(
    `INSERT INTO sat_config_descarga
       (company_id, diaria_activa, diaria_recibidos, diaria_emitidos,
        dias_atras, xml_por_dia, solicitudes_por_dia)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (company_id) DO UPDATE SET
       diaria_activa = EXCLUDED.diaria_activa,
       diaria_recibidos = EXCLUDED.diaria_recibidos,
       diaria_emitidos = EXCLUDED.diaria_emitidos,
       dias_atras = EXCLUDED.dias_atras,
       xml_por_dia = EXCLUDED.xml_por_dia,
       solicitudes_por_dia = EXCLUDED.solicitudes_por_dia,
       updated_at = NOW()`,
    [companyId, n.diariaActiva, n.diariaRecibidos, n.diariaEmitidos,
     n.diasAtras, n.xmlPorDia, n.solicitudesPorDia]);
  return n;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. EL PRESUPUESTO DEL DÍA
   ═══════════════════════════════════════════════════════════════════════════ */

export interface Presupuesto {
  fecha: string;
  solicitudes: number;
  solicitudesTope: number;
  xml: number;
  xmlTope: number;
  paquetes: number;
  quedanSolicitudes: number;
  quedanXml: number;
  agotado: boolean;
}

export async function presupuestoDeHoy(companyId: string): Promise<Presupuesto> {
  const cfg = await configDe(companyId);
  const r = await query<any>(
    `SELECT * FROM sat_consumo_diario WHERE company_id=$1 AND fecha = CURRENT_DATE`,
    [companyId]);
  const c = r.rows[0] ?? { solicitudes: 0, xml: 0, paquetes: 0 };

  const quedanSolicitudes = Math.max(0, cfg.solicitudesPorDia - c.solicitudes);
  const quedanXml = Math.max(0, cfg.xmlPorDia - c.xml);

  return {
    fecha: new Date().toISOString().slice(0, 10),
    solicitudes: c.solicitudes, solicitudesTope: cfg.solicitudesPorDia,
    xml: c.xml, xmlTope: cfg.xmlPorDia,
    paquetes: c.paquetes,
    quedanSolicitudes, quedanXml,
    /* Agotado si no queda cupo de solicitudes O de XML: cualquiera de los dos
     * frena. Si sólo se mirara uno, el otro se pasaría de largo. */
    agotado: quedanSolicitudes <= 0 || quedanXml <= 0,
  };
}

/** Registra lo consumido. Se llama desde el motor, no desde la pantalla. */
export async function consumir(
  companyId: string, d: { solicitudes?: number; xml?: number; paquetes?: number },
): Promise<void> {
  await query(
    `INSERT INTO sat_consumo_diario (company_id, fecha, solicitudes, xml, paquetes)
     VALUES ($1, CURRENT_DATE, $2, $3, $4)
     ON CONFLICT (company_id, fecha) DO UPDATE SET
       solicitudes = sat_consumo_diario.solicitudes + EXCLUDED.solicitudes,
       xml = sat_consumo_diario.xml + EXCLUDED.xml,
       paquetes = sat_consumo_diario.paquetes + EXCLUDED.paquetes,
       updated_at = NOW()`,
    [companyId, d.solicitudes ?? 0, d.xml ?? 0, d.paquetes ?? 0]);
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. EL TRABAJO DE CADA DÍA
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ResultadoDiario {
  creados: Array<{ direccion: string; desde: string; hasta: string; trabajoId: string }>;
  omitidos: string[];
}

/**
 * Crea el trabajo del día, si no existe ya.
 *
 * Idempotente por partida doble: el índice único sobre trabajos VIVOS impide
 * el duplicado en la base, y aquí se comprueba antes para no gastar una
 * llamada al SAT en algo que se va a rechazar.
 */
export async function crearTrabajoDiario(
  companyId: string, userId?: string,
): Promise<ResultadoDiario> {
  const cfg = await configDe(companyId);
  const out: ResultadoDiario = { creados: [], omitidos: [] };

  if (!cfg.diariaActiva) {
    out.omitidos.push('La descarga diaria está apagada para esta empresa.');
    return out;
  }

  /* ── ¿Ya se creó hoy? ──
   *
   * Ésta es la comprobación que hace que la función se pueda llamar cuantas
   * veces haga falta. Antes se miraba si había un trabajo VIVO sobre el rango,
   * y eso tiene un agujero: en cuanto el trabajo del día TERMINA, la
   * comprobación pasa y se volvería a crear otro. Llamándola cada quince
   * minutos, eso son decenas de trabajos al día.
   *
   * Mirando si ya se creó uno HOY, la función es idempotente por día — y
   * entonces sí se puede llamar desde el reloj de cada cuarto de hora sin
   * miedo, que es lo que la vuelve a prueba de reinicios. */
  const yaHoy = await query<any>(
    `SELECT 1 FROM sat_trabajos
      WHERE company_id = $1 AND origen = 'DIARIO'
        AND created_at::date = CURRENT_DATE
      LIMIT 1`, [companyId]);
  if (yaHoy.rows.length) {
    out.omitidos.push('El trabajo de hoy ya se creó.');
    return out;
  }

  const hoy = new Date();
  const hasta = new Date(hoy);
  hasta.setDate(hasta.getDate() - 1);            // hasta ayer: hoy aún no cierra
  const desde = new Date(hoy);
  desde.setDate(desde.getDate() - cfg.diasAtras);

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const direcciones: Array<'recibidos' | 'emitidos'> = [];
  if (cfg.diariaRecibidos) direcciones.push('recibidos');
  if (cfg.diariaEmitidos) direcciones.push('emitidos');

  for (const direccion of direcciones) {
    for (const tipo of TIPOS_DIARIO[direccion]) {
      if (await trabajoVivoEn(companyId, iso(desde), iso(hasta), direccion, tipo)) {
        out.omitidos.push(
          `${direccion}·${tipo}: ya hay un trabajo vivo sobre ${iso(desde)} → ${iso(hasta)}.`);
        continue;
      }
      try {
        const t = await crearTrabajo(
          companyId,
          { desde: iso(desde), hasta: iso(hasta), direccion, tipo },
          userId,
          { origen: 'DIARIO' });
        out.creados.push({ direccion, desde: iso(desde), hasta: iso(hasta), trabajoId: t.id });
      } catch (e: any) {
        out.omitidos.push(`${direccion}·${tipo}: ${e.message}`);
      }
    }
  }

  if (out.creados.length) {
    logger.info(
      `[sat-descarga] trabajo diario de ${companyId}: ` +
      out.creados.map((c) => `${c.direccion} ${c.desde}→${c.hasta}`).join(' · '));
  }
  return out;
}

async function trabajoVivoEn(
  companyId: string, desde: string, hasta: string, direccion: string, tipo?: string,
): Promise<boolean> {
  /* Se busca traslape, no coincidencia exacta: pedir 18→20 cuando ya hay un
   * trabajo vivo de 17→19 es pedir dos veces los mismos días. El `tipo` importa
   * porque de emitidos se piden DOS (CFDI + Metadata) sobre el mismo rango: sin
   * distinguirlo, el segundo se creería duplicado del primero. */
  const params: any[] = [companyId, direccion, desde, hasta];
  let filtroTipo = '';
  if (tipo) { params.push(tipo); filtroTipo = ` AND tipo = $${params.length}`; }
  const r = await query<any>(
    `SELECT 1 FROM sat_trabajos
      WHERE company_id=$1 AND direccion=$2 AND estado IN ('CREADO','EN_PROCESO')
        AND fecha_desde <= $4::date AND fecha_hasta >= $3::date${filtroTipo}
      LIMIT 1`,
    params);
  return r.rows.length > 0;
}

/* De cada dirección, qué tipos se piden automáticamente. Ambas direcciones son
 * simétricas: CFDI (el XML, acotado a VIGENTES —los únicos que el SAT entrega
 * como XML—) + Metadata (Todos, para el estatus incl. cancelados). El acotado a
 * vigentes lo pone soap.ts con EstadoComprobante="Vigente"; el 301 de recibidos
 * era ese valor mal codificado ("1" en vez de la palabra), ya corregido. */
const TIPOS_DIARIO: Record<string, Array<'CFDI' | 'Metadata'>> = {
  recibidos: ['CFDI', 'Metadata'],
  emitidos: ['CFDI', 'Metadata'],
};
const TIPOS_EJERCICIO: Record<string, Array<'CFDI' | 'Metadata'>> = {
  recibidos: ['CFDI', 'Metadata'],
  emitidos: ['CFDI', 'Metadata'],
};

/* ═══════════════════════════════════════════════════════════════════════════
   4. UN EJERCICIO COMPLETO
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ResultadoEjercicio {
  ejercicio: number;
  creados: number;
  omitidos: string[];
  trabajos: Array<{ direccion: string; mes: number; desde: string; hasta: string }>;
  aviso: string;
}

/**
 * Pide un ejercicio completo, mes por mes.
 *
 * ── POR QUÉ MES POR MES Y NO EL AÑO DE UN TIRÓN ──
 * Un rango de doce meses casi siempre topa el límite del SAT, que responde
 * 5003 y obliga a partir. El motor sabe partir solo, pero cada partición
 * fallida gasta una solicitud del cupo diario: se llega al mismo sitio
 * quemando el triple de cupo.
 *
 * Mes por mes además deja el trabajo legible: si falta septiembre se ve cuál
 * es, en vez de tener un solo trabajo de "2025" a medias.
 *
 * ── NO SE DESCARGA DE INMEDIATO ──
 * Los trabajos quedan creados y el motor los va atendiendo dentro del
 * presupuesto diario. Un ejercicio con volumen tarda varios días, y eso es lo
 * correcto: bajarlo de golpe deja sin cupo a la descarga del día.
 */
/**
 * Los rangos mensuales de un ejercicio.
 *
 * Aparte de crearTrabajoEjercicio para poder comprobarlo sin pedirle nada al
 * SAT: el calculo de fechas es donde se cuela el error de un dia —febrero de
 * un ano bisiesto, el ultimo dia del mes— y ese error no se ve, se traduce en
 * comprobantes que faltan.
 */
export function mesesDelEjercicio(
  ejercicio: number, hastaMes?: number,
): Array<{ mes: number; desde: string; hasta: string }> {
  const anioActual = new Date().getFullYear();
  const ultimo = hastaMes
    ?? (ejercicio === anioActual ? Math.max(1, new Date().getMonth()) : 12);
  const out = [];
  for (let mes = 1; mes <= ultimo; mes++) {
    out.push({
      mes,
      desde: `${ejercicio}-${String(mes).padStart(2, '0')}-01`,
      /* Dia 0 del mes SIGUIENTE es el ultimo del actual: resuelve febrero
       * bisiesto y los meses de 30 sin tabla de dias. */
      hasta: new Date(Date.UTC(ejercicio, mes, 0)).toISOString().slice(0, 10),
    });
  }
  return out;
}

export async function crearTrabajoEjercicio(
  companyId: string,
  ejercicio: number,
  opciones: { recibidos?: boolean; emitidos?: boolean; hastaMes?: number } = {},
  userId?: string,
): Promise<ResultadoEjercicio> {
  const anioActual = new Date().getFullYear();
  if (ejercicio < 2011 || ejercicio > anioActual) {
    throw new Error(
      `El ejercicio ${ejercicio} está fuera de rango. El SAT conserva los CFDI ` +
      `desde 2011, y no se pueden pedir años futuros.`);
  }

  const recibidos = opciones.recibidos !== false;
  const emitidos = opciones.emitidos !== false;
  /* Del año en curso sólo tiene sentido pedir hasta el mes pasado: el actual
   * todavía se está formando y se pedirá con la descarga diaria. */
  const ultimoMes = opciones.hastaMes
    ?? (ejercicio === anioActual ? Math.max(1, new Date().getMonth()) : 12);

  const out: ResultadoEjercicio = {
    ejercicio, creados: 0, omitidos: [], trabajos: [],
    aviso: '',
  };

  for (const { mes, desde, hasta } of mesesDelEjercicio(ejercicio, ultimoMes)) {

    for (const direccion of ([
      ...(recibidos ? ['recibidos'] : []),
      ...(emitidos ? ['emitidos'] : []),
    ] as Array<'recibidos' | 'emitidos'>)) {
      for (const tipo of TIPOS_EJERCICIO[direccion]) {
        if (await trabajoVivoEn(companyId, desde, hasta, direccion, tipo)) {
          out.omitidos.push(`${direccion}·${tipo} ${desde}: ya hay un trabajo vivo sobre ese mes.`);
          continue;
        }
        try {
          await crearTrabajo(companyId, { desde, hasta, direccion, tipo },
            userId, { origen: 'EJERCICIO', ejercicio });
          out.creados++;
          out.trabajos.push({ direccion, mes, desde, hasta });
        } catch (e: any) {
          out.omitidos.push(`${direccion}·${tipo} ${desde}: ${e.message}`);
        }
      }
    }
  }

  const cfg = await configDe(companyId);
  out.aviso =
    `Se crearon ${out.creados} trabajo(s) mensuales. El motor los irá bajando dentro ` +
    `del presupuesto de ${cfg.xmlPorDia.toLocaleString('es-MX')} XML y ` +
    `${cfg.solicitudesPorDia} solicitudes por día, sin apagar la descarga diaria. ` +
    `Un ejercicio con volumen tarda varios días en completarse.`;

  logger.info(
    `[sat-descarga] ejercicio ${ejercicio} de ${companyId}: ${out.creados} trabajos creados`);
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. CÓMO VA LA DESCARGA
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * El desglose que la pantalla necesitaba y no tenía.
 *
 * 'particiones_listas' juntaba TERMINADA, SIN_DATOS, DIVIDIDA, RECHAZADA y
 * FALLIDA en un solo número: la pantalla decía "4/5" y no había forma de saber
 * si esas cuatro salieron bien sin comprobantes o si el SAT las rechazó. Con
 * una e.firma de prueba eso es exactamente lo que hay que distinguir.
 */
export async function comoVa(companyId: string) {
  const r = await query<any>(
    `SELECT
        COUNT(*) FILTER (WHERE pa.estado = 'PENDIENTE')::int   AS pendientes,
        COUNT(*) FILTER (WHERE pa.estado = 'SOLICITADA')::int  AS solicitadas,
        COUNT(*) FILTER (WHERE pa.estado = 'EN_PROCESO')::int  AS en_proceso,
        COUNT(*) FILTER (WHERE pa.estado = 'TERMINADA')::int   AS terminadas,
        COUNT(*) FILTER (WHERE pa.estado = 'SIN_DATOS')::int   AS sin_datos,
        COUNT(*) FILTER (WHERE pa.estado = 'DIVIDIDA')::int    AS divididas,
        COUNT(*) FILTER (WHERE pa.estado = 'RECHAZADA')::int   AS rechazadas,
        COUNT(*) FILTER (WHERE pa.estado = 'FALLIDA')::int     AS fallidas
       FROM sat_particiones pa
       JOIN sat_trabajos t ON t.id = pa.trabajo_id
      WHERE t.company_id = $1`, [companyId]);

  const p = r.rows[0];

  /* Los motivos concretos de lo que salió mal: un conteo sin el motivo obliga
   * a ir a buscarlo a la base. */
  const problemas = await query<any>(
    `SELECT pa.estado, pa.codigo_sat, pa.mensaje_sat,
            pa.desde::date, pa.hasta::date, t.direccion, COUNT(*)::int AS veces
       FROM sat_particiones pa
       JOIN sat_trabajos t ON t.id = pa.trabajo_id
      WHERE t.company_id = $1 AND pa.estado IN ('RECHAZADA','FALLIDA')
      GROUP BY 1,2,3,4,5,6
      ORDER BY veces DESC LIMIT 10`, [companyId]);

  const ultimoDiario = await query<any>(
    `SELECT created_at, fecha_desde::date, fecha_hasta::date, direccion, estado
       FROM sat_trabajos
      WHERE company_id=$1 AND origen='DIARIO'
      ORDER BY created_at DESC LIMIT 1`, [companyId]);

  const xml = await query<any>(
    `SELECT COUNT(*)::int n FROM cfdi_recibidos WHERE company_id = $1`, [companyId]);

  return {
    particiones: p,
    /* Lo que de verdad significa "listo": trajo comprobantes o confirmó que no
     * había. Lo demás no está listo, está atorado. */
    resueltas: p.terminadas + p.sin_datos,
    atoradas: p.rechazadas + p.fallidas,
    enVuelo: p.pendientes + p.solicitadas + p.en_proceso,
    problemas: problemas.rows,
    xmlIndexados: xml.rows[0]?.n ?? 0,
    ultimoDiario: ultimoDiario.rows[0] ?? null,
    presupuesto: await presupuestoDeHoy(companyId),
    config: await configDe(companyId),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. COBERTURA POR DÍA (para el calendario)
   ═══════════════════════════════════════════════════════════════════════════ */

export type EstadoDia = 'nexo' | 'proceso' | 'sincomp' | 'falta';
export interface DiaCobertura { dia: string; estado: EstadoDia; cfdi: number; }

/**
 * Estado de cada día del año, para pintar el calendario:
 *   nexo    — ya hay ≥1 CFDI de ese día en NEXO (verde).
 *   proceso — no hay CFDI, pero una solicitud CFDI que cubre el día está en vuelo
 *             (PENDIENTE/SOLICITADA/EN_PROCESO/TERMINADA/DIVIDIDA) (ámbar).
 *   sincomp — no hay CFDI y el SAT confirmó que no había (partición SIN_DATOS) (azul).
 *   falta   — nadie lo ha pedido (o sólo quedó rechazado/fallido) (gris).
 *
 * "Pedido y contestado" (no sólo "tiene XML"): un día legítimamente sin facturas,
 * ya consultado, sale en azul y no se persigue para siempre.
 */
export async function coberturaDelAnio(
  companyId: string, anio: number, direccion: 'recibidos' | 'emitidos',
): Promise<{
  anio: number; direccion: string; anioMin: number; hoy: string;
  dias: DiaCobertura[]; resumen: Record<EstadoDia, number>;
}> {
  const desde = `${anio}-01-01`;
  const finExcl = `${anio + 1}-01-01`;

  // 1. CFDI por día (lo que YA está en NEXO).
  const cfdi = await query<any>(
    `SELECT fecha_emision::date AS dia, COUNT(*)::int AS n
       FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion=$2
        AND fecha_emision >= $3 AND fecha_emision < $4
      GROUP BY 1`, [companyId, direccion, desde, finExcl]);
  const porDia = new Map<string, number>();
  for (const r of cfdi.rows) porDia.set(String(r.dia).slice(0, 10), r.n);

  // 2. Particiones CFDI que tocan el año, con su estado → marca días pedidos.
  const parts = await query<any>(
    `SELECT pa.desde::date AS d, pa.hasta::date AS h, pa.estado
       FROM sat_particiones pa
       JOIN sat_trabajos t ON t.id = pa.trabajo_id
      WHERE t.company_id=$1 AND t.direccion=$2 AND t.tipo='CFDI'
        AND pa.hasta >= $3 AND pa.desde < $4`, [companyId, direccion, desde, finExcl]);
  const EN_VUELO = new Set(['PENDIENTE', 'SOLICITADA', 'EN_PROCESO', 'TERMINADA', 'DIVIDIDA']);
  const enVuelo = new Set<string>();
  const vacio = new Set<string>();
  const clave = (d: Date) => d.toISOString().slice(0, 10);
  for (const p of parts.rows) {
    const d0 = new Date(`${String(p.d).slice(0, 10)}T00:00:00Z`);
    const d1 = new Date(`${String(p.h).slice(0, 10)}T00:00:00Z`);
    for (const d = new Date(d0); d <= d1; d.setUTCDate(d.getUTCDate() + 1)) {
      const k = clave(d);
      if (!k.startsWith(String(anio))) continue;
      if (p.estado === 'SIN_DATOS') vacio.add(k);
      else if (EN_VUELO.has(p.estado)) enVuelo.add(k);
    }
  }

  // 3. Un renglón por día, hasta hoy (del año en curso) o 31-dic (años pasados).
  const hoy = new Date();
  const hoyIso = hoy.toISOString().slice(0, 10);
  const ultimo = anio >= hoy.getUTCFullYear()
    ? new Date(`${hoyIso}T00:00:00Z`)
    : new Date(Date.UTC(anio, 11, 31));
  const dias: DiaCobertura[] = [];
  const resumen: Record<EstadoDia, number> = { nexo: 0, proceso: 0, sincomp: 0, falta: 0 };
  for (const d = new Date(Date.UTC(anio, 0, 1)); d <= ultimo; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = clave(d);
    const n = porDia.get(k) || 0;
    const estado: EstadoDia = n > 0 ? 'nexo' : enVuelo.has(k) ? 'proceso' : vacio.has(k) ? 'sincomp' : 'falta';
    resumen[estado]++;
    dias.push({ dia: k, estado, cfdi: n });
  }

  // Año mínimo para el navegador del calendario (respaldo o primer CFDI).
  const minR = await query<any>(
    `SELECT LEAST(
        (SELECT MIN(anio) FROM accounting_fiscal_years WHERE company_id=$1),
        (SELECT MIN(EXTRACT(YEAR FROM fecha_emision))::int FROM cfdi_recibidos WHERE company_id=$1)
      ) AS m`, [companyId]);
  const anioMin = Number(minR.rows[0]?.m) || anio;

  return { anio, direccion, anioMin, hoy: hoyIso, dias, resumen };
}

/**
 * Llena los HUECOS del año: crea trabajos SÓLO para los meses que tienen al menos
 * un día en 'falta' (gris). Los meses ya cubiertos no se re-piden — así no se gasta
 * cuota del SAT en lo que ya está. El motor los baja dentro del presupuesto diario.
 */
export async function llenarHuecos(
  companyId: string, anio: number, direccion: 'recibidos' | 'emitidos', userId?: string,
): Promise<{ creados: number; meses: number[]; omitidos: string[] }> {
  const cob = await coberturaDelAnio(companyId, anio, direccion);
  const mesesFalta = new Set<number>();
  for (const d of cob.dias) if (d.estado === 'falta') mesesFalta.add(Number(d.dia.slice(5, 7)));

  const out = { creados: 0, meses: [] as number[], omitidos: [] as string[] };
  for (const { mes, desde, hasta } of mesesDelEjercicio(anio)) {
    if (!mesesFalta.has(mes)) continue;
    let algo = false;
    for (const tipo of ['CFDI', 'Metadata'] as Array<'CFDI' | 'Metadata'>) {
      if (await trabajoVivoEn(companyId, desde, hasta, direccion, tipo)) {
        out.omitidos.push(`${direccion}·${tipo} mes ${mes}: ya hay un trabajo vivo.`);
        continue;
      }
      try {
        await crearTrabajo(companyId, { desde, hasta, direccion, tipo }, userId, { origen: 'EJERCICIO', ejercicio: anio });
        out.creados++; algo = true;
      } catch (e: any) { out.omitidos.push(`${direccion}·${tipo} mes ${mes}: ${e.message}`); }
    }
    if (algo) out.meses.push(mes);
  }
  return out;
}

export default {
  configDe, guardarConfig, presupuestoDeHoy, consumir,
  crearTrabajoDiario, crearTrabajoEjercicio, comoVa, coberturaDelAnio, llenarHuecos,
};
