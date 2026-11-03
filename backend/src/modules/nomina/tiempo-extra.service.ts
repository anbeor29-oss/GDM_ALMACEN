/**
 * tiempo-extra.service — motor de TIEMPO EXTRAORDINARIO del Checador (etapas 2 y 3
 * del `.md` GDM_NEXO_Ampliacion_Checador_Tiempo_Extra_SBC_IMSS).
 *
 * QUÉ HACE
 *  1. DETECTA, por trabajador y día, los minutos trabajados después de la salida
 *     programada del turno + su tolerancia (sólo turnos con `calcula_tiempo_extra`).
 *     NUNCA altera la checada original: guarda hora programada, hora real y tolerancia.
 *  2. CALCULA, por semana, la clasificación DOBLE/TRIPLE (LFT Art. 67/68: las
 *     primeras `horas_dobles_semana` horas de la semana al doble, el excedente al
 *     triple) con el valor-hora del trabajador (salario diario / jornada), y la parte
 *     EXENTA/GRAVADA de ISR (LISR Art. 93-I: 50% exento con tope de 5 UMA por semana).
 *  3. Separa tres cantidades: DETECTADO, AUTORIZADO y PAGABLE, y lleva el estatus
 *     del flujo (DETECTADO → AUTORIZADO/RECHAZADO → ENVIADO → PAGADO/CANCELADO).
 *
 * TODO lo legal sale de `nomina_te_parametros` (versionado por año, lo valida el
 * usuario contra el DOF) y de `nomina_ejercicios` (UMA). Nada hardcodeado.
 */
import { query } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';
import * as periodosSvc from './periodos.service';
import * as ejercicios from './ejercicios.service';

const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

export interface TeParametros {
  anio: number;
  topeHorasSemana: number;
  horasDoblesSemana: number;
  topeHorasDia: number;
  horasJornadaDia: number;
  fuente: string | null;
  confirmado: boolean;
}

/** Parámetros legales del TE de un año (con fallback al más reciente ≤ año). */
export async function cargarParametros(anio: number): Promise<TeParametros | null> {
  const r = await query<any>(
    `SELECT anio, tope_horas_semana, horas_dobles_semana, tope_horas_dia, horas_jornada_dia, fuente, confirmado
       FROM nomina_te_parametros WHERE anio <= $1 ORDER BY anio DESC LIMIT 1`, [anio]);
  const x = r.rows[0];
  if (!x) return null;
  return {
    anio: x.anio,
    topeHorasSemana: Number(x.tope_horas_semana),
    horasDoblesSemana: Number(x.horas_dobles_semana),
    topeHorasDia: Number(x.tope_horas_dia),
    horasJornadaDia: Number(x.horas_jornada_dia) || 8,
    fuente: x.fuente, confirmado: !!x.confirmado,
  };
}

export async function listarParametros(): Promise<TeParametros[]> {
  const r = await query<any>(
    `SELECT anio, tope_horas_semana, horas_dobles_semana, tope_horas_dia, horas_jornada_dia, fuente, confirmado
       FROM nomina_te_parametros ORDER BY anio DESC`);
  return r.rows.map((x) => ({
    anio: x.anio, topeHorasSemana: Number(x.tope_horas_semana), horasDoblesSemana: Number(x.horas_dobles_semana),
    topeHorasDia: Number(x.tope_horas_dia), horasJornadaDia: Number(x.horas_jornada_dia) || 8,
    fuente: x.fuente, confirmado: !!x.confirmado,
  }));
}

export async function guardarParametros(d: any, _userId?: string) {
  const anio = Number(d?.anio);
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) throw new ValidationError('Año inválido.');
  await query(
    `INSERT INTO nomina_te_parametros (anio, tope_horas_semana, horas_dobles_semana, tope_horas_dia, horas_jornada_dia, fuente, confirmado)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (anio) DO UPDATE SET
       tope_horas_semana = EXCLUDED.tope_horas_semana, horas_dobles_semana = EXCLUDED.horas_dobles_semana,
       tope_horas_dia = EXCLUDED.tope_horas_dia, horas_jornada_dia = EXCLUDED.horas_jornada_dia,
       fuente = EXCLUDED.fuente, confirmado = EXCLUDED.confirmado, updated_at = NOW()`,
    [anio, Number(d.topeHorasSemana) || 0, Number(d.horasDoblesSemana) || 9,
     Number(d.topeHorasDia) || 3, Number(d.horasJornadaDia) || 8, d.fuente || null, !!d.confirmado]);
  return cargarParametros(anio);
}

/** Minutos de 'HH:MM'. */
const aMin = (hhmm: string): number => {
  const [h, m] = String(hhmm || '').slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
/** Semana ISO de una fecha 'YYYY-MM-DD'. */
function semanaISO(iso: string): number {
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return 0;
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3);
  const primerJueves = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((dt.getTime() - primerJueves.getTime()) / 86400000 - 3 + ((primerJueves.getUTCDay() + 6) % 7)) / 7);
}

/**
 * DETECTA y guarda el TE del periodo (sólo turnos con `calcula_tiempo_extra`), y
 * recalcula la clasificación/importes/ISR de TODO el periodo. Idempotente: si ya
 * existía un renglón AUTORIZADO/RECHAZADO conserva su decisión; los DETECTADOS se
 * reescriben con la detección fresca.
 */
export async function detectarYCalcular(companyId: string, periodoId: string, userId?: string) {
  const p = await periodosSvc.obtener(companyId, periodoId);
  if (p.estatus === 'CERRADO') throw new ValidationError('Ese periodo ya está cerrado: sus importes no se mueven.');
  const ini = String(p.fecha_inicio).slice(0, 10);
  const fin = String(p.fecha_fin).slice(0, 10);
  const anio = Number(ini.slice(0, 4));

  const params = await cargarParametros(anio);
  if (!params) {
    return { aviso: `No hay parámetros de tiempo extra para ${anio}. Captúralos en Nómina → Parámetros.`, detectados: 0, filas: [] as any[] };
  }
  const ej = await ejercicios.cargar(anio).catch(() => null);
  const umaDiaria = Number(ej?.umaDiaria) || 0;

  /* Trabajadores con turno que CALCULA tiempo extra (FIJO o rotativo base). */
  const emps = await query<any>(
    `SELECT h.empleado_id, t.id AS turno_id, t.hora_salida, t.dias AS base_dias, t.hora_entrada,
            t.tolerancia_salida_min, t.redondeo_min, t.requiere_autorizacion_te,
            e.salario_diario,
            TRIM(e.nombre || ' ' || e.apellido_pat || ' ' || COALESCE(e.apellido_mat,'')) AS nombre,
            TO_CHAR(e.fecha_ingreso,'YYYY-MM-DD') AS fecha_ingreso,
            TO_CHAR(e.fecha_baja,'YYYY-MM-DD') AS fecha_baja,
            TO_CHAR(e.fecha_reingreso,'YYYY-MM-DD') AS fecha_reingreso
       FROM checador_empleado_horario h
       JOIN checador_turnos t ON t.id = h.turno_id
       JOIN nomina_empleados e ON e.id = h.empleado_id
      WHERE h.company_id = $1 AND h.tipo <> 'EXENTO' AND t.calcula_tiempo_extra = TRUE
        AND e.deleted_at IS NULL`,
    [companyId]);
  if (!emps.rows.length) {
    return { aviso: 'Ningún turno tiene activado el cálculo de tiempo extra (Checador → Turnos).', detectados: 0, filas: [] };
  }

  /* Asignación por fecha (rotativo): empleado → día → turno (hora_salida, tolerancia, redondeo). */
  const asig = await query<any>(
    `SELECT a.empleado_id, TO_CHAR(a.fecha,'YYYY-MM-DD') AS dia,
            t.id AS turno_id, t.hora_salida, t.tolerancia_salida_min, t.redondeo_min, t.calcula_tiempo_extra
       FROM checador_asignacion a JOIN checador_turnos t ON t.id = a.turno_id
      WHERE a.company_id = $1 AND a.fecha BETWEEN $2::date AND $3::date`, [companyId, ini, fin]);
  const asignado = new Map<string, Map<string, any>>();
  for (const a of asig.rows) {
    if (!asignado.has(a.empleado_id)) asignado.set(a.empleado_id, new Map());
    asignado.get(a.empleado_id)!.set(a.dia, a);
  }

  /* ÚLTIMA salida de cada empleado por día (hora de México). */
  const ev = await query<any>(
    `SELECT empleado_id, TO_CHAR(ts AT TIME ZONE 'America/Mexico_City','YYYY-MM-DD') AS dia,
            TO_CHAR(MAX(ts) AT TIME ZONE 'America/Mexico_City','HH24:MI') AS salida
       FROM checador_evento
      WHERE company_id=$1 AND empleado_id IS NOT NULL AND tipo='SALIDA'
        AND (ts AT TIME ZONE 'America/Mexico_City')::date BETWEEN $2::date AND $3::date
      GROUP BY empleado_id, dia`, [companyId, ini, fin]);
  const salidas = new Map<string, Map<string, string>>();
  for (const r of ev.rows) {
    if (!salidas.has(r.empleado_id)) salidas.set(r.empleado_id, new Map());
    salidas.get(r.empleado_id)!.set(r.dia, r.salida);
  }

  const fechas: Array<{ iso: string; dow: number }> = [];
  for (let d = new Date(`${ini}T00:00:00Z`); d <= new Date(`${fin}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    fechas.push({ iso: d.toISOString().slice(0, 10), dow: d.getUTCDay() });
  }

  // Decisiones ya tomadas (autorizado/rechazado) que NO se pisan al redetectar.
  const prev = await query<any>(
    `SELECT empleado_id, TO_CHAR(fecha,'YYYY-MM-DD') AS fecha, estatus, minutos_autorizados, autorizado_por, motivo
       FROM nomina_tiempo_extra WHERE company_id=$1 AND periodo_id=$2`, [companyId, periodoId]);
  const decision = new Map<string, any>();
  for (const x of prev.rows) if (['AUTORIZADO', 'RECHAZADO'].includes(x.estatus)) decision.set(`${x.empleado_id}|${x.fecha}`, x);

  // 1) Detección por día → renglones crudos.
  type Fila = {
    empleado_id: string; nombre: string; fecha: string; semana: number; turno_id: string;
    horaProg: string; horaReal: string; tol: number; redondeo: number; minutos: number;
    salarioDiario: number; requiereAut: boolean;
  };
  const crudas: Fila[] = [];
  for (const e of emps.rows) {
    const diasBase: number[] = (e.base_dias || []).map((x: any) => Number(x));
    const salEmp = salidas.get(e.empleado_id) || new Map<string, string>();
    const asigEmp = asignado.get(e.empleado_id);
    const desde = e.fecha_reingreso || e.fecha_ingreso;
    for (const f of fechas) {
      let turno: any = null;
      if (asigEmp && asigEmp.has(f.iso)) { const a = asigEmp.get(f.iso); if (a.calcula_tiempo_extra) turno = a; }
      else if (e.hora_salida && diasBase.includes(f.dow)) turno = e;
      if (!turno) continue;
      if (desde && f.iso < desde) continue;
      if (e.fecha_baja && f.iso > e.fecha_baja) continue;

      const salReal = salEmp.get(f.iso);
      if (!salReal) continue;                       // sin checada de salida → no se detecta
      const tol = Number(turno.tolerancia_salida_min) || 0;
      const redondeo = Number(turno.redondeo_min) || 0;
      const progMin = aMin(turno.hora_salida), realMin = aMin(salReal);
      let min = realMin - (progMin + tol);          // minutos después de la salida + tolerancia
      if (min <= 0) continue;                        // salió dentro de la tolerancia
      if (redondeo > 0) min = Math.round(min / redondeo) * redondeo;
      crudas.push({
        empleado_id: e.empleado_id, nombre: e.nombre, fecha: f.iso, semana: semanaISO(f.iso),
        turno_id: turno.turno_id, horaProg: String(turno.hora_salida).slice(0, 5), horaReal: salReal,
        tol, redondeo, minutos: min, salarioDiario: Number(e.salario_diario) || 0,
        requiereAut: e.requiere_autorizacion_te !== false,
      });
    }
  }

  // 2) Cálculo por SEMANA: clasifica doble/triple y la parte exenta/gravada de ISR.
  const porSemana = new Map<string, Fila[]>();   // empleado|semana → filas
  for (const f of crudas) {
    const k = `${f.empleado_id}|${f.semana}`;
    if (!porSemana.has(k)) porSemana.set(k, []);
    porSemana.get(k)!.push(f);
  }
  const resultado: any[] = [];
  for (const filas of porSemana.values()) {
    filas.sort((a, b) => a.fecha.localeCompare(b.fecha));   // doble se asigna cronológicamente
    const salarioDiario = filas[0].salarioDiario;
    const valorHora = params.horasJornadaDia > 0 ? r2(salarioDiario / params.horasJornadaDia) : 0;
    const topeDoblesMin = params.horasDoblesSemana * 60;
    let acumMin = 0, brutoSemana = 0;
    const calc: Array<Fila & { hd: number; ht: number; idbl: number; itrp: number; bruto: number }> = [];
    for (const f of filas) {
      // minutos autorizables: si ya hay decisión, respétala; si no, el detectado (si
      // no requiere autorización, es pagable directo).
      const d = decision.get(`${f.empleado_id}|${f.fecha}`);
      let minUsar = f.minutos;
      if (d) minUsar = d.estatus === 'RECHAZADO' ? 0 : (d.minutos_autorizados ?? f.minutos);
      else if (f.requiereAut) minUsar = 0;      // pendiente de autorizar → aún no paga
      const dentroDoble = Math.max(0, Math.min(minUsar, topeDoblesMin - acumMin));
      const enTriple = Math.max(0, minUsar - dentroDoble);
      acumMin += minUsar;
      const hd = r2(dentroDoble / 60), ht = r2(enTriple / 60);
      const idbl = r2(hd * valorHora * 2), itrp = r2(ht * valorHora * 3);
      const bruto = r2(idbl + itrp);
      brutoSemana += bruto;
      calc.push({ ...f, hd, ht, idbl, itrp, bruto });
    }
    // ISR (LISR Art. 93-I): 50% exento, tope 5 UMA por semana; se prorratea a los días.
    const exentoSemana = r2(Math.min(0.5 * brutoSemana, 5 * umaDiaria));
    for (const c of calc) {
      const exento = brutoSemana > 0 ? r2(exentoSemana * (c.bruto / brutoSemana)) : 0;
      resultado.push({ ...c, valorHora, exento, gravado: r2(c.bruto - exento) });
    }
  }

  // 3) Persistir (idempotente por empresa/empleado/fecha). Conserva la decisión previa.
  for (const c of resultado) {
    const d = decision.get(`${c.empleado_id}|${c.fecha}`);
    const estatus = d?.estatus || (c.requiereAut ? 'DETECTADO' : 'AUTORIZADO');
    const minAut = d ? (d.estatus === 'RECHAZADO' ? 0 : (d.minutos_autorizados ?? c.minutos)) : (c.requiereAut ? null : c.minutos);
    const pagable = estatus === 'RECHAZADO' ? 0 : (minAut ?? 0);
    await query(
      `INSERT INTO nomina_tiempo_extra
         (company_id, empleado_id, periodo_id, fecha, semana_iso, turno_id, hora_salida_prog, hora_salida_real,
          tolerancia_min, minutos_detectados, minutos_autorizados, minutos_pagables, valor_hora,
          horas_dobles, importe_dobles, horas_triples, importe_triples, total_bruto, exento_isr, gravado_isr,
          estatus, autorizado_por, motivo, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW())
       ON CONFLICT (company_id, empleado_id, fecha) DO UPDATE SET
         periodo_id=EXCLUDED.periodo_id, semana_iso=EXCLUDED.semana_iso, turno_id=EXCLUDED.turno_id,
         hora_salida_prog=EXCLUDED.hora_salida_prog, hora_salida_real=EXCLUDED.hora_salida_real,
         tolerancia_min=EXCLUDED.tolerancia_min, minutos_detectados=EXCLUDED.minutos_detectados,
         minutos_autorizados=EXCLUDED.minutos_autorizados, minutos_pagables=EXCLUDED.minutos_pagables,
         valor_hora=EXCLUDED.valor_hora, horas_dobles=EXCLUDED.horas_dobles, importe_dobles=EXCLUDED.importe_dobles,
         horas_triples=EXCLUDED.horas_triples, importe_triples=EXCLUDED.importe_triples, total_bruto=EXCLUDED.total_bruto,
         exento_isr=EXCLUDED.exento_isr, gravado_isr=EXCLUDED.gravado_isr, updated_at=NOW()`,
      [companyId, c.empleado_id, periodoId, c.fecha, c.semana, c.turno_id, c.horaProg, c.horaReal,
       c.tol, c.minutos, minAut, pagable, c.valorHora,
       c.hd, c.idbl, c.ht, c.itrp, c.bruto, c.exento, c.gravado,
       estatus, d?.autorizado_por || null, d?.motivo || null]);
  }

  return {
    aviso: params.confirmado ? '' : `Los parámetros de tiempo extra de ${anio} aún no están confirmados: valídalos contra el DOF en Nómina → Parámetros.`,
    detectados: resultado.length,
    filas: await listar(companyId, periodoId),
  };
}

/** Los renglones de TE de un periodo (para la pantalla). */
export async function listar(companyId: string, periodoId: string) {
  const r = await query<any>(
    `SELECT te.id, te.empleado_id, TO_CHAR(te.fecha,'YYYY-MM-DD') AS fecha, te.semana_iso,
            TRIM(e.nombre || ' ' || e.apellido_pat || ' ' || COALESCE(e.apellido_mat,'')) AS nombre,
            e.num_empleado AS numero,
            te.hora_salida_prog, te.hora_salida_real, te.tolerancia_min,
            te.minutos_detectados, te.minutos_autorizados, te.minutos_pagables,
            te.valor_hora::float AS valor_hora,
            te.horas_dobles::float AS horas_dobles, te.importe_dobles::float AS importe_dobles,
            te.horas_triples::float AS horas_triples, te.importe_triples::float AS importe_triples,
            te.total_bruto::float AS total_bruto, te.exento_isr::float AS exento_isr, te.gravado_isr::float AS gravado_isr,
            te.estatus, te.motivo
       FROM nomina_tiempo_extra te
       JOIN nomina_empleados e ON e.id = te.empleado_id
      WHERE te.company_id=$1 AND te.periodo_id=$2
      ORDER BY nombre, te.fecha`, [companyId, periodoId]);
  const filas = r.rows;
  const tot = filas.reduce((a: any, f: any) => ({
    bruto: a.bruto + Number(f.total_bruto || 0),
    exento: a.exento + Number(f.exento_isr || 0),
    gravado: a.gravado + Number(f.gravado_isr || 0),
    pagable: a.pagable + Number(f.minutos_pagables || 0),
  }), { bruto: 0, exento: 0, gravado: 0, pagable: 0 });
  return {
    filas,
    totales: { bruto: r2(tot.bruto), exento: r2(tot.exento), gravado: r2(tot.gravado), horasPagables: r2(tot.pagable / 60) },
    pendientes: filas.filter((f: any) => f.estatus === 'DETECTADO').length,
  };
}

/** Autoriza (o ajusta) los minutos de un renglón. Recalcula el periodo. */
export async function autorizar(companyId: string, id: string, minutos: number | null, userId?: string) {
  const row = (await query<any>(
    `SELECT periodo_id, minutos_detectados FROM nomina_tiempo_extra WHERE id=$1 AND company_id=$2`, [id, companyId])).rows[0];
  if (!row) throw new NotFoundError('Registro de tiempo extra no encontrado.');
  const min = minutos == null ? row.minutos_detectados : Math.max(0, Math.round(Number(minutos)));
  await query(
    `UPDATE nomina_tiempo_extra SET estatus='AUTORIZADO', minutos_autorizados=$3, autorizado_por=$4, motivo=NULL, updated_at=NOW()
      WHERE id=$1 AND company_id=$2`, [id, companyId, min, userId || null]);
  if (row.periodo_id) await detectarYCalcular(companyId, row.periodo_id, userId);
  return { ok: true };
}

/** Rechaza un renglón (no se paga). */
export async function rechazar(companyId: string, id: string, motivo: string, userId?: string) {
  const row = (await query<any>(`SELECT periodo_id FROM nomina_tiempo_extra WHERE id=$1 AND company_id=$2`, [id, companyId])).rows[0];
  if (!row) throw new NotFoundError('Registro de tiempo extra no encontrado.');
  await query(
    `UPDATE nomina_tiempo_extra SET estatus='RECHAZADO', minutos_autorizados=0, minutos_pagables=0, autorizado_por=$3,
       motivo=$4, updated_at=NOW() WHERE id=$1 AND company_id=$2`, [id, companyId, userId || null, motivo || null]);
  if (row.periodo_id) await detectarYCalcular(companyId, row.periodo_id, userId);
  return { ok: true };
}

/** Autoriza TODO lo pendiente del periodo con el detectado (atajo). */
export async function autorizarTodos(companyId: string, periodoId: string, userId?: string) {
  await query(
    `UPDATE nomina_tiempo_extra SET estatus='AUTORIZADO', minutos_autorizados=minutos_detectados,
       autorizado_por=$3, motivo=NULL, updated_at=NOW()
      WHERE company_id=$1 AND periodo_id=$2 AND estatus='DETECTADO'`, [companyId, periodoId, userId || null]);
  await detectarYCalcular(companyId, periodoId, userId);
  return listar(companyId, periodoId);
}
