/**
 * empleados.service — el expediente del personal.
 *
 * QUÉ ES Y QUÉ NO ES
 * Es el archivero: quién trabaja aquí, desde cuándo, con qué salario, con qué
 * RFC y CURP se le va a timbrar el recibo. No calcula nómina ni genera CFDI —
 * eso vive aparte y depende de este archivero, no al revés.
 *
 * POR QUÉ LA VALIDACIÓN ESTÁ AQUÍ Y NO SÓLO EN LA PANTALLA
 * Un RFC mal capturado no se descubre al guardarlo: se descubre meses después,
 * cuando el PAC rechaza el recibo del trabajador y ya hay doce quincenas
 * pagadas. La base tiene los CHECK y este servicio los repite con un mensaje
 * que se puede leer, porque un error de constraint de Postgres no le dice nada
 * a quien está capturando.
 *
 * LO QUE FALTA PARA TIMBRAR NO IMPIDE DAR DE ALTA
 * A un trabajador se le da de alta el día que entra, y ese día muchas veces no
 * se tiene el NSS ni el CP fiscal. Bloquear el alta obligaría a apuntarlo en un
 * papel. En vez de eso el expediente se guarda incompleto y el servicio dice
 * QUÉ le falta (`faltantes`), para que la pantalla lo muestre y no sea una
 * sorpresa el día del timbrado.
 */

import { PoolClient } from 'pg';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError, ConflictError } from '../../middleware/errorHandler';
import { tomarEdicion } from '../../utils/edicion';
import * as nacimiento from './fecha-de-nacimiento';

/* ═══════════════════ CATÁLOGOS CERRADOS DEL ANEXO 20 ═══════════════════
 *
 * Se listan explícitamente en vez de aceptar lo que llegue: son catálogos del
 * SAT, no campos libres, y un valor inventado se convierte en un CFDI
 * rechazado. Si el SAT publica una clave nueva, se agrega aquí a mano — no se
 * deduce ni se acepta "por si acaso". */

/** c_TipoContrato */
export const TIPOS_CONTRATO: Record<string, string> = {
  '01': 'Contrato de trabajo por tiempo indeterminado',
  '02': 'Contrato de trabajo para obra determinada',
  '03': 'Contrato de trabajo por tiempo determinado',
  '04': 'Contrato de trabajo por temporada',
  '05': 'Contrato de trabajo sujeto a prueba',
  '06': 'Contrato de trabajo con capacitación inicial',
  '07': 'Modalidad de contratación por pago de hora laborada',
  '08': 'Trabajo por comisión laboral',
  '09': 'Modalidades de contratación donde no existe relación de trabajo',
  '10': 'Jubilación, pensión, retiro',
  '99': 'Otro contrato',
};

/** c_TipoRegimen */
export const TIPOS_REGIMEN: Record<string, string> = {
  '02': 'Sueldos (incluye ingresos asimilados a salarios)',
  '03': 'Jubilados',
  '04': 'Pensionados',
  '05': 'Asimilados miembros sociedades cooperativas producción',
  '06': 'Asimilados integrantes sociedades y asociaciones civiles',
  '07': 'Asimilados miembros consejos directivos, de vigilancia',
  '08': 'Asimilados comisionistas',
  '09': 'Asimilados honorarios',
  '10': 'Asimilados acciones',
  '11': 'Asimilados otros',
  '12': 'Jubilados o Pensionados',
  '13': 'Indemnización o Separación',
  '99': 'Otro régimen',
};

/** c_TipoJornada */
export const TIPOS_JORNADA: Record<string, string> = {
  '01': 'Diurna',
  '02': 'Nocturna',
  '03': 'Mixta',
  '04': 'Por hora',
  '05': 'Reducida',
  '06': 'Continuada',
  '07': 'Partida',
  '08': 'Por turnos',
  '99': 'Otra jornada',
};

/** c_PeriodicidadPago */
export const PERIODICIDADES: Record<string, string> = {
  '01': 'Diario',
  '02': 'Semanal',
  '03': 'Catorcenal',
  '04': 'Quincenal',
  '05': 'Mensual',
  '06': 'Bimestral',
  '07': 'Unidad de obra',
  '08': 'Comisión',
  '09': 'Precio alzado',
  '10': 'Decenal',
  '99': 'Otra periodicidad',
};

/** c_RiesgoPuesto */
export const RIESGOS_PUESTO: Record<string, string> = {
  '1': 'Clase I',
  '2': 'Clase II',
  '3': 'Clase III',
  '4': 'Clase IV',
  '5': 'Clase V',
};

export const ZONAS = ['general', 'frontera_norte'] as const;
export const TIPOS_NOMINA = ['O', 'E'] as const;
export const FORMAS_INFONAVIT = ['porcentaje', 'cuota_fija', 'vsm'] as const;
export const FORMAS_PENSION = ['porcentaje', 'cuota_fija'] as const;

/* ═══════════════════════ VALIDACIÓN ═══════════════════════ */

const RE_RFC_FISICA = /^[A-ZÑ&]{4}[0-9]{6}[A-Z0-9]{3}$/;
const RE_CURP = /^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[A-Z0-9][0-9]$/;
const RE_NSS = /^[0-9]{11}$/;
const RE_CLABE = /^[0-9]{18}$/;
const RE_CP = /^[0-9]{5}$/;

const texto = (v: any, max: number): string | null => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return s.slice(0, max);
};

const mayus = (v: any, max: number): string | null => {
  const s = texto(v, max);
  return s ? s.toUpperCase() : null;
};

const numero = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fecha = (v: any, campo: string): string | null => {
  const s = texto(v, 10);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new ValidationError(`${campo} debe venir como AAAA-MM-DD`);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${campo} no es una fecha real`);
  return s;
};

export interface DatosEmpleado {
  num_empleado?: string;
  nombre?: string;
  apellido_pat?: string;
  apellido_mat?: string;
  rfc?: string;
  curp?: string;
  nss?: string;
  fecha_nacimiento?: string;
  email?: string;
  telefono?: string;
  foto?: string;
  codigo_postal?: string;
  calle?: string;
  num_exterior?: string;
  num_interior?: string;
  colonia?: string;
  municipio?: string;
  estado?: string;
  regimen_fiscal?: string;
  uso_cfdi?: string;
  puesto_id?: string;
  puesto?: string;
  departamento?: string;
  fecha_ingreso?: string;
  fecha_baja?: string;
  fecha_reingreso?: string;
  tipo_contrato?: string;
  tipo_regimen?: string;
  tipo_jornada?: string;
  periodicidad_pago?: string;
  tipo_nomina?: string;
  entidad_federativa?: string;
  zona_geografica?: string;
  salario_diario?: number;
  salario_diario_integrado?: number;
  sbc?: number;
  banco_clave?: string;
  cuenta_clabe?: string;
  tiene_infonavit?: boolean;
  infonavit_num_credito?: string;
  infonavit_tipo_descuento?: string;
  infonavit_descuento?: number;
  infonavit_seguro_danos?: number;
  tiene_pension_alimenticia?: boolean;
  pension_tipo?: string;
  pension_monto?: number;
  pension_beneficiario?: string;
  pension_num_oficio?: string;
  activo?: boolean;
  edicion?: number;
}

/**
 * Normaliza y valida. Devuelve el registro listo para escribir.
 *
 * `parcial` sirve para la edición: en un alta faltan datos obligatorios y hay
 * que gritarlo; en una edición sólo llega lo que cambió y exigir el resto
 * obligaría a la pantalla a reenviar el expediente completo.
 */
function normalizar(d: DatosEmpleado, parcial: boolean): Record<string, any> {
  const r: Record<string, any> = {};

  /* ── Identificación ── */
  if (d.num_empleado !== undefined || !parcial) {
    const v = texto(d.num_empleado, 15);
    if (!v) throw new ValidationError('El número de empleado es obligatorio');
    r.num_empleado = v;
  }
  if (d.nombre !== undefined || !parcial) {
    const v = texto(d.nombre, 100);
    if (!v) throw new ValidationError('El nombre es obligatorio');
    r.nombre = v;
  }
  if (d.apellido_pat !== undefined || !parcial) {
    const v = texto(d.apellido_pat, 100);
    if (!v) throw new ValidationError('El apellido paterno es obligatorio');
    r.apellido_pat = v;
  }
  if (d.apellido_mat !== undefined) r.apellido_mat = texto(d.apellido_mat, 100);

  if (d.rfc !== undefined || !parcial) {
    const v = mayus(d.rfc, 13);
    if (!v) throw new ValidationError('El RFC del trabajador es obligatorio');
    if (!RE_RFC_FISICA.test(v)) {
      throw new ValidationError(
        `El RFC "${v}" no tiene la forma de una persona física ` +
        '(4 letras, 6 dígitos de fecha y 3 de homoclave).'
      );
    }
    r.rfc = v;
  }
  if (d.curp !== undefined || !parcial) {
    const v = mayus(d.curp, 18);
    if (!v) throw new ValidationError('La CURP es obligatoria');
    if (!RE_CURP.test(v)) throw new ValidationError(`La CURP "${v}" no tiene los 18 caracteres válidos`);
    r.curp = v;
  }
  if (d.nss !== undefined) {
    /* Se aceptan los guiones con que suele venir escrito y se guardan los
     * 11 dígitos limpios: es lo que pide el CFDI. */
    const crudo = String(d.nss ?? '').replace(/[\s-]/g, '');
    if (!crudo) r.nss = null;
    else {
      if (!RE_NSS.test(crudo)) {
        throw new ValidationError('El NSS debe traer exactamente 11 dígitos');
      }
      r.nss = crudo;
    }
  }

  if (d.fecha_nacimiento !== undefined) r.fecha_nacimiento = fecha(d.fecha_nacimiento, 'La fecha de nacimiento');

  /* Si no la capturaron, se saca del RFC o de la CURP: los dos la llevan en las
   * posiciones 5 a 10 y NO cambia. Pedirla a mano por tercera vez sólo abre la
   * puerta a que alguien teclee otra cosa. La captura manual siempre gana: esto
   * sólo rellena el hueco. */
  if (!r.fecha_nacimiento && (r.rfc || r.curp)) {
    const der = nacimiento.derivar({ rfc: r.rfc, curp: r.curp });
    if (der.fecha) r.fecha_nacimiento = der.fecha;
  }
  if (d.email !== undefined) {
    const v = texto(d.email, 255);
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      throw new ValidationError('El correo del trabajador no es válido');
    }
    r.email = v ? v.toLowerCase() : null;
  }
  if (d.telefono !== undefined) r.telefono = texto(d.telefono, 20);
  if (d.foto !== undefined) {
    const v = d.foto ? String(d.foto) : null;
    /* Sólo imágenes en data URI, y con techo: el campo es TEXT y sin límite
     * una foto de cámara de 8 MB entra sin protestar y engorda cada consulta
     * del listado. */
    if (v) {
      if (!/^data:image\/(png|jpe?g|webp);base64,/.test(v)) {
        throw new ValidationError('La foto debe ser una imagen PNG, JPG o WEBP');
      }
      if (v.length > 2 * 1024 * 1024) {
        throw new ValidationError('La foto no debe pesar más de 1.5 MB aproximadamente');
      }
    }
    r.foto = v;
  }

  /* ── Domicilio ── */
  if (d.codigo_postal !== undefined) {
    const v = texto(d.codigo_postal, 5);
    if (v && !RE_CP.test(v)) throw new ValidationError('El código postal debe traer 5 dígitos');
    r.codigo_postal = v;
  }
  if (d.calle !== undefined) r.calle = texto(d.calle, 255);
  if (d.num_exterior !== undefined) r.num_exterior = texto(d.num_exterior, 20);
  if (d.num_interior !== undefined) r.num_interior = texto(d.num_interior, 20);
  if (d.colonia !== undefined) r.colonia = texto(d.colonia, 150);
  if (d.municipio !== undefined) r.municipio = texto(d.municipio, 150);
  if (d.estado !== undefined) r.estado = texto(d.estado, 100);

  /* ── Fiscales ── */
  if (d.regimen_fiscal !== undefined) r.regimen_fiscal = texto(d.regimen_fiscal, 3) || '605';
  if (d.uso_cfdi !== undefined) r.uso_cfdi = mayus(d.uso_cfdi, 5) || 'CN01';

  /* ── Relación laboral ── */
  if (d.puesto_id !== undefined) r.puesto_id = texto(d.puesto_id, 36);
  if (d.puesto !== undefined) r.puesto = texto(d.puesto, 100);
  if (d.departamento !== undefined) r.departamento = texto(d.departamento, 100);

  if (d.fecha_ingreso !== undefined || !parcial) {
    const v = fecha(d.fecha_ingreso, 'La fecha de ingreso');
    if (!v) throw new ValidationError('La fecha de ingreso es obligatoria');
    r.fecha_ingreso = v;
  }
  if (d.fecha_baja !== undefined) r.fecha_baja = fecha(d.fecha_baja, 'La fecha de baja');
  if (d.fecha_reingreso !== undefined) r.fecha_reingreso = fecha(d.fecha_reingreso, 'La fecha de reingreso');

  const enCatalogo = (valor: any, cat: Record<string, string>, campo: string, obligatorio: boolean) => {
    const v = texto(valor, 3);
    if (!v) {
      if (obligatorio) throw new ValidationError(`${campo} es obligatorio`);
      return null;
    }
    if (!cat[v]) {
      throw new ValidationError(
        `${campo}: la clave "${v}" no está en el catálogo del SAT. ` +
        `Válidas: ${Object.keys(cat).join(', ')}.`
      );
    }
    return v;
  };

  if (d.tipo_contrato !== undefined || !parcial) {
    r.tipo_contrato = enCatalogo(d.tipo_contrato ?? '01', TIPOS_CONTRATO, 'El tipo de contrato', true);
  }
  if (d.tipo_regimen !== undefined || !parcial) {
    r.tipo_regimen = enCatalogo(d.tipo_regimen ?? '02', TIPOS_REGIMEN, 'El tipo de régimen', true);
  }
  if (d.tipo_jornada !== undefined) {
    r.tipo_jornada = enCatalogo(d.tipo_jornada, TIPOS_JORNADA, 'El tipo de jornada', false);
  }
  if (d.periodicidad_pago !== undefined || !parcial) {
    r.periodicidad_pago = enCatalogo(
      d.periodicidad_pago ?? '04', PERIODICIDADES, 'La periodicidad de pago', true
    );
  }
  if (d.tipo_nomina !== undefined || !parcial) {
    const v = mayus(d.tipo_nomina ?? 'O', 1)!;
    if (!TIPOS_NOMINA.includes(v as any)) {
      throw new ValidationError('El tipo de nómina debe ser O (ordinaria) o E (extraordinaria)');
    }
    r.tipo_nomina = v;
  }
  if (d.entidad_federativa !== undefined) r.entidad_federativa = mayus(d.entidad_federativa, 3);
  if (d.zona_geografica !== undefined || !parcial) {
    const v = texto(d.zona_geografica ?? 'general', 20)!;
    if (!ZONAS.includes(v as any)) {
      throw new ValidationError('La zona debe ser "general" o "frontera_norte"');
    }
    r.zona_geografica = v;
  }

  /* ── Salario ── */
  if (d.salario_diario !== undefined || !parcial) {
    const v = numero(d.salario_diario) ?? 0;
    if (v < 0) throw new ValidationError('El salario diario no puede ser negativo');
    r.salario_diario = v;
  }
  if (d.salario_diario_integrado !== undefined) {
    const v = numero(d.salario_diario_integrado) ?? 0;
    if (v < 0) throw new ValidationError('El salario diario integrado no puede ser negativo');
    r.salario_diario_integrado = v;
  }

  /* El integrado NUNCA puede quedar por debajo del diario.
   *
   * El SDI es el diario más aguinaldo y prima vacacional (Art. 84 LSS): su
   * factor de integración no baja de 1. Que quede menor sólo pasa cuando se
   * capturan al revés, y el error no se nota en pantalla —dos números
   * parecidos— pero mueve la cuota obrera del IMSS de toda la plantilla. Se
   * rechaza aquí, además del CHECK de la base, para poder decir qué hacer en
   * vez de devolver una violación de restricción. */
  {
    const diario = r.salario_diario !== undefined
      ? Number(r.salario_diario)
      : (parcial ? undefined : 0);
    const integrado = r.salario_diario_integrado !== undefined
      ? Number(r.salario_diario_integrado)
      : undefined;

    if (diario !== undefined && integrado !== undefined &&
        diario > 0 && integrado > 0 && integrado < diario) {
      throw new ValidationError(
        `El salario diario integrado (${integrado}) no puede ser menor que el salario ` +
        `diario (${diario}): el factor de integración del Art. 84 LSS nunca baja de 1. ` +
        'Lo más probable es que estén invertidos — el MENOR es el del contrato y el ' +
        'MAYOR es el integrado.'
      );
    }
  }
  if (d.sbc !== undefined) r.sbc = numero(d.sbc);
  if (d.banco_clave !== undefined) r.banco_clave = texto(d.banco_clave, 3);
  if (d.cuenta_clabe !== undefined) {
    const v = String(d.cuenta_clabe ?? '').replace(/\s/g, '');
    if (!v) r.cuenta_clabe = null;
    else {
      if (!RE_CLABE.test(v)) throw new ValidationError('La CLABE debe traer 18 dígitos');
      r.cuenta_clabe = v;
    }
  }

  /* ── INFONAVIT ── */
  if (d.tiene_infonavit !== undefined) r.tiene_infonavit = !!d.tiene_infonavit;
  if (d.infonavit_num_credito !== undefined) r.infonavit_num_credito = texto(d.infonavit_num_credito, 20);
  if (d.infonavit_tipo_descuento !== undefined) {
    const v = texto(d.infonavit_tipo_descuento, 12);
    if (v && !FORMAS_INFONAVIT.includes(v as any)) {
      throw new ValidationError('El descuento de INFONAVIT es por porcentaje, cuota fija o VSM');
    }
    r.infonavit_tipo_descuento = v;
  }
  if (d.infonavit_descuento !== undefined) {
    const v = numero(d.infonavit_descuento);
    if (v !== null && v < 0) throw new ValidationError('El descuento de INFONAVIT no puede ser negativo');
    r.infonavit_descuento = v;
  }
  if (d.infonavit_seguro_danos !== undefined) r.infonavit_seguro_danos = numero(d.infonavit_seguro_danos) ?? 0;

  /* Un crédito marcado sin decir cómo se descuenta no se puede aplicar: es
   * mejor negarlo al guardar que descubrirlo con el recibo ya timbrado. */
  if (r.tiene_infonavit === true) {
    const tipo = r.infonavit_tipo_descuento ?? d.infonavit_tipo_descuento;
    const monto = r.infonavit_descuento ?? d.infonavit_descuento;
    if (!tipo || !monto) {
      throw new ValidationError(
        'Si el trabajador tiene crédito INFONAVIT hay que indicar la forma del ' +
        'descuento (porcentaje, cuota fija o VSM) y su valor.'
      );
    }
  }

  /* ── Pensión alimenticia ── */
  if (d.tiene_pension_alimenticia !== undefined) r.tiene_pension_alimenticia = !!d.tiene_pension_alimenticia;
  if (d.pension_tipo !== undefined) {
    const v = texto(d.pension_tipo, 12);
    if (v && !FORMAS_PENSION.includes(v as any)) {
      throw new ValidationError('La pensión alimenticia es por porcentaje o cuota fija');
    }
    r.pension_tipo = v;
  }
  if (d.pension_monto !== undefined) {
    const v = numero(d.pension_monto);
    if (v !== null && v < 0) throw new ValidationError('El monto de la pensión no puede ser negativo');
    r.pension_monto = v;
  }
  if (d.pension_beneficiario !== undefined) r.pension_beneficiario = texto(d.pension_beneficiario, 255);
  if (d.pension_num_oficio !== undefined) r.pension_num_oficio = texto(d.pension_num_oficio, 60);

  if (r.tiene_pension_alimenticia === true) {
    const tipo = r.pension_tipo ?? d.pension_tipo;
    const monto = r.pension_monto ?? d.pension_monto;
    if (!tipo || !monto) {
      throw new ValidationError(
        'Una pensión alimenticia necesita la forma del descuento y su valor: ' +
        'viene de una orden judicial y se aplica exactamente como dice el oficio.'
      );
    }
  }

  if (d.activo !== undefined) r.activo = !!d.activo;

  /* Coherencia de fechas — el CHECK de la base lo repite, pero el mensaje de
   * Postgres no le sirve a quien está capturando. */
  const ing = r.fecha_ingreso ?? null;
  const baja = r.fecha_baja ?? null;
  if (ing && baja && baja < ing) {
    throw new ValidationError('La fecha de baja no puede ser anterior a la de ingreso');
  }

  return r;
}

/**
 * Qué le falta al expediente para poder timbrarle un recibo.
 *
 * No bloquea nada: informa. Se calcula sobre el registro guardado para que la
 * pantalla lo muestre igual si el dato se perdió después.
 */
export function faltantesParaTimbrar(e: any): string[] {
  const f: string[] = [];
  if (!e.rfc) f.push('RFC');
  if (!e.curp) f.push('CURP');
  if (!e.nss) f.push('NSS (número de seguridad social)');
  if (!e.codigo_postal) f.push('código postal fiscal');
  if (!e.entidad_federativa) f.push('entidad federativa donde presta el servicio');
  if (!e.tipo_jornada) f.push('tipo de jornada');
  if (Number(e.salario_diario) <= 0) f.push('salario diario');
  if (Number(e.salario_diario_integrado) <= 0) f.push('salario diario integrado');
  return f;
}

/* ═══════════════════════ CONSULTAS ═══════════════════════ */

const CAMPOS = `
  e.id, e.num_empleado, e.nombre, e.apellido_pat, e.apellido_mat,
  TRIM(e.nombre || ' ' || e.apellido_pat || ' ' || COALESCE(e.apellido_mat,'')) AS nombre_completo,
  e.rfc, e.curp, e.nss, e.email, e.telefono,
  e.codigo_postal, e.calle, e.num_exterior, e.num_interior, e.colonia,
  e.municipio, e.estado, e.regimen_fiscal, e.uso_cfdi,
  e.puesto_id, e.puesto, e.departamento,
  /* Las fechas salen como texto AAAA-MM-DD y no como Date.
   *
   * Una DATE de Postgres llega al driver como un Date a medianoche LOCAL del
   * servidor; al serializarse a JSON se convierte a UTC y una baja del 15 se
   * vuelve "2026-08-15T06:00:00.000Z" — o, con el servidor en otro huso, el 14.
   * Aquí no hay instantes: son fechas de calendario, y el día en que alguien
   * causó baja ante el IMSS no puede depender de dónde esté corriendo el
   * proceso. Además el <input type="date"> del formulario espera exactamente
   * este formato. */
  TO_CHAR(e.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
  TO_CHAR(e.fecha_ingreso,    'YYYY-MM-DD') AS fecha_ingreso,
  TO_CHAR(e.fecha_baja,       'YYYY-MM-DD') AS fecha_baja,
  TO_CHAR(e.fecha_reingreso,  'YYYY-MM-DD') AS fecha_reingreso,
  e.tipo_contrato, e.tipo_regimen, e.tipo_jornada, e.periodicidad_pago,
  e.tipo_nomina, e.entidad_federativa, e.zona_geografica,
  e.salario_diario, e.salario_diario_integrado, e.sbc,
  e.banco_clave, e.cuenta_clabe,
  e.tiene_infonavit, e.infonavit_num_credito, e.infonavit_tipo_descuento,
  e.infonavit_descuento, e.infonavit_seguro_danos,
  e.tiene_pension_alimenticia, e.pension_tipo, e.pension_monto,
  e.pension_beneficiario, e.pension_num_oficio,
  e.activo, e.edicion, e.created_at, e.updated_at,
  p.nombre AS puesto_catalogo, p.riesgo_puesto
`;

export interface FiltrosEmpleados {
  buscar?: string;
  soloActivos?: boolean;
  departamento?: string;
}

export async function listar(companyId: string, f: FiltrosEmpleados = {}) {
  const cond: string[] = ['e.company_id = $1', 'e.deleted_at IS NULL'];
  const args: any[] = [companyId];

  if (f.soloActivos !== false) cond.push('e.activo = true');

  if (f.buscar) {
    args.push(`%${String(f.buscar).trim().toLowerCase()}%`);
    cond.push(`(
      LOWER(e.nombre || ' ' || e.apellido_pat || ' ' || COALESCE(e.apellido_mat,'')) LIKE $${args.length}
      OR LOWER(e.num_empleado) LIKE $${args.length}
      OR LOWER(e.rfc) LIKE $${args.length}
      OR LOWER(e.curp) LIKE $${args.length}
      OR COALESCE(e.nss,'') LIKE $${args.length}
    )`);
  }
  if (f.departamento) {
    args.push(f.departamento);
    cond.push(`e.departamento = $${args.length}`);
  }

  /* La foto NO va en el listado: son cientos de KB por renglón y la lista se
   * pide en cada teclazo del buscador. Se trae sólo al abrir el expediente. */
  const r = await query<any>(
    `SELECT ${CAMPOS}
       FROM nomina_empleados e
       LEFT JOIN nomina_puestos p ON p.id = e.puesto_id
      WHERE ${cond.join(' AND ')}
      ORDER BY e.apellido_pat, e.apellido_mat NULLS FIRST, e.nombre`,
    args
  );
  return r.rows.map((e) => ({ ...e, faltantes: faltantesParaTimbrar(e) }));
}

export async function obtener(companyId: string, id: string) {
  const r = await query<any>(
    `SELECT ${CAMPOS}, e.foto
       FROM nomina_empleados e
       LEFT JOIN nomina_puestos p ON p.id = e.puesto_id
      WHERE e.id = $1 AND e.company_id = $2 AND e.deleted_at IS NULL`,
    [id, companyId]
  );
  if (r.rows.length === 0) throw new NotFoundError('Ese trabajador no existe en esta empresa');
  const e = r.rows[0];
  return { ...e, faltantes: faltantesParaTimbrar(e) };
}

/** Resumen de la plantilla — lo que necesita el tablero. */
export async function resumen(companyId: string) {
  const r = await query<any>(
    `SELECT
        COUNT(*) FILTER (WHERE activo)                          AS activos,
        COUNT(*) FILTER (WHERE NOT activo)                      AS bajas,
        COALESCE(SUM(salario_diario) FILTER (WHERE activo), 0)  AS suma_salario_diario,
        COUNT(*) FILTER (WHERE activo AND tiene_infonavit)      AS con_infonavit,
        COUNT(*) FILTER (WHERE activo AND tiene_pension_alimenticia) AS con_pension,
        COUNT(*) FILTER (WHERE activo AND (nss IS NULL OR codigo_postal IS NULL
                                           OR entidad_federativa IS NULL
                                           OR salario_diario_integrado <= 0)) AS incompletos
       FROM nomina_empleados
      WHERE company_id = $1 AND deleted_at IS NULL`,
    [companyId]
  );
  const d = r.rows[0] || {};
  return {
    activos: Number(d.activos || 0),
    bajas: Number(d.bajas || 0),
    sumaSalarioDiario: Number(d.suma_salario_diario || 0),
    conInfonavit: Number(d.con_infonavit || 0),
    conPension: Number(d.con_pension || 0),
    incompletos: Number(d.incompletos || 0),
  };
}

/**
 * Busca a alguien por RFC o CURP dentro de la empresa.
 *
 * Lo usa el importador de XML antes de proponer un alta: si ya está, no hay
 * nada que dar de alta y lo que procede es ofrecer completar el expediente.
 */
export async function buscarPorIdentidad(
  companyId: string,
  ident: { rfc?: string | null; curp?: string | null }
) {
  const rfc = ident.rfc ? String(ident.rfc).toUpperCase().trim() : null;
  const curp = ident.curp ? String(ident.curp).toUpperCase().trim() : null;
  if (!rfc && !curp) return null;

  const r = await query<any>(
    `SELECT ${CAMPOS}
       FROM nomina_empleados e
       LEFT JOIN nomina_puestos p ON p.id = e.puesto_id
      WHERE e.company_id = $1 AND e.deleted_at IS NULL
        AND (($2::varchar IS NOT NULL AND e.rfc = $2::varchar)
          OR ($3::varchar IS NOT NULL AND e.curp = $3::varchar))
      LIMIT 1`,
    [companyId, rfc, curp]
  );
  return r.rows[0] || null;
}

/* ═══════════════════════ ESCRITURA ═══════════════════════ */

/** El siguiente número libre, para proponerlo en el alta. */
export async function siguienteNumero(companyId: string): Promise<string> {
  const r = await query<{ maximo: number }>(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(num_empleado, '\\D', '', 'g'), '')::bigint), 0) AS maximo
       FROM nomina_empleados
      WHERE company_id = $1 AND deleted_at IS NULL`,
    [companyId]
  );
  return String(Number(r.rows[0]?.maximo || 0) + 1).padStart(3, '0');
}

export async function crear(companyId: string, datos: DatosEmpleado) {
  const d = normalizar(datos, false);

  return transaction(async (client: PoolClient) => {
    await verificarNoDuplicado(client, companyId, d.num_empleado, d.rfc, null);

    const cols = Object.keys(d);
    const vals = cols.map((c) => d[c]);
    const marcas = cols.map((_, i) => `$${i + 2}`);

    const r = await transactionQuery<{ id: string }>(
      client,
      `INSERT INTO nomina_empleados (company_id, ${cols.join(', ')})
       VALUES ($1, ${marcas.join(', ')})
       RETURNING id`,
      [companyId, ...vals]
    );
    return obtenerEnTransaccion(client, companyId, r.rows[0].id);
  });
}

export async function actualizar(companyId: string, id: string, datos: DatosEmpleado) {
  const d = normalizar(datos, true);
  if (Object.keys(d).length === 0) throw new ValidationError('No hay nada que actualizar');

  return transaction(async (client: PoolClient) => {
    /* Compara-e-incrementa: si alguien más guardó mientras este formulario
     * estaba abierto, aquí truena con 409 y no se pisa su trabajo. */
    await tomarEdicion(client, 'nomina_empleados', id, datos.edicion);

    await verificarNoDuplicado(client, companyId, d.num_empleado, d.rfc, id);

    const cols = Object.keys(d);
    const sets = cols.map((c, i) => `${c} = $${i + 3}`);
    const r = await transactionQuery(
      client,
      `UPDATE nomina_empleados
          SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [id, companyId, ...cols.map((c) => d[c])]
    );
    if (r.rowCount === 0) throw new NotFoundError('Ese trabajador no existe en esta empresa');

    return obtenerEnTransaccion(client, companyId, id);
  });
}

/**
 * Baja del trabajador.
 *
 * NO borra el expediente: los recibos timbrados siguen apuntando a él y la
 * autoridad puede pedirlos cinco años después. Se marca inactivo con su fecha
 * de baja, que además es el dato que va en el aviso al IMSS.
 */
export async function darDeBaja(companyId: string, id: string, fechaBaja: string, motivo?: string) {
  const f = fecha(fechaBaja, 'La fecha de baja');
  if (!f) throw new ValidationError('La baja necesita su fecha');

  const r = await query<any>(
    `UPDATE nomina_empleados
        SET activo = false, fecha_baja = $3::date, updated_at = NOW(), edicion = edicion + 1
      WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
        AND $3::date >= fecha_ingreso
      RETURNING id`,
    [id, companyId, f]
  );
  if (r.rows.length === 0) {
    throw new ValidationError(
      'No se pudo dar de baja: o el trabajador no existe, o la fecha es anterior a su ingreso'
    );
  }
  return { id, fecha_baja: f, motivo: motivo || null };
}

/** Reingreso: vuelve a la plantilla conservando su historia. */
export async function reingresar(companyId: string, id: string, fechaReingreso: string) {
  const f = fecha(fechaReingreso, 'La fecha de reingreso');
  if (!f) throw new ValidationError('El reingreso necesita su fecha');

  const r = await query<any>(
    `UPDATE nomina_empleados
        SET activo = true, fecha_reingreso = $3::date, fecha_baja = NULL,
            updated_at = NOW(), edicion = edicion + 1
      WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
      RETURNING id`,
    [id, companyId, f]
  );
  if (r.rows.length === 0) throw new NotFoundError('Ese trabajador no existe en esta empresa');
  return { id, fecha_reingreso: f };
}

/* ── Auxiliares ── */

async function verificarNoDuplicado(
  client: PoolClient,
  companyId: string,
  numEmpleado: string | undefined,
  rfc: string | undefined,
  excluyendoId: string | null
) {
  if (!numEmpleado && !rfc) return;
  const r = await transactionQuery<any>(
    client,
    `SELECT id, num_empleado, rfc,
            TRIM(nombre || ' ' || apellido_pat) AS quien
       FROM nomina_empleados
      WHERE company_id = $1 AND deleted_at IS NULL
        AND ($4::uuid IS NULL OR id <> $4::uuid)
        AND (($2::varchar IS NOT NULL AND UPPER(TRIM(num_empleado)) = UPPER(TRIM($2::varchar)))
          OR ($3::varchar IS NOT NULL AND rfc = $3::varchar))
      LIMIT 1`,
    [companyId, numEmpleado ?? null, rfc ?? null, excluyendoId]
  );
  if (r.rows.length > 0) {
    const o = r.rows[0];
    const porNumero = numEmpleado &&
      String(o.num_empleado).trim().toUpperCase() === String(numEmpleado).trim().toUpperCase();
    throw new ConflictError(
      porNumero
        ? `El número de empleado ${numEmpleado} ya lo tiene ${o.quien}`
        : `El RFC ${rfc} ya está dado de alta como ${o.quien} (empleado ${o.num_empleado})`
    );
  }
}

async function obtenerEnTransaccion(client: PoolClient, companyId: string, id: string) {
  const r = await transactionQuery<any>(
    client,
    `SELECT ${CAMPOS}
       FROM nomina_empleados e
       LEFT JOIN nomina_puestos p ON p.id = e.puesto_id
      WHERE e.id = $1 AND e.company_id = $2`,
    [id, companyId]
  );
  const e = r.rows[0];
  return { ...e, faltantes: faltantesParaTimbrar(e) };
}

/* ═══════════════════════ PUESTOS ═══════════════════════ */

export async function listarPuestos(companyId: string) {
  const r = await query<any>(
    `SELECT p.id, p.nombre, p.riesgo_puesto, p.activo,
            COUNT(e.id) FILTER (WHERE e.activo AND e.deleted_at IS NULL) AS empleados
       FROM nomina_puestos p
       LEFT JOIN nomina_empleados e ON e.puesto_id = p.id
      WHERE p.company_id = $1
      GROUP BY p.id
      ORDER BY p.nombre`,
    [companyId]
  );
  return r.rows;
}

export async function crearPuesto(companyId: string, nombre: string, riesgo?: string) {
  const n = texto(nombre, 100);
  if (!n) throw new ValidationError('El puesto necesita un nombre');
  const r = riesgo ? texto(riesgo, 1) : null;
  if (r && !RIESGOS_PUESTO[r]) {
    throw new ValidationError('La clase de riesgo del puesto va del 1 al 5');
  }
  try {
    const q = await query<any>(
      `INSERT INTO nomina_puestos (company_id, nombre, riesgo_puesto)
       VALUES ($1, $2, $3) RETURNING id, nombre, riesgo_puesto, activo`,
      [companyId, n, r]
    );
    return q.rows[0];
  } catch (e: any) {
    if (e?.code === '23505') throw new ConflictError(`El puesto "${n}" ya existe`);
    throw e;
  }
}
