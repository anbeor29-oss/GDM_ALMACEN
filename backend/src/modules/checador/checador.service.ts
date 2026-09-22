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
import * as XLSX from 'xlsx';
import { query } from '../../config/database';
import { reporteTablaPdf } from '../../utils/reporte-pdf';
import { fechaMx } from '../../utils/fecha-mx';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler';

/* ── Config por empresa ──────────────────────────────────────────────────── */

const CONFIG_DEFAULT = {
  activo: true,
  tolerancia_retardo_min: null as number | null,
  // Si >0, cada N retardos del periodo cuentan como 1 falta. NULL/0 = informativos.
  retardos_por_falta: null as number | null,
  registra_comida: false,
  horas_semanales: 48,
  radio_kiosco_m: 100,
  umbral_distancia: 0.6,
  // Horas mínimas tras la ENTRADA para aceptar la SALIDA (configurable, default 3).
  horas_min_salida: 3,
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
       (company_id, activo, tolerancia_retardo_min, retardos_por_falta, registra_comida, horas_semanales, radio_kiosco_m, umbral_distancia, horas_min_salida)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (company_id) DO UPDATE SET
       activo = EXCLUDED.activo,
       tolerancia_retardo_min = EXCLUDED.tolerancia_retardo_min,
       retardos_por_falta = EXCLUDED.retardos_por_falta,
       registra_comida = EXCLUDED.registra_comida,
       horas_semanales = EXCLUDED.horas_semanales,
       radio_kiosco_m = EXCLUDED.radio_kiosco_m,
       umbral_distancia = EXCLUDED.umbral_distancia,
       horas_min_salida = EXCLUDED.horas_min_salida,
       updated_at = NOW()`,
    [companyId, n.activo, n.tolerancia_retardo_min, n.retardos_por_falta, n.registra_comida,
     n.horas_semanales, n.radio_kiosco_m, n.umbral_distancia,
     (n.horas_min_salida == null || (n as any).horas_min_salida === '') ? 3 : Number(n.horas_min_salida)]);
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

/* ── Kioscos (ubicación FIJA por centro de trabajo) ──────────────────────────
 * Cada kiosco tiene NOMBRE y COORDENADAS del centro donde está la tableta. La
 * tableta se amarra a uno (en su localStorage) y cada checada queda ligada a él;
 * así el registro dice EN QUÉ CENTRO se marcó. No se rechaza por lejanía. */

/** Valida coordenadas/radio; deja NULL lo que no venga o esté vacío. */
function normalizarUbicacion(d: any): { lat: number | null; lng: number | null; radio: number | null } {
  const lat = d?.lat != null && d.lat !== '' ? Number(d.lat) : null;
  const lng = d?.lng != null && d.lng !== '' ? Number(d.lng) : null;
  if (lat != null && (isNaN(lat) || lat < -90 || lat > 90)) throw new ValidationError('Latitud fuera de rango (-90 a 90).');
  if (lng != null && (isNaN(lng) || lng < -180 || lng > 180)) throw new ValidationError('Longitud fuera de rango (-180 a 180).');
  const radio = d?.radio_m != null && d.radio_m !== '' ? Math.max(0, Math.round(Number(d.radio_m))) : null;
  return { lat, lng, radio };
}

export async function listarKioscos(companyId: string) {
  const r = await query<any>(
    `SELECT id, nombre, lat, lng, radio_m, activo
       FROM checador_kioscos WHERE company_id = $1 AND activo ORDER BY nombre`, [companyId]);
  return r.rows;
}

export async function crearKiosco(companyId: string, d: any) {
  if (!d?.nombre || !String(d.nombre).trim()) throw new ValidationError('El kiosco necesita un nombre.');
  const { lat, lng, radio } = normalizarUbicacion(d);
  const r = await query<any>(
    `INSERT INTO checador_kioscos (company_id, nombre, lat, lng, radio_m)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, nombre, lat, lng, radio_m, activo`,
    [companyId, String(d.nombre).trim(), lat, lng, radio]);
  return r.rows[0];
}

export async function actualizarKiosco(companyId: string, id: string, d: any) {
  const { lat, lng, radio } = normalizarUbicacion(d);
  const r = await query<any>(
    `UPDATE checador_kioscos SET
       nombre = COALESCE($3, nombre), lat = $4, lng = $5, radio_m = $6, updated_at = NOW()
     WHERE id = $1 AND company_id = $2
     RETURNING id, nombre, lat, lng, radio_m, activo`,
    [id, companyId, d.nombre ? String(d.nombre).trim() : null, lat, lng, radio]);
  if (!r.rows.length) throw new NotFoundError('Kiosco no encontrado');
  return r.rows[0];
}

export async function borrarKiosco(companyId: string, id: string) {
  await query(`UPDATE checador_kioscos SET activo = false, updated_at = NOW() WHERE id = $1 AND company_id = $2`, [id, companyId]);
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

/**
 * Asignación MASIVA de horario: el mismo turno (o EXENTO) a varios empleados de un
 * golpe. Pensado para cuando la plantilla crece —marcar 30 y ponerles el matutino
 * sin abrir uno por uno—. Sólo toca empleados de la empresa (ignora ids ajenos) y
 * un solo upsert; conserva la tolerancia individual de cada quien.
 */
export async function asignarHorarioMasivo(
  companyId: string,
  empleadoIds: string[],
  d: { tipo?: string; turno_id?: string | null },
): Promise<{ asignados: number }> {
  const tipo = String(d?.tipo || 'FIJO').toUpperCase();
  if (!['FIJO', 'ROTATIVO', 'EXENTO'].includes(tipo)) {
    throw new ValidationError('tipo debe ser FIJO, ROTATIVO o EXENTO.');
  }
  const ids = Array.from(new Set((empleadoIds || []).filter(Boolean)));
  if (!ids.length) throw new ValidationError('Selecciona al menos un empleado.');
  const turnoId = tipo === 'FIJO' ? (d.turno_id || null) : null;
  if (tipo === 'FIJO' && !turnoId) throw new ValidationError('Elige el turno a asignar.');

  // Sólo los que de verdad son de esta empresa (evita asignar a ajenos por id suelto).
  const val = await query<any>(
    `SELECT id FROM nomina_empleados
      WHERE company_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
    [companyId, ids]);
  const validos = val.rows.map((r) => r.id);
  if (!validos.length) throw new ValidationError('Ninguno de los empleados es de esta empresa.');

  await query(
    `INSERT INTO checador_empleado_horario (empleado_id, company_id, tipo, turno_id)
     SELECT e, $1, $2, $3 FROM unnest($4::uuid[]) AS e
     ON CONFLICT (empleado_id) DO UPDATE SET
       tipo = EXCLUDED.tipo, turno_id = EXCLUDED.turno_id, updated_at = NOW()`,
    [companyId, tipo, turnoId, validos]);
  return { asignados: validos.length };
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

/** Distancia en METROS entre dos coordenadas (haversine). */
function metrosEntre(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))));
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

/**
 * Registra una CHECADA desde el kiosco/app: identifica el rostro (1:N) y, si lo
 * reconoce, asienta el evento (ENTRADA/SALIDA por toggle del último evento del
 * día). Con «debounce» de 90 s para que la cámara no dispare varios seguidos.
 */
export async function registrarChecada(
  companyId: string,
  d: { descriptor: any; lat?: number | null; lng?: number | null; origen?: string; device?: any; kioscoId?: string | null },
) {
  const origen = d.origen === 'APP' ? 'APP' : 'KIOSCO';
  const ident = await identificar(companyId, d.descriptor);

  /* Si no se reconoce a nadie NO se guarda nada: antes se asentaba un
   * NO_RECONOCIDO por cada cara desconocida y el historial se llenaba de basura.
   * Simplemente se avisa en pantalla y no queda registro. */
  if (!ident) {
    return { reconocido: false };
  }

  const emp = await query<any>(
    `SELECT id, TRIM(nombre || ' ' || apellido_pat || ' ' || COALESCE(apellido_mat,'')) AS nombre
       FROM nomina_empleados WHERE id = $1 AND company_id = $2`, [ident.empleadoId, companyId]);
  const nombre = emp.rows[0]?.nombre || 'Empleado';

  // Debounce: si ya checó hace menos de 90 s, no se duplica el evento.
  const reciente = await query<any>(
    `SELECT tipo FROM checador_evento
      WHERE company_id=$1 AND empleado_id=$2 AND ts > NOW() - INTERVAL '90 seconds'
      ORDER BY ts DESC LIMIT 1`, [companyId, ident.empleadoId]);
  if (reciente.rows.length) {
    return { reconocido: true, repetido: true, empleado: { id: ident.empleadoId, nombre },
      tipo: reciente.rows[0].tipo, confianza: ident.confianza };
  }

  // ENTRADA/SALIDA por el último evento de HOY (hora de México).
  const ult = await query<any>(
    `SELECT tipo, ts FROM checador_evento
      WHERE company_id=$1 AND empleado_id=$2
        AND ts AT TIME ZONE 'America/Mexico_City' >= (NOW() AT TIME ZONE 'America/Mexico_City')::date
        AND tipo IN ('ENTRADA','SALIDA')
      ORDER BY ts DESC LIMIT 1`, [companyId, ident.empleadoId]);
  const ultimo = ult.rows[0];
  const tipo = ultimo && ultimo.tipo === 'ENTRADA' ? 'SALIDA' : 'ENTRADA';

  /* La SALIDA sólo se asienta si pasaron al menos N HORAS desde la ENTRADA (config
   * `horas_min_salida`, default 3): sin esto, checar entrada y salida seguidas
   * llenaría el historial de pares inútiles. Antes del tope no se guarda nada. */
  const cfg = await getConfig(companyId);
  const minSalida = Number(cfg.horas_min_salida) || 3;
  if (tipo === 'SALIDA' && ultimo) {
    const horas = (Date.now() - new Date(ultimo.ts).getTime()) / 3_600_000;
    if (horas < minSalida) {
      const minutos = Math.max(1, Math.ceil((minSalida - horas) * 60));
      return {
        reconocido: true, espera: true, empleado: { id: ident.empleadoId, nombre },
        tipo: 'ENTRADA', minutos, confianza: ident.confianza,
        mensaje: `Ya registraste tu entrada. Podrás checar tu salida en ${minutos} min.`,
      };
    }
  }

  /* Kiosco/centro: liga el evento a su kiosco. Si la tableta no manda GPS, usa la
   * ubicación FIJA del kiosco (la tableta está en el centro). No se rechaza por
   * lejanía: sólo se calcula la distancia (si hubo GPS) y se clasifica FUERA_RANGO. */
  let kioscoId: string | null = d.kioscoId || null;
  let lat = d.lat ?? null;
  let lng = d.lng ?? null;
  let distancia: number | null = null;
  let estado = 'A_TIEMPO';
  if (kioscoId) {
    const k = await query<any>(
      `SELECT lat, lng, radio_m FROM checador_kioscos WHERE id=$1 AND company_id=$2 AND activo`,
      [kioscoId, companyId]);
    const kio = k.rows[0];
    if (!kio) {
      kioscoId = null;                                   // kiosco ajeno/desconocido: se ignora
    } else {
      if (lat == null && kio.lat != null) { lat = kio.lat; lng = kio.lng; }   // la tableta está en el centro
      if (d.lat != null && d.lng != null && kio.lat != null) {
        distancia = metrosEntre(Number(d.lat), Number(d.lng), Number(kio.lat), Number(kio.lng));
        const radio = Number(kio.radio_m) || Number(cfg.radio_kiosco_m) || 0;
        if (radio > 0 && distancia > radio) estado = 'FUERA_RANGO';
      }
    }
  }

  const ins = await query<any>(
    `INSERT INTO checador_evento
       (company_id, empleado_id, tipo, origen, lat, lng, distancia_m, confianza, estado, device, kiosco_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ts`,
    [companyId, ident.empleadoId, tipo, origen, lat, lng, distancia,
     ident.confianza, estado, d.device ? JSON.stringify(d.device) : null, kioscoId]);

  return { reconocido: true, empleado: { id: ident.empleadoId, nombre }, tipo, confianza: ident.confianza, ts: ins.rows[0].ts };
}

/** Empleados con consentimiento, para elegir a quién enrolar en el kiosco. */
export async function empleadosParaEnrolar(companyId: string) {
  const r = await query<any>(
    `SELECT e.id,
            TRIM(e.nombre || ' ' || e.apellido_pat || ' ' || COALESCE(e.apellido_mat,'')) AS nombre,
            e.num_empleado,
            (SELECT COUNT(*)::int FROM checador_rostro r WHERE r.empleado_id = e.id) AS plantillas,
            COALESCE(c.aceptado, false) AS consentimiento
       FROM nomina_empleados e
       LEFT JOIN checador_consentimiento c ON c.empleado_id = e.id AND c.company_id = e.company_id
      WHERE e.company_id = $1 AND e.deleted_at IS NULL AND COALESCE(e.activo, true)
      ORDER BY nombre`, [companyId]);
  return r.rows;
}

/* ── Registro de asistencia (requerimiento de ley) ───────────────────────── */

/**
 * Registro del DÍA: por trabajador, su PRIMERA entrada y ÚLTIMA salida, en hora
 * de México. Sólo empleados que tuvieron movimiento ese día (el registro real).
 * Las horas se calculan con la diferencia entrada→salida.
 */
export async function asistenciaDelDia(companyId: string, fecha?: string) {
  const f = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : new Date().toISOString().slice(0, 10);
  const r = await query<any>(
    `WITH ev AS (
       SELECT e.empleado_id,
              MIN(e.ts) FILTER (WHERE e.tipo = 'ENTRADA') AS entrada,
              MAX(e.ts) FILTER (WHERE e.tipo = 'SALIDA')  AS salida,
              COUNT(*)::int AS movimientos,
              bool_or(e.origen = 'APP') AS hubo_campo
         FROM checador_evento e
        WHERE e.company_id = $1 AND e.empleado_id IS NOT NULL
          AND (e.ts AT TIME ZONE 'America/Mexico_City')::date = $2::date
        GROUP BY e.empleado_id)
     SELECT ev.empleado_id,
            TRIM(emp.nombre || ' ' || emp.apellido_pat || ' ' || COALESCE(emp.apellido_mat,'')) AS nombre,
            emp.num_empleado, emp.puesto,
            TO_CHAR(ev.entrada AT TIME ZONE 'America/Mexico_City', 'HH24:MI') AS entrada,
            TO_CHAR(ev.salida  AT TIME ZONE 'America/Mexico_City', 'HH24:MI') AS salida,
            CASE WHEN ev.entrada IS NOT NULL AND ev.salida IS NOT NULL AND ev.salida > ev.entrada
                 THEN ROUND((EXTRACT(EPOCH FROM (ev.salida - ev.entrada)) / 3600.0)::numeric, 2) END AS horas,
            ev.movimientos, ev.hubo_campo
       FROM ev JOIN nomina_empleados emp ON emp.id = ev.empleado_id
      ORDER BY nombre`,
    [companyId, f]);
  return { fecha: f, filas: r.rows };
}

/**
 * Historial (el registro electrónico legal): CADA checada, más reciente primero,
 * con fecha/hora de México, tipo, origen, estado y coordenadas. Filtrable por
 * rango de fechas y por empleado. Incluye los NO_RECONOCIDO (empleado NULL).
 */
export async function historialAsistencia(
  companyId: string,
  f: { desde?: string; hasta?: string; empleadoId?: string; limit?: number } = {},
) {
  const params: any[] = [companyId];
  const where = ['e.company_id = $1'];
  if (f.desde && /^\d{4}-\d{2}-\d{2}$/.test(f.desde)) {
    params.push(f.desde); where.push(`(e.ts AT TIME ZONE 'America/Mexico_City')::date >= $${params.length}::date`);
  }
  if (f.hasta && /^\d{4}-\d{2}-\d{2}$/.test(f.hasta)) {
    params.push(f.hasta); where.push(`(e.ts AT TIME ZONE 'America/Mexico_City')::date <= $${params.length}::date`);
  }
  if (f.empleadoId) { params.push(f.empleadoId); where.push(`e.empleado_id = $${params.length}`); }
  const limit = Math.min(5000, Math.max(1, Number(f.limit) || 500));

  const r = await query<any>(
    `SELECT e.id,
            TO_CHAR(e.ts AT TIME ZONE 'America/Mexico_City', 'DD/MM/YYYY') AS fecha,
            TO_CHAR(e.ts AT TIME ZONE 'America/Mexico_City', 'HH24:MI:SS') AS hora,
            e.tipo, e.origen, e.estado, e.lat, e.lng, e.confianza, e.empleado_id,
            COALESCE(NULLIF(TRIM(emp.nombre || ' ' || emp.apellido_pat || ' ' || COALESCE(emp.apellido_mat,'')), ''), 'No reconocido') AS nombre,
            emp.num_empleado, emp.puesto, k.nombre AS kiosco
       FROM checador_evento e
       LEFT JOIN nomina_empleados emp ON emp.id = e.empleado_id
       LEFT JOIN checador_kioscos k ON k.id = e.kiosco_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.ts DESC
      LIMIT ${limit}`,
    params);
  return r.rows;
}

/** Empresa (razón social + RFC) para el encabezado de los reportes. */
async function empresaDe(companyId: string): Promise<{ nombre: string; rfc: string }> {
  const r = await query<any>(`SELECT business_name, rfc FROM companies WHERE id = $1`, [companyId]);
  return { nombre: r.rows[0]?.business_name || 'Empresa', rfc: r.rows[0]?.rfc || '' };
}

/** El historial a EXCEL (para revisar/ordenar). */
export async function historialExcel(companyId: string, f: any): Promise<{ buffer: Buffer; nombre: string }> {
  const filas: any[] = await historialAsistencia(companyId, f);
  const rows = filas.map((x) => ({
    Fecha: x.fecha, Hora: x.hora, Trabajador: x.nombre, Puesto: x.puesto || '',
    'Núm.': x.num_empleado || '', Tipo: x.tipo,
    Origen: x.origen === 'APP' ? 'Campo' : 'Kiosco', Centro: x.kiosco || '', Estado: x.estado,
    Latitud: x.lat ?? '', Longitud: x.lng ?? '',
    Ubicación: (x.lat != null && x.lng != null) ? `https://www.google.com/maps?q=${x.lat},${x.lng}` : '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Asistencia');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return { buffer, nombre: `Asistencia_${f.desde || 'inicio'}_a_${f.hasta || 'hoy'}.xlsx` };
}

/** El historial a PDF (registro electrónico de asistencia, con encabezado de la casa). */
export async function historialPdf(companyId: string, f: any): Promise<Buffer> {
  const filas: any[] = await historialAsistencia(companyId, f);
  const empresa = await empresaDe(companyId);
  const sub: string[] = [];
  if (f.desde || f.hasta) sub.push(`Periodo: ${f.desde ? fechaMx(f.desde) : '…'} a ${f.hasta ? fechaMx(f.hasta) : '…'}`);
  sub.push(`${filas.length} registro(s)`);
  return reporteTablaPdf({
    titulo: 'Registro de asistencia',
    empresa: empresa.nombre, rfc: empresa.rfc,
    subtitulos: sub,
    orientacion: 'landscape',
    columnas: [
      { titulo: 'Fecha', clave: 'fecha', ancho: 12 },
      { titulo: 'Hora', clave: 'hora', ancho: 10 },
      { titulo: 'Trabajador', clave: 'nombre', ancho: 26, align: 'left' },
      { titulo: 'Puesto', clave: 'puesto', ancho: 18, align: 'left' },
      { titulo: 'Tipo', clave: 'tipo', ancho: 10 },
      { titulo: 'Origen', clave: 'origenTxt', ancho: 10 },
      { titulo: 'Centro', clave: 'kiosco', ancho: 16, align: 'left' },
      { titulo: 'Estado', clave: 'estado', ancho: 14 },
      { titulo: 'Ubicación', clave: 'ubic', ancho: 20, align: 'left' },
    ],
    filas: filas.map((x) => ({
      ...x, puesto: x.puesto || '',
      origenTxt: x.origen === 'APP' ? 'Campo' : 'Kiosco',
      ubic: (x.lat != null && x.lng != null) ? `${x.lat}, ${x.lng}` : '',
    })),
    nota: 'Registro electrónico de asistencia — checador biométrico.',
  });
}

export default {
  getConfig, setConfig,
  listarTurnos, crearTurno, actualizarTurno, borrarTurno,
  listarKioscos, crearKiosco, actualizarKiosco, borrarKiosco,
  getHorario, setHorario, asignarHorarioMasivo, asignarDia,
  getConsentimiento, setConsentimiento,
  enrolarRostros, estadoEnrolamiento, identificar,
  registrarChecada, empleadosParaEnrolar,
  asistenciaDelDia, historialAsistencia, historialExcel, historialPdf,
};
