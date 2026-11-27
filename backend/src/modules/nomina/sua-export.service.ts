/**
 * sua-export.service — puente entre la base de NEXO y el motor de archivos del
 * SUA. La pantalla manda IDs y los pocos datos del propio movimiento (fecha,
 * tipo, un salario que corrige al del expediente); todo lo demás —NSS, RFC,
 * CURP, nombre, salario base, crédito— se lee aquí del expediente, para que lo
 * que entra al SUA no dependa de lo que alcanzó a copiar la pantalla.
 *
 * NO GENERA ARCHIVOS A MEDIAS
 * Si a un trabajador le falta un dato que el SUA exige, se enumeran TODOS los
 * que fallan y no se produce nada. El SUA aborta la importación completa y deja
 * su error en ErrImp*.txt: corregir de a uno lo que va a rechazar en bloque es
 * justo lo que este módulo existe para evitar.
 *
 * PRIMERO LAS ALTAS
 * Son dos llamadas distintas a propósito. Un movimiento de alguien que el SUA
 * todavía no conoce se rechaza, así que no hay un botón que mande todo junto.
 *
 * Ref: docs/NEXO_A_SUA.md
 */

import { query } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import {
  generarAltas, generarMovimientos, generarCreditos,
  ArchivoSua, ConfigSua, TrabajadorSua, MovimientoSua, CreditoSua,
  TipoMovtoSua, TipoCreditoSua, TipoDescuentoNexo, TIPO_DESCUENTO_SUA, CREDITO_SUA,
} from './sua-export';

/* ─────────────────────────  Entradas de la pantalla  ──────────────────────── */

export interface EntradaAlta {
  empleadoId: string;
  /** Corrige la fecha de alta del expediente (reingreso, alta retroactiva). */
  fecha?: string;
  sbc?: number;
}

export interface EntradaMovimiento {
  empleadoId: string;
  tipo: TipoMovtoSua;
  fecha: string;
  sbc?: number;
}

export interface EntradaCredito {
  empleadoId: string;
  tipo: TipoCreditoSua;
  fecha: string;
  /** Corrigen lo que trae el expediente (una carta nueva del INFONAVIT). */
  numCredito?: string;
  tipoDescuento?: TipoDescuentoNexo;
  valorDescuento?: number;
}

interface FilaEmpleado {
  id: string;
  num_empleado: string | null;
  nombre: string;
  apellido_pat: string;
  apellido_mat: string | null;
  quien: string;
  rfc: string;
  curp: string;
  nss: string | null;
  codigo_postal: string | null;
  fecha_nacimiento: string | null;
  fecha_ingreso: string;
  fecha_baja: string | null;
  fecha_reingreso: string | null;
  sbc: string | null;
  salario_diario_integrado: string | null;
  tiene_infonavit: boolean;
  infonavit_num_credito: string | null;
  infonavit_tipo_descuento: TipoDescuentoNexo | null;
  infonavit_descuento: string | null;
  infonavit_desde: string | null;
}

const CAMPOS = `
  e.id, e.num_empleado, e.nombre, e.apellido_pat, e.apellido_mat,
  TRIM(e.nombre || ' ' || e.apellido_pat || ' ' || COALESCE(e.apellido_mat,'')) AS quien,
  e.rfc, e.curp, e.nss, e.codigo_postal,
  TO_CHAR(e.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
  TO_CHAR(e.fecha_ingreso,    'YYYY-MM-DD') AS fecha_ingreso,
  TO_CHAR(e.fecha_baja,       'YYYY-MM-DD') AS fecha_baja,
  TO_CHAR(e.fecha_reingreso,  'YYYY-MM-DD') AS fecha_reingreso,
  e.sbc, e.salario_diario_integrado,
  e.tiene_infonavit, e.infonavit_num_credito, e.infonavit_tipo_descuento,
  e.infonavit_descuento,
  TO_CHAR(e.infonavit_desde, 'YYYY-MM-DD') AS infonavit_desde
`;

/* ─────────────────────────  Datos de la empresa  ──────────────────────────── */

async function registroPatronal(companyId: string): Promise<string> {
  const r = await query<{ registro_patronal: string | null }>(
    'SELECT registro_patronal FROM companies WHERE id = $1', [companyId],
  );
  const rp = (r.rows[0]?.registro_patronal || '').trim();
  if (!rp) {
    throw new ValidationError(
      'La empresa no tiene registro patronal ante el IMSS. Captúralo en ' +
      'Nómina → Parámetros antes de generar archivos para el SUA.',
    );
  }
  return rp;
}

async function empleados(companyId: string, ids: string[]): Promise<Map<string, FilaEmpleado>> {
  const r = await query<FilaEmpleado>(
    `SELECT ${CAMPOS} FROM nomina_empleados e
      WHERE e.company_id = $1 AND e.id::text = ANY($2::text[]) AND e.deleted_at IS NULL`,
    [companyId, ids],
  );
  return new Map(r.rows.map((x) => [x.id, x]));
}

const num = (v: unknown) => Number(v ?? 0) || 0;

/** El salario que va al SUA: el del movimiento, si no el SBC, si no el SDI. */
const salario = (e: FilaEmpleado, dado?: number) =>
  dado != null && String(dado) !== '' ? num(dado) : num(e.sbc ?? e.salario_diario_integrado);

/** Revisa lo que el SUA exige de cualquier renglón, sea del archivo que sea. */
function revisarBase(e: FilaEmpleado, problemas: string[]): void {
  if (!e.nss) problemas.push(`${e.quien}: sin NSS en el expediente (el SUA lo exige).`);
  else if (!/^\d{11}$/.test(e.nss)) problemas.push(`${e.quien}: el NSS "${e.nss}" no tiene 11 dígitos.`);
}

/* ─────────────────────────  Paso 1 · Altas  ───────────────────────────────── */

/**
 * Aseg.txt + Afil.txt. Es el primer paso: hasta que el trabajador existe en el
 * SUA, sus movimientos se rechazan.
 *
 * La fecha de alta es la de reingreso cuando hay una, porque es la que el IMSS
 * tiene como vigente; la de ingreso original ya no describe la relación actual.
 */
export async function altas(
  companyId: string, entradas: EntradaAlta[], cfg: ConfigSua = {}, conAfiliatorios = true,
): Promise<{ archivos: ArchivoSua[]; avisos: string[] }> {
  if (!Array.isArray(entradas) || entradas.length === 0) {
    throw new ValidationError('Selecciona al menos un trabajador.');
  }
  const rp = await registroPatronal(companyId);
  const porId = await empleados(companyId, entradas.map((e) => e.empleadoId));

  const trabajadores: TrabajadorSua[] = [];
  const problemas: string[] = [];
  const avisos: string[] = [];

  for (const en of entradas) {
    const e = porId.get(en.empleadoId);
    if (!e) { problemas.push('Un trabajador seleccionado ya no existe en esta empresa.'); continue; }
    revisarBase(e, problemas);

    const fechaAlta = en.fecha || e.fecha_reingreso || e.fecha_ingreso;
    if (!fechaAlta) problemas.push(`${e.quien}: sin fecha de alta.`);

    const sbc = salario(e, en.sbc);
    if (!(sbc > 0)) {
      problemas.push(`${e.quien}: sin salario base de cotización (captúralo en el expediente).`);
    }
    if (!e.curp) problemas.push(`${e.quien}: sin CURP (de ahí salen el sexo y la entidad de nacimiento).`);
    if (!e.fecha_nacimiento && conAfiliatorios) {
      avisos.push(`${e.quien}: sin fecha de nacimiento, el dato afiliatorio va en ceros.`);
    }
    if (!e.codigo_postal && conAfiliatorios) {
      avisos.push(`${e.quien}: sin código postal, el dato afiliatorio va en ceros.`);
    }

    const conCredito = Boolean(e.tiene_infonavit && e.infonavit_num_credito && e.infonavit_tipo_descuento);
    if (conCredito && e.infonavit_tipo_descuento === 'porcentaje') {
      avisos.push(
        `${e.quien}: crédito por porcentaje. La escala de ese tipo no está verificada ` +
        'contra el SUA; coteja el valor después de importar.',
      );
    }

    trabajadores.push({
      registroPatronal: rp,
      nss: e.nss || '',
      rfc: e.rfc,
      curp: e.curp,
      apellidoPaterno: e.apellido_pat,
      apellidoMaterno: e.apellido_mat || '',
      nombre: e.nombre,
      fechaAlta: fechaAlta || e.fecha_ingreso,
      sbc,
      codigoPostal: e.codigo_postal || '',
      fechaNacimiento: e.fecha_nacimiento,
      numCredito: conCredito ? e.infonavit_num_credito : null,
      tipoDescuento: conCredito ? e.infonavit_tipo_descuento : null,
      valorDescuento: conCredito ? num(e.infonavit_descuento) : null,
      fechaDescuento: conCredito ? (e.infonavit_desde || fechaAlta) : null,
    });
  }

  if (problemas.length) {
    throw new ValidationError('No se generó nada. Corrige esto primero:\n• ' + problemas.join('\n• '));
  }
  return { archivos: generarAltas(trabajadores, cfg, conAfiliatorios), avisos };
}

/* ─────────────────────────  Paso 2 · Movimientos  ─────────────────────────── */

/** Movt.txt: bajas, modificaciones de salario y reingresos. */
export async function movimientos(
  companyId: string, entradas: EntradaMovimiento[], cfg: ConfigSua = {},
): Promise<{ archivo: ArchivoSua; avisos: string[] }> {
  if (!Array.isArray(entradas) || entradas.length === 0) {
    throw new ValidationError('Selecciona al menos un movimiento.');
  }
  const rp = await registroPatronal(companyId);
  const porId = await empleados(companyId, entradas.map((e) => e.empleadoId));

  const movtos: MovimientoSua[] = [];
  const problemas: string[] = [];
  const avisos: string[] = [];

  for (const en of entradas) {
    const e = porId.get(en.empleadoId);
    if (!e) { problemas.push('Un trabajador seleccionado ya no existe en esta empresa.'); continue; }
    revisarBase(e, problemas);

    if (!['BAJA', 'MODIFICACION', 'REINGRESO'].includes(en.tipo)) {
      problemas.push(`${e.quien}: tipo de movimiento "${en.tipo}" inválido para el SUA.`);
      continue;
    }
    /* La fecha del movimiento: si no viene, la que el expediente ya tiene. */
    const fecha = en.fecha
      || (en.tipo === 'BAJA' ? e.fecha_baja : en.tipo === 'REINGRESO' ? e.fecha_reingreso : null);
    if (!fecha) problemas.push(`${e.quien}: falta la fecha del movimiento.`);

    const sbc = en.tipo === 'BAJA' ? 0 : salario(e, en.sbc);
    if (en.tipo !== 'BAJA' && !(sbc > 0)) {
      problemas.push(`${e.quien}: sin salario base de cotización para el movimiento.`);
    }
    if (en.tipo === 'BAJA' && e.fecha_baja && en.fecha && e.fecha_baja !== en.fecha) {
      avisos.push(`${e.quien}: la baja va con ${en.fecha} y el expediente dice ${e.fecha_baja}.`);
    }

    movtos.push({ registroPatronal: rp, nss: e.nss || '', tipo: en.tipo, fecha: fecha || '', sbc });
  }

  if (problemas.length) {
    throw new ValidationError('No se generó nada. Corrige esto primero:\n• ' + problemas.join('\n• '));
  }
  return { archivo: generarMovimientos(movtos, cfg), avisos };
}

/* ─────────────────────────  Paso 2 · Créditos  ────────────────────────────── */

/**
 * Cred.txt: inicio, suspensión, reinicio y modificación del valor del descuento.
 *
 * El expediente guarda el ESTADO del crédito, no su historia, así que el tipo de
 * movimiento lo dice la pantalla; los datos (número, tipo y valor del descuento)
 * salen del expediente salvo que la entrada los corrija, que es lo que pasa
 * cuando llega una carta nueva del INFONAVIT.
 */
export async function creditos(
  companyId: string, entradas: EntradaCredito[], cfg: ConfigSua = {},
): Promise<{ archivo: ArchivoSua; avisos: string[] }> {
  if (!Array.isArray(entradas) || entradas.length === 0) {
    throw new ValidationError('Selecciona al menos un crédito.');
  }
  const rp = await registroPatronal(companyId);
  const porId = await empleados(companyId, entradas.map((e) => e.empleadoId));

  const movtos: CreditoSua[] = [];
  const problemas: string[] = [];
  const avisos: string[] = [];

  for (const en of entradas) {
    const e = porId.get(en.empleadoId);
    if (!e) { problemas.push('Un trabajador seleccionado ya no existe en esta empresa.'); continue; }
    revisarBase(e, problemas);

    if (!Object.prototype.hasOwnProperty.call(CREDITO_SUA, en.tipo)) {
      problemas.push(`${e.quien}: tipo de movimiento de crédito "${en.tipo}" inválido.`);
      continue;
    }
    const numCredito = (en.numCredito || e.infonavit_num_credito || '').replace(/\D/g, '');
    if (!numCredito) problemas.push(`${e.quien}: sin número de crédito INFONAVIT.`);
    else if (numCredito.length > 10) problemas.push(`${e.quien}: el número de crédito trae más de 10 dígitos.`);

    const tipoDescuento = (en.tipoDescuento || e.infonavit_tipo_descuento) as TipoDescuentoNexo | null;
    if (!tipoDescuento || !Object.prototype.hasOwnProperty.call(TIPO_DESCUENTO_SUA, tipoDescuento)) {
      problemas.push(`${e.quien}: sin tipo de descuento del crédito (porcentaje, cuota fija o VSM).`);
    } else if (tipoDescuento === 'porcentaje') {
      avisos.push(
        `${e.quien}: crédito por porcentaje. La escala de ese tipo no está verificada ` +
        'contra el SUA; coteja el valor después de importar.',
      );
    }

    const valor = en.valorDescuento != null && String(en.valorDescuento) !== ''
      ? num(en.valorDescuento) : num(e.infonavit_descuento);
    if (!(valor > 0)) problemas.push(`${e.quien}: el valor del descuento es 0.`);

    const fecha = en.fecha || (en.tipo === 'INICIO' ? e.infonavit_desde : null);
    if (!fecha) problemas.push(`${e.quien}: falta la fecha del movimiento de crédito.`);

    movtos.push({
      registroPatronal: rp,
      nss: e.nss || '',
      numCredito,
      tipo: en.tipo,
      fecha: fecha || '',
      tipoDescuento: (tipoDescuento || 'cuota_fija') as TipoDescuentoNexo,
      valorDescuento: valor,
    });
  }

  if (problemas.length) {
    throw new ValidationError('No se generó nada. Corrige esto primero:\n• ' + problemas.join('\n• '));
  }
  return { archivo: generarCreditos(movtos, cfg), avisos };
}

/* ─────────────────────────  Qué hay para mandar  ─────────────────────────── */

export interface Candidato {
  empleado_id: string;
  num_empleado: string | null;
  quien: string;
  nss: string | null;
  sbc: number;
  fecha: string | null;
  motivo: 'ALTA' | 'BAJA' | 'REINGRESO' | 'CREDITO';
  listo: boolean;
  falta: string | null;
}

/**
 * Lo que hay para mandar en un rango de fechas, para que la pantalla no empiece
 * en blanco: altas por fecha de ingreso, bajas por fecha de baja, reingresos y
 * los créditos vigentes. No decide nada —no hay bitácora de lo ya enviado—, sólo
 * propone; quien captura marca lo que va.
 */
export async function candidatos(
  companyId: string, desde: string, hasta: string,
): Promise<Candidato[]> {
  const r = await query<FilaEmpleado>(
    `SELECT ${CAMPOS} FROM nomina_empleados e
      WHERE e.company_id = $1 AND e.deleted_at IS NULL
        AND (  (e.fecha_ingreso   BETWEEN $2::date AND $3::date)
            OR (e.fecha_baja      BETWEEN $2::date AND $3::date)
            OR (e.fecha_reingreso BETWEEN $2::date AND $3::date)
            OR (e.tiene_infonavit AND e.fecha_baja IS NULL) )
      ORDER BY e.apellido_pat, e.apellido_mat, e.nombre`,
    [companyId, desde, hasta],
  );

  const dentro = (f: string | null) => Boolean(f && f >= desde && f <= hasta);
  const salida: Candidato[] = [];

  for (const e of r.rows) {
    const sbc = num(e.sbc ?? e.salario_diario_integrado);
    const base = {
      empleado_id: e.id, num_empleado: e.num_empleado, quien: e.quien, nss: e.nss, sbc,
    };
    const falta = !e.nss ? 'sin NSS' : !/^\d{11}$/.test(e.nss) ? 'NSS inválido' : null;

    if (dentro(e.fecha_ingreso)) {
      salida.push({ ...base, fecha: e.fecha_ingreso, motivo: 'ALTA', listo: !falta && sbc > 0,
        falta: falta || (sbc > 0 ? null : 'sin salario') });
    }
    if (dentro(e.fecha_reingreso)) {
      salida.push({ ...base, fecha: e.fecha_reingreso, motivo: 'REINGRESO', listo: !falta && sbc > 0,
        falta: falta || (sbc > 0 ? null : 'sin salario') });
    }
    if (dentro(e.fecha_baja)) {
      salida.push({ ...base, fecha: e.fecha_baja, motivo: 'BAJA', listo: !falta, falta });
    }
    if (e.tiene_infonavit && !e.fecha_baja) {
      const sinCredito = !e.infonavit_num_credito ? 'sin número de crédito'
        : !e.infonavit_tipo_descuento ? 'sin tipo de descuento'
        : num(e.infonavit_descuento) > 0 ? null : 'valor del descuento en 0';
      salida.push({
        ...base, fecha: e.infonavit_desde, motivo: 'CREDITO',
        listo: !falta && !sinCredito, falta: falta || sinCredito,
      });
    }
  }
  return salida;
}
