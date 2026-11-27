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

import { query, transaction } from '../../config/database';
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

/* ─────────────────────────  Bitácora de lotes  ────────────────────────────── */

export type PasoSua = 'ALTAS' | 'MOVIMIENTOS' | 'CREDITOS';
export type TipoRenglon =
  | 'ALTA' | 'BAJA' | 'MODIFICACION' | 'REINGRESO'
  | 'CREDITO_INICIO' | 'CREDITO_SUSPENSION' | 'CREDITO_REINICIO' | 'CREDITO_VALOR';

/** La foto de un renglón tal como se mandó. */
interface RenglonLote {
  empleadoId: string;
  nombreCompleto: string;
  nss: string;
  numEmpleado: string;
  tipo: TipoRenglon;
  fecha: string;
  importe: number;
  numCredito?: string | null;
}

/**
 * Apunta el lote. Se llama DESPUÉS de que el motor armó los archivos sin
 * reventar: un lote apuntado de algo que no se generó sería una mentira, y esta
 * bitácora existe justamente para creerle.
 *
 * Si el apunte falla, el archivo ya está hecho y se entrega igual —perder el
 * registro es malo, no entregar el archivo es peor—; el servicio lo dice en los
 * avisos para que nadie crea que quedó anotado.
 */
async function apuntarLote(
  companyId: string, paso: PasoSua, archivos: string[], registroPatronalEmpresa: string,
  renglones: RenglonLote[], userId?: string,
): Promise<string> {
  return transaction(async (client) => {
    const l = await client.query<{ id: string }>(
      `INSERT INTO nomina_sua_lotes
         (company_id, paso, archivos, num_renglones, registro_patronal, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [companyId, paso, archivos.join(', ').slice(0, 120), renglones.length,
       registroPatronalEmpresa || null, userId || null],
    );
    const loteId = l.rows[0].id;
    let orden = 1;
    for (const r of renglones) {
      await client.query(
        `INSERT INTO nomina_sua_lote_renglones
           (lote_id, empleado_id, nombre_completo, nss, num_empleado, tipo, fecha, importe, num_credito, orden)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [loteId, r.empleadoId || null, (r.nombreCompleto || '').slice(0, 250), r.nss || null,
         (r.numEmpleado || '').slice(0, 30), r.tipo, r.fecha, r.importe || null,
         r.numCredito || null, orden++],
      );
    }
    return loteId;
  });
}

/**
 * Apunta el lote sin tumbar la entrega. Devuelve el id, o null si el apunte
 * falló —y entonces lo dice en los avisos, porque un archivo que se mandó al SUA
 * sin quedar en la bitácora es exactamente lo que esta tabla vino a evitar.
 */
async function anotar(
  companyId: string, paso: PasoSua, archivos: string[], registroPatronalEmpresa: string,
  renglones: RenglonLote[], avisos: string[], userId?: string,
): Promise<string | null> {
  try {
    return await apuntarLote(companyId, paso, archivos, registroPatronalEmpresa, renglones, userId);
  } catch {
    avisos.push(
      'El archivo se generó pero NO quedó anotado en la bitácora del SUA. ' +
      'Apunta a mano qué mandaste: el sistema no podrá avisarte si se repite.',
    );
    return null;
  }
}

/** AAAA-MM-DD → DD/MM/AAAA, que es como se lee en pantalla. */
const aMx = (f: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/** El grupo con el que se compara contra los candidatos. */
const GRUPO_SQL = `CASE WHEN r.tipo LIKE 'CREDITO%' THEN 'CREDITO' ELSE r.tipo END`;

interface EnvioPrevio {
  empleado_id: string;
  grupo: string;
  fechas: string[];
  ultimo_tipo: string;
  ultima_fecha: string;
  ultimo_envio: string;
}

/**
 * Lo que ya se le mandó al SUA de estos trabajadores. Se excluyen los lotes que
 * el SUA RECHAZÓ: un renglón que no entró no está enviado, por más que se haya
 * generado el archivo.
 */
async function enviosPrevios(companyId: string, empleadoIds: string[]): Promise<Map<string, EnvioPrevio>> {
  if (!empleadoIds.length) return new Map();
  const r = await query<EnvioPrevio>(
    `SELECT r.empleado_id::text AS empleado_id,
            ${GRUPO_SQL} AS grupo,
            ARRAY_AGG(DISTINCT TO_CHAR(r.fecha,'YYYY-MM-DD')) AS fechas,
            (ARRAY_AGG(r.tipo ORDER BY l.created_at DESC, r.orden DESC))[1] AS ultimo_tipo,
            (ARRAY_AGG(TO_CHAR(r.fecha,'YYYY-MM-DD') ORDER BY l.created_at DESC, r.orden DESC))[1] AS ultima_fecha,
            TO_CHAR(MAX(l.created_at), 'YYYY-MM-DD') AS ultimo_envio
       FROM nomina_sua_lote_renglones r
       JOIN nomina_sua_lotes l ON l.id = r.lote_id
      WHERE l.company_id = $1
        AND l.resultado <> 'CON_ERRORES'
        AND r.empleado_id::text = ANY($2::text[])
      GROUP BY r.empleado_id, ${GRUPO_SQL}`,
    [companyId, empleadoIds],
  );
  return new Map(r.rows.map((x) => [`${x.empleado_id}|${x.grupo}`, x]));
}

/** ¿Esta empresa ya anotó alguna alta aquí? Dice si la bitácora está en uso. */
async function hayAltasAnotadas(companyId: string): Promise<boolean> {
  const r = await query<{ hay: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM nomina_sua_lote_renglones r
         JOIN nomina_sua_lotes l ON l.id = r.lote_id
        WHERE l.company_id = $1 AND r.tipo = 'ALTA' AND l.resultado <> 'CON_ERRORES'
     ) AS hay`,
    [companyId],
  );
  return Boolean(r.rows[0]?.hay);
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
  userId?: string,
): Promise<{ archivos: ArchivoSua[]; avisos: string[]; loteId: string | null }> {
  if (!Array.isArray(entradas) || entradas.length === 0) {
    throw new ValidationError('Selecciona al menos un trabajador.');
  }
  const rp = await registroPatronal(companyId);
  const porId = await empleados(companyId, entradas.map((e) => e.empleadoId));

  const trabajadores: TrabajadorSua[] = [];
  const renglones: RenglonLote[] = [];
  const problemas: string[] = [];
  const avisos: string[] = [];

  /* Quién ya está dado de alta en el SUA. No es un error repetirla —puede haber
   * quedado a medias—, pero sí algo que quien captura tiene que saber antes. */
  const previos = await enviosPrevios(companyId, entradas.map((e) => e.empleadoId));

  for (const en of entradas) {
    const e = porId.get(en.empleadoId);
    if (!e) { problemas.push('Un trabajador seleccionado ya no existe en esta empresa.'); continue; }
    revisarBase(e, problemas);

    const yaEnviada = previos.get(`${en.empleadoId}|ALTA`);
    if (yaEnviada) {
      avisos.push(
        `${e.quien}: ya se le mandó el alta al SUA el ${aMx(yaEnviada.ultimo_envio)}. ` +
        'Si vuelve a ir, el SUA la rechazará con «Ya existe».',
      );
    }

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
    renglones.push({
      empleadoId: e.id, nombreCompleto: e.quien, nss: e.nss || '',
      numEmpleado: e.num_empleado || '', tipo: 'ALTA',
      fecha: fechaAlta || e.fecha_ingreso, importe: sbc,
      numCredito: conCredito ? e.infonavit_num_credito : null,
    });
  }

  if (problemas.length) {
    throw new ValidationError('No se generó nada. Corrige esto primero:\n• ' + problemas.join('\n• '));
  }
  const archivos = generarAltas(trabajadores, cfg, conAfiliatorios);
  const loteId = await anotar(
    companyId, 'ALTAS', archivos.map((a) => a.nombre), rp, renglones, avisos, userId,
  );
  return { archivos, avisos, loteId };
}

/* ─────────────────────────  Paso 2 · Movimientos  ─────────────────────────── */

/** Movt.txt: bajas, modificaciones de salario y reingresos. */
export async function movimientos(
  companyId: string, entradas: EntradaMovimiento[], cfg: ConfigSua = {}, userId?: string,
): Promise<{ archivo: ArchivoSua; avisos: string[]; loteId: string | null }> {
  if (!Array.isArray(entradas) || entradas.length === 0) {
    throw new ValidationError('Selecciona al menos un movimiento.');
  }
  const rp = await registroPatronal(companyId);
  const porId = await empleados(companyId, entradas.map((e) => e.empleadoId));

  const movtos: MovimientoSua[] = [];
  const renglones: RenglonLote[] = [];
  const problemas: string[] = [];
  const avisos: string[] = [];
  const previos = await enviosPrevios(companyId, entradas.map((e) => e.empleadoId));
  /* El padrón del SUA casi siempre viene de antes que esta bitácora, así que la
   * ausencia de un alta sólo significa algo si la bitácora ya se está usando. */
  const bitacoraConAltas = await hayAltasAnotadas(companyId);

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
      avisos.push(`${e.quien}: la baja va con ${aMx(en.fecha)} y el expediente dice ${aMx(e.fecha_baja)}.`);
    }

    /* El mismo movimiento con la misma fecha ya mandado: eso sí es repetirlo. */
    const previo = previos.get(`${en.empleadoId}|${en.tipo}`);
    if (previo && fecha && previo.fechas.includes(fecha)) {
      avisos.push(
        `${e.quien}: este movimiento (${en.tipo} del ${aMx(fecha)}) ya se mandó el ` +
        `${aMx(previo.ultimo_envio)}.`,
      );
    }
    if (bitacoraConAltas && !previos.get(`${en.empleadoId}|ALTA`)) {
      avisos.push(
        `${e.quien}: no hay constancia de que su alta se haya mandado al SUA. ` +
        'Si el SUA no lo conoce, va a rechazar el movimiento.',
      );
    }

    movtos.push({ registroPatronal: rp, nss: e.nss || '', tipo: en.tipo, fecha: fecha || '', sbc });
    renglones.push({
      empleadoId: e.id, nombreCompleto: e.quien, nss: e.nss || '',
      numEmpleado: e.num_empleado || '', tipo: en.tipo, fecha: fecha || '', importe: sbc,
    });
  }

  if (problemas.length) {
    throw new ValidationError('No se generó nada. Corrige esto primero:\n• ' + problemas.join('\n• '));
  }
  const archivo = generarMovimientos(movtos, cfg);
  const loteId = await anotar(companyId, 'MOVIMIENTOS', [archivo.nombre], rp, renglones, avisos, userId);
  return { archivo, avisos, loteId };
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
  companyId: string, entradas: EntradaCredito[], cfg: ConfigSua = {}, userId?: string,
): Promise<{ archivo: ArchivoSua; avisos: string[]; loteId: string | null }> {
  if (!Array.isArray(entradas) || entradas.length === 0) {
    throw new ValidationError('Selecciona al menos un crédito.');
  }
  const rp = await registroPatronal(companyId);
  const porId = await empleados(companyId, entradas.map((e) => e.empleadoId));

  const movtos: CreditoSua[] = [];
  const renglones: RenglonLote[] = [];
  const problemas: string[] = [];
  const avisos: string[] = [];
  const previos = await enviosPrevios(companyId, entradas.map((e) => e.empleadoId));

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

    /* Un movimiento de crédito repetido con la misma fecha el SUA lo rechaza con
     * «Ya existe un Movimiento de Crédito en esta fecha o posterior». */
    const previo = previos.get(`${en.empleadoId}|CREDITO`);
    if (previo && fecha && previo.fechas.includes(fecha)) {
      avisos.push(
        `${e.quien}: ya se mandó un movimiento de crédito con fecha ${aMx(fecha)} ` +
        `(${previo.ultimo_tipo.replace('CREDITO_', '')}, el ${aMx(previo.ultimo_envio)}).`,
      );
    } else if (previo && fecha && previo.ultima_fecha > fecha) {
      avisos.push(
        `${e.quien}: el último movimiento de crédito que se mandó es del ` +
        `${aMx(previo.ultima_fecha)}, posterior a ${aMx(fecha)}. El SUA no acepta uno anterior.`,
      );
    }

    movtos.push({
      registroPatronal: rp,
      nss: e.nss || '',
      numCredito,
      tipo: en.tipo,
      fecha: fecha || '',
      tipoDescuento: (tipoDescuento || 'cuota_fija') as TipoDescuentoNexo,
      valorDescuento: valor,
    });
    renglones.push({
      empleadoId: e.id, nombreCompleto: e.quien, nss: e.nss || '',
      numEmpleado: e.num_empleado || '',
      tipo: `CREDITO_${en.tipo === 'MODIFICACION_VALOR' ? 'VALOR' : en.tipo}` as TipoRenglon,
      fecha: fecha || '', importe: valor, numCredito,
    });
  }

  if (problemas.length) {
    throw new ValidationError('No se generó nada. Corrige esto primero:\n• ' + problemas.join('\n• '));
  }
  const archivo = generarCreditos(movtos, cfg);
  const loteId = await anotar(companyId, 'CREDITOS', [archivo.nombre], rp, renglones, avisos, userId);
  return { archivo, avisos, loteId };
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
  /* Del crédito, para que la pantalla muestre lo que se va a mandar. */
  num_credito: string | null;
  tipo_descuento: string | null;
  descuento: number | null;
  /** Ya se mandó al SUA esto mismo (según la bitácora). */
  enviado: boolean;
  /** Cuándo se mandó, y qué, para que se vea de dónde sale el enviado. */
  enviado_en: string | null;
  enviado_detalle: string | null;
}

/**
 * Lo que hay para mandar en un rango de fechas, para que la pantalla no empiece
 * en blanco: altas por fecha de ingreso, bajas por fecha de baja, reingresos y
 * los créditos vigentes, cada uno marcado con lo que ya se mandó según la
 * bitácora. Propone, no decide: quien captura marca lo que va.
 *
 * El alta se considera enviada sin ver la fecha —se manda una vez y la fecha
 * pudo corregirse al generarla—; lo demás se compara CON fecha, porque una baja
 * o un movimiento de crédito se repiten a lo largo de los años y lo que el SUA
 * rechaza es el mismo movimiento en la misma fecha.
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

  const previos = await enviosPrevios(companyId, r.rows.map((e) => e.id));
  const dentro = (f: string | null) => Boolean(f && f >= desde && f <= hasta);
  const salida: Candidato[] = [];

  /* Lo que la bitácora sabe de este trabajador para este motivo. */
  const envio = (empleadoId: string, motivo: Candidato['motivo'], fecha: string | null) => {
    const p = previos.get(`${empleadoId}|${motivo}`);
    if (!p) return { enviado: false, enviado_en: null, enviado_detalle: null };
    const mismo = motivo === 'ALTA' || (fecha ? p.fechas.includes(fecha) : false);
    return {
      enviado: mismo,
      enviado_en: p.ultimo_envio,
      enviado_detalle: `${p.ultimo_tipo.replace('CREDITO_', '')} del ${aMx(p.ultima_fecha)}`,
    };
  };

  for (const e of r.rows) {
    const sbc = num(e.sbc ?? e.salario_diario_integrado);
    const base = {
      empleado_id: e.id, num_empleado: e.num_empleado, quien: e.quien, nss: e.nss, sbc,
      num_credito: e.infonavit_num_credito,
      tipo_descuento: e.infonavit_tipo_descuento,
      descuento: e.infonavit_descuento != null ? num(e.infonavit_descuento) : null,
    };
    const falta = !e.nss ? 'sin NSS' : !/^\d{11}$/.test(e.nss) ? 'NSS inválido' : null;

    if (dentro(e.fecha_ingreso)) {
      salida.push({ ...base, fecha: e.fecha_ingreso, motivo: 'ALTA', listo: !falta && sbc > 0,
        falta: falta || (sbc > 0 ? null : 'sin salario'), ...envio(e.id, 'ALTA', e.fecha_ingreso) });
    }
    if (dentro(e.fecha_reingreso)) {
      salida.push({ ...base, fecha: e.fecha_reingreso, motivo: 'REINGRESO', listo: !falta && sbc > 0,
        falta: falta || (sbc > 0 ? null : 'sin salario'), ...envio(e.id, 'REINGRESO', e.fecha_reingreso) });
    }
    if (dentro(e.fecha_baja)) {
      salida.push({ ...base, fecha: e.fecha_baja, motivo: 'BAJA', listo: !falta, falta,
        ...envio(e.id, 'BAJA', e.fecha_baja) });
    }
    if (e.tiene_infonavit && !e.fecha_baja) {
      const sinCredito = !e.infonavit_num_credito ? 'sin número de crédito'
        : !e.infonavit_tipo_descuento ? 'sin tipo de descuento'
        : num(e.infonavit_descuento) > 0 ? null : 'valor del descuento en 0';
      salida.push({
        ...base, fecha: e.infonavit_desde, motivo: 'CREDITO',
        listo: !falta && !sinCredito, falta: falta || sinCredito,
        ...envio(e.id, 'CREDITO', e.infonavit_desde),
      });
    }
  }
  return salida;
}

/* ─────────────────────────  De un golpe  ─────────────────────────────────── */

export interface ResultadoAutomatico {
  archivos: ArchivoSua[];
  avisos: string[];
  lotes: string[];
  resumen: { altas: number; movimientos: number; creditos: number };
  omitidos: string[];
}

/**
 * Todo lo pendiente del rango, sin ir marcando renglón por renglón: toma lo que
 * NEXO ya sabe y arma los archivos en el orden que el SUA necesita —primero las
 * altas, luego los movimientos y los créditos—.
 *
 * QUÉ ENTRA
 * Sólo lo que está completo y no se ha mandado. Lo que le falta un dato se
 * OMITE y se dice quién y qué le falta, en vez de tumbar la corrida entera: en
 * el modo a mano tiene sentido frenar —alguien marcó eso a propósito—, pero
 * aquí nadie eligió al que viene sin NSS y detener por él dejaría sin mandar a
 * los otros treinta que sí están bien.
 *
 * Si las altas truenan sí se detiene todo: mandar los movimientos de gente que
 * el SUA no conoce es garantizar su rechazo.
 */
export async function automatico(
  companyId: string, desde: string, hasta: string,
  cfg: ConfigSua = {}, userId?: string, conAfiliatorios = true,
): Promise<ResultadoAutomatico> {
  const lista = await candidatos(companyId, desde, hasta);

  const omitidos: string[] = [];
  for (const c of lista) {
    if (!c.listo) omitidos.push(`${c.quien} — ${c.motivo.toLowerCase()}: ${c.falta}.`);
    else if (c.motivo === 'CREDITO' && !c.fecha) {
      omitidos.push(
        `${c.quien} — crédito: sin fecha de inicio del descuento en el expediente ` +
        '(captúrala o mándalo a mano).',
      );
    }
  }
  const pendiente = (motivos: string[]) =>
    lista.filter((c) => motivos.includes(c.motivo) && c.listo && !c.enviado
      && (c.motivo !== 'CREDITO' || Boolean(c.fecha)));

  const porMandar = {
    altas: pendiente(['ALTA']),
    movimientos: pendiente(['BAJA', 'REINGRESO']),
    creditos: pendiente(['CREDITO']),
  };
  const total = porMandar.altas.length + porMandar.movimientos.length + porMandar.creditos.length;
  if (total === 0) {
    throw new ValidationError(
      omitidos.length
        ? 'No hay nada completo que mandar en ese rango. Esto es lo que quedó fuera:\n• ' +
          omitidos.join('\n• ')
        : 'No hay nada pendiente que mandar en ese rango: o ya se mandó todo, o no hubo movimientos.',
    );
  }

  const archivos: ArchivoSua[] = [];
  const avisos: string[] = [];
  const lotes: string[] = [];

  if (porMandar.altas.length) {
    const r = await altas(
      companyId,
      porMandar.altas.map((c) => ({ empleadoId: c.empleado_id, fecha: c.fecha || undefined })),
      cfg, conAfiliatorios, userId,
    );
    archivos.push(...r.archivos);
    avisos.push(...r.avisos);
    if (r.loteId) lotes.push(r.loteId);
  }

  if (porMandar.movimientos.length) {
    const r = await movimientos(
      companyId,
      porMandar.movimientos.map((c) => ({
        empleadoId: c.empleado_id, tipo: c.motivo as TipoMovtoSua, fecha: c.fecha || '',
      })),
      cfg, userId,
    );
    archivos.push(r.archivo);
    avisos.push(...r.avisos);
    if (r.loteId) lotes.push(r.loteId);
  }

  if (porMandar.creditos.length) {
    /* El crédito que nunca se ha mandado empieza por su inicio de descuento: es
     * el único movimiento que el SUA acepta primero. Suspensiones, reinicios y
     * cambios de valor se eligen a mano, porque sólo quien tiene la carta del
     * INFONAVIT sabe cuál es. */
    const r = await creditos(
      companyId,
      porMandar.creditos.map((c) => ({
        empleadoId: c.empleado_id, tipo: 'INICIO' as TipoCreditoSua, fecha: c.fecha || '',
      })),
      cfg, userId,
    );
    archivos.push(r.archivo);
    avisos.push(...r.avisos);
    if (r.loteId) lotes.push(r.loteId);
  }

  if (omitidos.length) {
    avisos.push(
      `Se omitieron ${omitidos.length} renglón(es) por datos faltantes; abajo dice cuáles.`,
    );
  }

  return {
    archivos, avisos, lotes, omitidos,
    resumen: {
      altas: porMandar.altas.length,
      movimientos: porMandar.movimientos.length,
      creditos: porMandar.creditos.length,
    },
  };
}

/* ─────────────────────────  La bitácora  ──────────────────────────────────── */

/** Los lotes generados, del más reciente al más viejo, con sus renglones. */
export async function listarLotes(companyId: string): Promise<any[]> {
  const r = await query<any>(
    `SELECT l.id, l.paso, l.archivos, l.num_renglones, l.registro_patronal,
            l.resultado, l.notas,
            (l.errores_txt IS NOT NULL) AS tiene_errores_txt,
            TO_CHAR(l.created_at,   'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
            TO_CHAR(l.resultado_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS resultado_at,
            NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), '') AS creado_por,
            COALESCE(json_agg(json_build_object(
              'tipo', r.tipo, 'nombre', r.nombre_completo, 'nss', r.nss,
              'num_empleado', r.num_empleado, 'fecha', TO_CHAR(r.fecha,'YYYY-MM-DD'),
              'importe', r.importe, 'num_credito', r.num_credito
            ) ORDER BY r.orden) FILTER (WHERE r.id IS NOT NULL), '[]') AS renglones
       FROM nomina_sua_lotes l
       LEFT JOIN nomina_sua_lote_renglones r ON r.lote_id = l.id
       LEFT JOIN users u ON u.id = l.created_by
      WHERE l.company_id = $1
      GROUP BY l.id, u.first_name, u.last_name
      ORDER BY l.created_at DESC
      LIMIT 200`,
    [companyId],
  );
  return r.rows;
}

/**
 * Cierra el lote con lo que dijo el SUA. Si fue con errores se guarda el
 * ErrImp*.txt tal cual: es el texto que el SUA escribe y la única explicación de
 * por qué un renglón no entró.
 *
 * Un lote marcado CON_ERRORES deja de contar como enviado, así que los mismos
 * movimientos vuelven a aparecer como pendientes. Es lo que se quiere: no
 * entraron.
 */
export async function registrarResultado(
  companyId: string, loteId: string,
  resultado: 'PENDIENTE' | 'IMPORTADO' | 'CON_ERRORES',
  erroresTxt?: string, notas?: string,
): Promise<boolean> {
  if (!['PENDIENTE', 'IMPORTADO', 'CON_ERRORES'].includes(resultado)) {
    throw new ValidationError('El resultado debe ser PENDIENTE, IMPORTADO o CON_ERRORES.');
  }
  const r = await query(
    `UPDATE nomina_sua_lotes
        SET resultado = $3,
            errores_txt = $4,
            notas = $5,
            resultado_at = CASE WHEN $3 = 'PENDIENTE' THEN NULL ELSE NOW() END
      WHERE company_id = $1 AND id = $2`,
    [companyId, loteId, resultado, erroresTxt?.slice(0, 200000) || null, notas?.slice(0, 2000) || null],
  );
  return (r.rowCount || 0) > 0;
}

/** El ErrImp del SUA que se guardó con el lote. */
export async function erroresDeLote(companyId: string, loteId: string): Promise<string | null> {
  const r = await query<{ errores_txt: string | null }>(
    'SELECT errores_txt FROM nomina_sua_lotes WHERE company_id = $1 AND id = $2',
    [companyId, loteId],
  );
  return r.rows[0]?.errores_txt ?? null;
}

/**
 * Borra un lote de la bitácora. Hay que poder: un archivo que se generó y nunca
 * se importó deja un apunte que miente, y mientras esté ahí el sistema cree que
 * esos movimientos ya fueron.
 */
export async function borrarLote(companyId: string, loteId: string): Promise<boolean> {
  const r = await query(
    'DELETE FROM nomina_sua_lotes WHERE company_id = $1 AND id = $2', [companyId, loteId],
  );
  return (r.rowCount || 0) > 0;
}
