/**
 * imss-idse.service — arma el archivo IDSE a partir de los datos que YA viven en
 * el sistema: el registro patronal de la empresa y el padrón de trabajadores.
 *
 * La pantalla manda IDs y los pocos datos del propio movimiento (fecha, y según
 * el tipo: UMF, causa de baja, un SBC que corrige al del expediente). Todo lo
 * demás —NSS, nombre, CURP, salario base— se lee del expediente aquí, para que
 * el archivo que va al IMSS no dependa de lo que alcanzó a copiar la pantalla.
 *
 * El motor de formato (168 posiciones) vive en imss-idse.ts y no toca la base;
 * este archivo es el puente entre la base y ese motor. Ref §5–§8, §25.
 */

import { query } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import {
  generarArchivoIdse, generarArchivoMixto, MovimientoIdse, MovimientoMixto,
  TipoIdse, ConfigIdse, CAUSAS_BAJA,
} from './imss-idse';

/** Lo que la pantalla envía por cada trabajador seleccionado. */
export interface EntradaMovimiento {
  empleadoId: string;
  fecha: string;             // AAAA-MM-DD (del <input type="date">)
  sbc?: number;              // corrige el SBC del expediente (ALTA / MODIFICACION)
  umf?: string;              // clínica / UMF (ALTA)
  claveTrabajador?: string;  // si no viene, se usa el número de empleado
  curp?: string;             // corrige el CURP del expediente
  causaBaja?: string;        // 1–9, A (BAJA) — ver CAUSAS_BAJA
}

interface FilaEmpleado {
  id: string;
  num_empleado: string | null;
  nombre: string;
  apellido_pat: string;
  apellido_mat: string | null;
  nombre_completo: string;
  nss: string | null;
  curp: string | null;
  sbc: number | string | null;
  salario_diario_integrado: number | string | null;
}

/**
 * Genera el TXT del IDSE para un tipo de movimiento y una lista de trabajadores.
 * Devuelve el contenido listo para descargar y el nombre sugerido del archivo.
 *
 * No genera un archivo a medias: si a algún trabajador le falta un dato que el
 * IMSS exige (NSS siempre; causa en las bajas), se enumeran TODOS los que fallan
 * y no se produce nada. Corregir de a uno lo que el instituto va a rechazar en
 * bloque es justo lo que este módulo existe para evitar.
 */
export async function generar(
  companyId: string,
  tipo: TipoIdse,
  entradas: EntradaMovimiento[],
  cfg: ConfigIdse,
): Promise<{ contenido: string; registros: number; nombre: string }> {
  if (!Array.isArray(entradas) || entradas.length === 0) {
    throw new ValidationError('Selecciona al menos un trabajador.');
  }

  const emp = await query<{ registro_patronal: string | null }>(
    'SELECT registro_patronal FROM companies WHERE id = $1',
    [companyId],
  );
  const registroPatronal = emp.rows[0]?.registro_patronal;
  if (!registroPatronal) {
    throw new ValidationError(
      'La empresa no tiene registro patronal ante el IMSS. Captúralo en ' +
      'Nómina → Parámetros antes de generar movimientos afiliatorios.',
    );
  }

  const ids = entradas.map((e) => e.empleadoId);
  const r = await query<FilaEmpleado>(
    `SELECT e.id, e.num_empleado, e.nombre, e.apellido_pat, e.apellido_mat,
            TRIM(e.nombre || ' ' || e.apellido_pat || ' ' || COALESCE(e.apellido_mat,'')) AS nombre_completo,
            e.nss, e.curp, e.sbc, e.salario_diario_integrado
       FROM nomina_empleados e
      WHERE e.company_id = $1 AND e.id::text = ANY($2::text[]) AND e.deleted_at IS NULL`,
    [companyId, ids],
  );
  const porId = new Map(r.rows.map((x) => [x.id, x]));

  const movimientos: MovimientoIdse[] = [];
  const problemas: string[] = [];

  for (const en of entradas) {
    const e = porId.get(en.empleadoId);
    if (!e) { problemas.push(`Un trabajador seleccionado ya no existe en esta empresa.`); continue; }

    const quien = e.nombre_completo || e.num_empleado || e.id;
    if (!en.fecha) problemas.push(`${quien}: falta la fecha del movimiento.`);
    if (!e.nss) problemas.push(`${quien}: sin NSS en el expediente (el IMSS lo exige).`);
    if (tipo === 'BAJA') {
      if (!en.causaBaja) problemas.push(`${quien}: falta la causa de baja.`);
      else if (!CAUSAS_BAJA[en.causaBaja]) problemas.push(`${quien}: causa de baja "${en.causaBaja}" desconocida.`);
    }

    const sbc =
      en.sbc != null && en.sbc !== ('' as any) ? Number(en.sbc)
      : Number(e.sbc ?? e.salario_diario_integrado ?? 0);
    if ((tipo === 'ALTA' || tipo === 'MODIFICACION') && !(sbc > 0)) {
      problemas.push(`${quien}: sin salario base de cotización (captúralo en el expediente o en el movimiento).`);
    }

    movimientos.push({
      registroPatronal,
      nss: e.nss || '',
      apellidoPaterno: e.apellido_pat,
      apellidoMaterno: e.apellido_mat || '',
      nombre: e.nombre,
      fecha: en.fecha,
      sbc,
      umf: en.umf,
      claveTrabajador: en.claveTrabajador || e.num_empleado || '',
      curp: en.curp || e.curp || '',
      causaBaja: en.causaBaja,
    });
  }

  if (problemas.length) {
    throw new ValidationError('No se generó el archivo. Corrige esto primero:\n• ' + problemas.join('\n• '));
  }

  const { contenido, registros } = generarArchivoIdse(tipo, movimientos, cfg);
  const hoy = new Date().toISOString().slice(0, 10);
  const nombre = `IDSE_${tipo}_${hoy}.txt`;
  return { contenido, registros, nombre };
}

/** Una entrada del constructor unificado: el movimiento con su tipo. */
export interface EntradaMixta extends EntradaMovimiento {
  tipo: TipoIdse;
}

/**
 * Genera UN archivo con movimientos de tipos MEZCLADOS que arma el usuario:
 * altas, bajas y modificaciones en el mismo lote. Es el corazón del constructor
 * unificado —un solo botón para todo—. Cada entrada trae su tipo y sus datos;
 * el NSS, el nombre y el CURP salen del expediente. No genera a medias.
 */
export async function generarMixto(
  companyId: string,
  entradas: EntradaMixta[],
  cfg: ConfigIdse,
): Promise<{ contenido: string; registros: number; nombre: string }> {
  if (!Array.isArray(entradas) || entradas.length === 0) {
    throw new ValidationError('Marca al menos un movimiento para el archivo.');
  }

  const emp = await query<{ registro_patronal: string | null }>(
    'SELECT registro_patronal FROM companies WHERE id = $1', [companyId],
  );
  const registroPatronal = emp.rows[0]?.registro_patronal;
  if (!registroPatronal) {
    throw new ValidationError(
      'La empresa no tiene registro patronal ante el IMSS. Captúralo en Nómina → Parámetros.',
    );
  }

  const ids = entradas.map((e) => e.empleadoId);
  const r = await query<FilaEmpleado>(
    `SELECT e.id, e.num_empleado, e.nombre, e.apellido_pat, e.apellido_mat,
            TRIM(e.nombre || ' ' || e.apellido_pat || ' ' || COALESCE(e.apellido_mat,'')) AS nombre_completo,
            e.nss, e.curp, e.sbc, e.salario_diario_integrado
       FROM nomina_empleados e
      WHERE e.company_id = $1 AND e.id::text = ANY($2::text[]) AND e.deleted_at IS NULL`,
    [companyId, ids],
  );
  const porId = new Map(r.rows.map((x) => [x.id, x]));

  const movimientos: MovimientoMixto[] = [];
  const problemas: string[] = [];

  for (const en of entradas) {
    const e = porId.get(en.empleadoId);
    if (!e) { problemas.push('Un trabajador seleccionado ya no existe en esta empresa.'); continue; }
    if (!['ALTA', 'BAJA', 'MODIFICACION'].includes(en.tipo)) {
      problemas.push(`${e.nombre_completo}: tipo de movimiento inválido.`); continue;
    }

    const quien = e.nombre_completo || e.num_empleado || e.id;
    if (!en.fecha) problemas.push(`${quien}: falta la fecha del movimiento.`);
    if (!e.nss) problemas.push(`${quien}: sin NSS en el expediente (el IMSS lo exige).`);
    if (en.tipo === 'BAJA') {
      if (!en.causaBaja) problemas.push(`${quien}: falta la causa de baja.`);
      else if (!CAUSAS_BAJA[en.causaBaja]) problemas.push(`${quien}: causa de baja "${en.causaBaja}" desconocida.`);
    }
    const sbc = en.sbc != null && en.sbc !== ('' as any) ? Number(en.sbc)
      : Number(e.sbc ?? e.salario_diario_integrado ?? 0);
    if ((en.tipo === 'ALTA' || en.tipo === 'MODIFICACION') && !(sbc > 0)) {
      problemas.push(`${quien}: sin salario base de cotización.`);
    }

    movimientos.push({
      tipo: en.tipo,
      registroPatronal,
      nss: e.nss || '',
      apellidoPaterno: e.apellido_pat,
      apellidoMaterno: e.apellido_mat || '',
      nombre: e.nombre,
      fecha: en.fecha,
      sbc,
      umf: en.umf,
      claveTrabajador: en.claveTrabajador || e.num_empleado || '',
      curp: en.curp || e.curp || '',
      causaBaja: en.causaBaja,
    });
  }

  if (problemas.length) {
    throw new ValidationError('No se generó el archivo. Corrige esto primero:\n• ' + problemas.join('\n• '));
  }

  const { contenido, registros } = generarArchivoMixto(movimientos, cfg);
  const nombre = `IDSE_movimientos_${new Date().toISOString().slice(0, 10)}.txt`;
  return { contenido, registros, nombre };
}

/* ───────────────────  Cola de pendientes (baja → menú IDSE)  ─────────────── */

/**
 * Encola un movimiento afiliatorio para el IDSE. Lo llama la baja del trabajador
 * —y en su momento el alta y la modificación de salario—, para que aparezca solo
 * en Nómina → IMSS · IDSE sin recapturar a nadie. Si ya estaba encolado el mismo
 * movimiento, no lo duplica.
 */
export async function encolarPendiente(
  companyId: string,
  m: { empleadoId: string; tipo: TipoIdse; fecha: string; causaBaja?: string; sbc?: number; origen?: string },
): Promise<void> {
  await query(
    `INSERT INTO nomina_idse_pendientes
       (company_id, empleado_id, tipo, fecha, causa_baja, sbc, origen)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (company_id, empleado_id, tipo, fecha) DO NOTHING`,
    [companyId, m.empleadoId, m.tipo, m.fecha, m.causaBaja || null, m.sbc ?? null, m.origen || 'manual'],
  );
}

export async function listarPendientes(companyId: string): Promise<any[]> {
  const r = await query<any>(
    `SELECT p.id, p.empleado_id, p.tipo, TO_CHAR(p.fecha, 'YYYY-MM-DD') AS fecha,
            p.causa_baja, p.sbc, p.origen, p.created_at,
            e.num_empleado, e.nss,
            TRIM(e.nombre || ' ' || e.apellido_pat || ' ' || COALESCE(e.apellido_mat,'')) AS nombre_completo
       FROM nomina_idse_pendientes p
       JOIN nomina_empleados e ON e.id = p.empleado_id
      WHERE p.company_id = $1 AND p.estado = 'PENDIENTE'
      ORDER BY p.created_at DESC`,
    [companyId],
  );
  return r.rows;
}

export async function descartarPendiente(companyId: string, id: string): Promise<void> {
  await query('DELETE FROM nomina_idse_pendientes WHERE id = $1 AND company_id = $2', [id, companyId]);
}

/** Los que ya se confirmaron en el IDSE (la segunda lista). */
export async function listarEnviados(companyId: string): Promise<any[]> {
  const r = await query<any>(
    `SELECT p.id, p.tipo, TO_CHAR(p.fecha, 'YYYY-MM-DD') AS fecha, TO_CHAR(p.generado_at, 'YYYY-MM-DD') AS enviado,
            e.num_empleado,
            TRIM(e.nombre || ' ' || e.apellido_pat || ' ' || COALESCE(e.apellido_mat,'')) AS nombre_completo
       FROM nomina_idse_pendientes p
       JOIN nomina_empleados e ON e.id = p.empleado_id
      WHERE p.company_id = $1 AND p.estado = 'ENVIADO'
      ORDER BY p.generado_at DESC NULLS LAST`,
    [companyId],
  );
  return r.rows;
}

/** Confirma que los movimientos ya pasaron en el IDSE: pasan a la lista de enviados. */
export async function marcarEnviados(companyId: string, ids: string[]): Promise<void> {
  if (!ids?.length) return;
  await query(
    `UPDATE nomina_idse_pendientes
        SET estado = 'ENVIADO', generado_at = NOW()
      WHERE company_id = $1 AND id::text = ANY($2::text[])`,
    [companyId, ids],
  );
}

/** Regresa movimientos enviados a la lista de pendientes (si se subieron por error). */
export async function regresarPendientes(companyId: string, ids: string[]): Promise<void> {
  if (!ids?.length) return;
  await query(
    `UPDATE nomina_idse_pendientes
        SET estado = 'PENDIENTE', generado_at = NULL
      WHERE company_id = $1 AND id::text = ANY($2::text[])`,
    [companyId, ids],
  );
}

/**
 * Arma UN archivo IDSE con los movimientos pendientes seleccionados —mezclando
 * altas, bajas y modificaciones—. Lee el registro patronal de la empresa y los
 * datos de cada trabajador; la fecha y la causa vienen del propio pendiente. No
 * cambia su estado: eso lo hace el usuario al confirmar que ya pasaron.
 */
export async function generarDesdePendientes(
  companyId: string, ids: string[], cfg: ConfigIdse,
): Promise<{ contenido: string; registros: number; nombre: string }> {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ValidationError('Selecciona al menos un movimiento.');
  }

  const emp = await query<{ registro_patronal: string | null }>(
    'SELECT registro_patronal FROM companies WHERE id = $1', [companyId],
  );
  const registroPatronal = emp.rows[0]?.registro_patronal;
  if (!registroPatronal) {
    throw new ValidationError(
      'La empresa no tiene registro patronal ante el IMSS. Captúralo en Nómina → Parámetros.',
    );
  }

  const r = await query<any>(
    `SELECT p.id, p.tipo, TO_CHAR(p.fecha, 'YYYY-MM-DD') AS fecha, p.causa_baja, p.sbc AS sbc_pend,
            e.nss, e.apellido_pat, e.apellido_mat, e.nombre, e.curp, e.num_empleado,
            e.sbc AS sbc_exp, e.salario_diario_integrado,
            TRIM(e.nombre || ' ' || e.apellido_pat || ' ' || COALESCE(e.apellido_mat,'')) AS nombre_completo
       FROM nomina_idse_pendientes p
       JOIN nomina_empleados e ON e.id = p.empleado_id
      WHERE p.company_id = $1 AND p.id::text = ANY($2::text[]) AND p.estado = 'PENDIENTE'`,
    [companyId, ids],
  );

  const movimientos: MovimientoMixto[] = [];
  const problemas: string[] = [];
  for (const p of r.rows) {
    const quien = p.nombre_completo || p.num_empleado || p.id;
    if (!p.nss) problemas.push(`${quien}: sin NSS en el expediente.`);
    if (p.tipo === 'BAJA' && !p.causa_baja) problemas.push(`${quien}: la baja no tiene causa (edítala en el movimiento).`);
    const sbc = p.sbc_pend != null ? Number(p.sbc_pend) : Number(p.sbc_exp ?? p.salario_diario_integrado ?? 0);
    if ((p.tipo === 'ALTA' || p.tipo === 'MODIFICACION') && !(sbc > 0)) {
      problemas.push(`${quien}: sin salario base de cotización.`);
    }
    movimientos.push({
      tipo: p.tipo as TipoIdse,
      registroPatronal,
      nss: p.nss || '',
      apellidoPaterno: p.apellido_pat,
      apellidoMaterno: p.apellido_mat || '',
      nombre: p.nombre,
      fecha: p.fecha,
      sbc,
      claveTrabajador: p.num_empleado || '',
      curp: p.curp || '',
      causaBaja: p.causa_baja || undefined,
    });
  }
  if (problemas.length) {
    throw new ValidationError('No se generó el archivo. Corrige esto primero:\n• ' + problemas.join('\n• '));
  }

  const { contenido, registros } = generarArchivoMixto(movimientos, cfg);
  const nombre = `IDSE_movimientos_${new Date().toISOString().slice(0, 10)}.txt`;
  return { contenido, registros, nombre };
}
