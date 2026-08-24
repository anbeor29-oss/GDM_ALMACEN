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
  generarArchivoIdse, MovimientoIdse, TipoIdse, ConfigIdse, CAUSAS_BAJA,
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
