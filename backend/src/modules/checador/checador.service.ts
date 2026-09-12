/**
 * Checador — control de asistencia biométrico (backend).
 *
 * Diseño (ver migración 2026-09-12_checador.sql):
 *  · El rostro se guarda como DESCRIPTOR (arreglo de flotantes de face-api, 128),
 *    no la foto. El match 1:N se hace AQUÍ, por distancia euclidiana contra los
 *    rostros de la empresa — a escala de una empresa es instantáneo y no exige
 *    pgvector.
 *  · Todo lo sensible a la ley es CONFIGURABLE (tolerancia, comida, horas
 *    semanales 48→40). Nada se asume en el código.
 *  · La asistencia alimenta la PRENÓMINA (checador_resumen_dia); no reemplaza el
 *    cálculo.
 */
import { query } from '../../config/database';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler';

/* ── Config por empresa ──────────────────────────────────────────────────── */

const CONFIG_DEFAULT = {
  activo: true,
  tolerancia_retardo_min: null as number | null,
  registra_comida: false,
  horas_semanales: 48,
  radio_kiosco_m: 100,
  umbral_distancia: 0.6,
};

export async function getConfig(companyId: string) {
  const r = await query<any>(`SELECT * FROM checador_config WHERE company_id = $1`, [companyId]);
  if (!r.rows.length) return { company_id: companyId, ...CONFIG_DEFAULT };
  return r.rows[0];
}

export async function setConfig(companyId: string, d: Partial<typeof CONFIG_DEFAULT>) {
  const a = await getConfig(companyId);
  const n = { ...a, ...d };
  await query(
    `INSERT INTO checador_config
       (company_id, activo, tolerancia_retardo_min, registra_comida, horas_semanales, radio_kiosco_m, umbral_distancia)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (company_id) DO UPDATE SET
       activo = EXCLUDED.activo,
       tolerancia_retardo_min = EXCLUDED.tolerancia_retardo_min,
       registra_comida = EXCLUDED.registra_comida,
       horas_semanales = EXCLUDED.horas_semanales,
       radio_kiosco_m = EXCLUDED.radio_kiosco_m,
       umbral_distancia = EXCLUDED.umbral_distancia,
       updated_at = NOW()`,
    [companyId, n.activo, n.tolerancia_retardo_min, n.registra_comida,
     n.horas_semanales, n.radio_kiosco_m, n.umbral_distancia]);
  return getConfig(companyId);
}

/* ── Turnos (para horarios FIJOS) ────────────────────────────────────────── */

export async function listarTurnos(companyId: string) {
  const r = await query<any>(
    `SELECT * FROM checador_turnos WHERE company_id = $1 AND activo ORDER BY hora_entrada`, [companyId]);
  return r.rows;
}

export async function crearTurno(companyId: string, d: any) {
  if (!d?.nombre || !d?.hora_entrada || !d?.hora_salida) {
    throw new ValidationError('El turno necesita nombre, hora de entrada y de salida.');
  }
  const r = await query<any>(
    `INSERT INTO checador_turnos
       (company_id, nombre, hora_entrada, comida_inicio, comida_fin, hora_salida, dias)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [companyId, d.nombre, d.hora_entrada, d.comida_inicio || null, d.comida_fin || null,
     d.hora_salida, d.dias || [1, 2, 3, 4, 5]]);
  return r.rows[0];
}

export async function actualizarTurno(companyId: string, id: string, d: any) {
  const r = await query<any>(
    `UPDATE checador_turnos SET
       nombre = COALESCE($3, nombre),
       hora_entrada = COALESCE($4, hora_entrada),
       comida_inicio = $5, comida_fin = $6,
       hora_salida = COALESCE($7, hora_salida),
       dias = COALESCE($8, dias)
     WHERE id = $1 AND company_id = $2 RETURNING *`,
    [id, companyId, d.nombre ?? null, d.hora_entrada ?? null, d.comida_inicio || null,
     d.comida_fin || null, d.hora_salida ?? null, d.dias ?? null]);
  if (!r.rows.length) throw new NotFoundError('Turno no encontrado');
  return r.rows[0];
}

export async function borrarTurno(companyId: string, id: string) {
  await query(`UPDATE checador_turnos SET activo = false WHERE id = $1 AND company_id = $2`, [id, companyId]);
  return { ok: true };
}

/* ── Horario del empleado ────────────────────────────────────────────────── */

export async function getHorario(companyId: string, empleadoId: string) {
  const r = await query<any>(
    `SELECT * FROM checador_empleado_horario WHERE empleado_id = $1 AND company_id = $2`,
    [empleadoId, companyId]);
  return r.rows[0] || null;
}

export async function setHorario(companyId: string, empleadoId: string, d: any) {
  const tipo = String(d?.tipo || 'FIJO').toUpperCase();
  if (!['FIJO', 'ROTATIVO', 'EXENTO'].includes(tipo)) {
    throw new ValidationError('tipo debe ser FIJO, ROTATIVO o EXENTO.');
  }
  await query(
    `INSERT INTO checador_empleado_horario
       (empleado_id, company_id, tipo, turno_id, tolerancia_override)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (empleado_id) DO UPDATE SET
       tipo = EXCLUDED.tipo, turno_id = EXCLUDED.turno_id,
       tolerancia_override = EXCLUDED.tolerancia_override, updated_at = NOW()`,
    [empleadoId, companyId, tipo, d.turno_id || null,
     d.tolerancia_override != null ? Number(d.tolerancia_override) : null]);
  return getHorario(companyId, empleadoId);
}

/** Asignación por fecha: el rol del rotativo y el caso mixto (oficina/campo). */
export async function asignarDia(companyId: string, empleadoId: string, d: any) {
  if (!d?.fecha) throw new ValidationError('Falta la fecha de la asignación.');
  const modo = String(d.modo || 'OFICINA').toUpperCase();
  const r = await query<any>(
    `INSERT INTO checador_asignacion (company_id, empleado_id, fecha, turno_id, modo)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (empleado_id, fecha) DO UPDATE SET
       turno_id = EXCLUDED.turno_id, modo = EXCLUDED.modo RETURNING *`,
    [companyId, empleadoId, d.fecha, d.turno_id || null, modo]);
  return r.rows[0];
}

/* ── Consentimiento (LFPDPPP) ────────────────────────────────────────────── */

export async function getConsentimiento(companyId: string, empleadoId: string) {
  const r = await query<any>(
    `SELECT * FROM checador_consentimiento WHERE empleado_id = $1 AND company_id = $2`,
    [empleadoId, companyId]);
  return r.rows[0] || { empleado_id: empleadoId, aceptado: false };
}

export async function setConsentimiento(companyId: string, empleadoId: string, d: any) {
  await query(
    `INSERT INTO checador_consentimiento (empleado_id, company_id, aceptado, fecha, metodo, notas)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (empleado_id) DO UPDATE SET
       aceptado = EXCLUDED.aceptado, fecha = EXCLUDED.fecha,
       metodo = EXCLUDED.metodo, notas = EXCLUDED.notas`,
    [empleadoId, companyId, !!d?.aceptado, d?.fecha || new Date().toISOString().slice(0, 10),
     d?.metodo || 'FIRMA_FISICA', d?.notas || null]);
  return getConsentimiento(companyId, empleadoId);
}

/* ── Enrolamiento facial (Fase 1) ────────────────────────────────────────── */

function validarDescriptor(desc: any): number[] {
  if (!Array.isArray(desc) || desc.length < 64 || desc.length > 1024) {
    throw new ValidationError('Descriptor facial inválido (se esperaba un arreglo de flotantes).');
  }
  const v = desc.map(Number);
  if (v.some((x) => !Number.isFinite(x))) throw new ValidationError('El descriptor trae valores no numéricos.');
  return v;
}

/**
 * Enrola los rostros de un empleado. Recibe los DESCRIPTORES (los extrae el
 * cliente con face-api, en el navegador/app), NO la foto cruda. Exige que el
 * empleado exista en la empresa y que haya consentimiento registrado.
 */
export async function enrolarRostros(companyId: string, empleadoId: string, descriptores: any[]) {
  const emp = await query<any>(
    `SELECT id FROM nomina_empleados WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
    [empleadoId, companyId]);
  if (!emp.rows.length) throw new NotFoundError('Empleado no encontrado en esta empresa.');

  const cons = await getConsentimiento(companyId, empleadoId);
  if (!cons.aceptado) {
    throw new ValidationError('Falta el consentimiento biométrico del empleado (LFPDPPP) antes de enrolar su rostro.');
  }
  if (!Array.isArray(descriptores) || !descriptores.length) {
    throw new ValidationError('Manda al menos un descriptor facial (idealmente 3).');
  }
  const vs = descriptores.map(validarDescriptor);

  // Re-enrolar reemplaza las plantillas previas del empleado.
  await query(`DELETE FROM checador_rostro WHERE empleado_id = $1 AND company_id = $2`, [empleadoId, companyId]);
  for (const v of vs) {
    await query(
      `INSERT INTO checador_rostro (company_id, empleado_id, descriptor, dim) VALUES ($1,$2,$3,$4)`,
      [companyId, empleadoId, v, v.length]);
  }
  return { empleadoId, plantillas: vs.length };
}

export async function estadoEnrolamiento(companyId: string, empleadoId: string) {
  const r = await query<any>(
    `SELECT COUNT(*)::int AS n FROM checador_rostro WHERE empleado_id = $1 AND company_id = $2`,
    [empleadoId, companyId]);
  return { empleadoId, plantillas: r.rows[0]?.n || 0 };
}

/* ── Match 1:N (identificación facial) ───────────────────────────────────── */

function distanciaEuclidiana(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

/**
 * Identifica a quién pertenece un rostro (1:N) entre los enrolados de la empresa.
 * Devuelve el empleado más cercano si la distancia ≤ umbral; si no, null.
 */
export async function identificar(companyId: string, descriptor: any) {
  const v = validarDescriptor(descriptor);
  const cfg = await getConfig(companyId);
  const r = await query<any>(
    `SELECT empleado_id, descriptor FROM checador_rostro WHERE company_id = $1`, [companyId]);

  let mejor: { empleadoId: string; dist: number } | null = null;
  for (const row of r.rows) {
    const d = distanciaEuclidiana(v, row.descriptor as number[]);
    if (mejor === null || d < mejor.dist) mejor = { empleadoId: row.empleado_id, dist: d };
  }
  if (mejor && mejor.dist <= Number(cfg.umbral_distancia)) {
    return { empleadoId: mejor.empleadoId, distancia: mejor.dist, confianza: Math.max(0, 1 - mejor.dist) };
  }
  return null;
}

export default {
  getConfig, setConfig,
  listarTurnos, crearTurno, actualizarTurno, borrarTurno,
  getHorario, setHorario, asignarDia,
  getConsentimiento, setConsentimiento,
  enrolarRostros, estadoEnrolamiento, identificar,
};
