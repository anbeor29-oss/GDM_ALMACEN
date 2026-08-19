/**
 * reportes.service — los cuatro reportes de nómina, por rango de periodos.
 *
 * DE DÓNDE SALEN LOS NÚMEROS
 * De `nomina_recibos`, o sea de periodos CERRADOS. No se recalcula nada: un
 * reporte que recalcula con los datos de hoy daría cifras distintas a las que
 * se pagaron y a las que se declararon, y entonces no sirve para cuadrar —que
 * es lo único para lo que se usa un reporte de nómina—.
 *
 * Los periodos abiertos no aparecen a propósito. Lo que todavía se puede mover
 * no se declara; para verlo está la prenómina.
 *
 * EL RANGO
 * Del periodo N al M dentro de un año y una periodicidad: 1 a 53 en semanal,
 * 1 a 24 en quincenal, 1 a 12 en mensual. Es como se piden al contador —"del 1
 * al 12", "la 24"— y como se cuadran contra las declaraciones mensuales.
 *
 * LOS CUATRO
 *   · prenomina   — el detalle por trabajador y periodo, para revisar
 *   · cfdi        — qué se timbró y qué no, con su UUID
 *   · isr         — lo retenido por el Art. 96, para la declaración
 *   · imss        — la cuota obrera, para cuadrar contra la liquidación
 */

import { query } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import { MAXIMO_POR_TIPO, TipoPeriodo } from './calendario';

export type TipoReporte = 'prenomina' | 'cfdi' | 'isr' | 'imss';

export interface Filtro {
  anio: number;
  tipo: TipoPeriodo;
  desde: number;
  hasta: number;
  /** Para sacar el reporte de una sola persona. */
  empleadoId?: string;
}

/** Valida el rango contra el máximo de esa periodicidad. */
function revisarRango(f: Filtro) {
  const max = MAXIMO_POR_TIPO[f.tipo];
  if (!max) throw new ValidationError(`Periodicidad desconocida: ${f.tipo}`);
  if (!Number.isInteger(f.anio) || f.anio < 2000 || f.anio > 2100) {
    throw new ValidationError('El año no es válido');
  }
  if (!Number.isInteger(f.desde) || !Number.isInteger(f.hasta)) {
    throw new ValidationError('El rango de periodos debe venir en números');
  }
  if (f.desde < 1 || f.hasta > max) {
    throw new ValidationError(
      `En ${f.tipo.toLowerCase()} los periodos van del 1 al ${max}; ` +
      `pediste del ${f.desde} al ${f.hasta}.`
    );
  }
  if (f.desde > f.hasta) {
    throw new ValidationError('El periodo inicial no puede ser mayor que el final');
  }
}

/** El WHERE común a los cuatro. */
function alcance(companyId: string, f: Filtro) {
  const args: any[] = [companyId, f.anio, f.tipo, f.desde, f.hasta];
  let cond =
    `r.company_id = $1 AND p.anio = $2 AND p.tipo = $3 ` +
    `AND p.numero BETWEEN $4 AND $5`;
  if (f.empleadoId) {
    args.push(f.empleadoId);
    cond += ` AND r.empleado_id = $${args.length}`;
  }
  return { cond, args };
}

/**
 * Reporte de prenómina — el detalle de lo pagado.
 *
 * Un renglón por trabajador y periodo. Es el que se imprime para revisar con
 * el jefe de área antes de la junta, y el que se archiva.
 */
export async function prenomina(companyId: string, f: Filtro) {
  revisarRango(f);
  const { cond, args } = alcance(companyId, f);

  const r = await query<any>(
    `SELECT p.numero AS periodo, p.concepto,
            TO_CHAR(p.fecha_inicio,'YYYY-MM-DD') AS fecha_inicio,
            TO_CHAR(p.fecha_fin,'YYYY-MM-DD')    AS fecha_fin,
            r.num_empleado, r.nombre, r.rfc, r.dias,
            r.total_percepciones, r.total_gravado, r.total_exento,
            r.imss, r.isr, r.total_deducciones, r.neto
       FROM nomina_recibos r
       JOIN nomina_periodos p ON p.id = r.periodo_id
      WHERE ${cond}
      ORDER BY p.numero, r.num_empleado`,
    args
  );
  return { renglones: r.rows, totales: sumar(r.rows) };
}

/**
 * Reporte de CFDI — qué se timbró y qué falta.
 *
 * Lo que se revisa aquí no es el dinero, es el ESTADO: un recibo sin UUID a fin
 * de mes es una retención declarada sin comprobante que la ampare.
 */
export async function cfdi(companyId: string, f: Filtro) {
  revisarRango(f);
  const { cond, args } = alcance(companyId, f);

  const r = await query<any>(
    `SELECT p.numero AS periodo,
            TO_CHAR(p.fecha_inicio,'YYYY-MM-DD') AS fecha_inicio,
            TO_CHAR(p.fecha_fin,'YYYY-MM-DD')    AS fecha_fin,
            r.num_empleado, r.nombre, r.rfc, r.neto,
            r.estatus, r.uuid,
            TO_CHAR(r.timbrado_at, 'YYYY-MM-DD HH24:MI') AS timbrado_at,
            r.enviar_por_correo,
            TO_CHAR(r.enviado_at, 'YYYY-MM-DD HH24:MI')  AS enviado_at
       FROM nomina_recibos r
       JOIN nomina_periodos p ON p.id = r.periodo_id
      WHERE ${cond}
      ORDER BY p.numero, r.num_empleado`,
    args
  );

  const timbrados = r.rows.filter((x: any) => x.uuid).length;
  return {
    renglones: r.rows,
    totales: {
      recibos: r.rows.length,
      timbrados,
      sinTimbrar: r.rows.length - timbrados,
      neto: redondear(r.rows.reduce((a: number, x: any) => a + Number(x.neto || 0), 0)),
    },
  };
}

/**
 * Reporte de ISR — lo retenido por el Art. 96.
 *
 * Se agrupa por TRABAJADOR y no por periodo: así se lee como la constancia
 * anual y se cuadra con lo que cada quien va a ver en su declaración. La
 * columna del subsidio va aparte porque no es una retención — es dinero que se
 * le entregó y que el patrón acredita.
 */
export async function isr(companyId: string, f: Filtro) {
  revisarRango(f);
  const { cond, args } = alcance(companyId, f);

  const r = await query<any>(
    `SELECT r.num_empleado, r.nombre, r.rfc,
            COUNT(*)::int                        AS periodos,
            SUM(r.total_gravado)                 AS gravado,
            SUM(r.total_exento)                  AS exento,
            SUM(r.total_percepciones)            AS percepciones,
            SUM(r.isr)                           AS isr,
            SUM(r.total_otros_pagos)             AS subsidio
       FROM nomina_recibos r
       JOIN nomina_periodos p ON p.id = r.periodo_id
      WHERE ${cond}
      GROUP BY r.num_empleado, r.nombre, r.rfc
      ORDER BY r.num_empleado`,
    args
  );

  /* Y el corte por periodo, que es contra lo que se paga cada mes al SAT. */
  const porPeriodo = await query<any>(
    `SELECT p.numero AS periodo,
            TO_CHAR(p.fecha_fin,'YYYY-MM-DD') AS fecha_fin,
            COUNT(*)::int         AS trabajadores,
            SUM(r.total_gravado)  AS gravado,
            SUM(r.isr)            AS isr,
            SUM(r.total_otros_pagos) AS subsidio
       FROM nomina_recibos r
       JOIN nomina_periodos p ON p.id = r.periodo_id
      WHERE ${cond}
      GROUP BY p.numero, p.fecha_fin
      ORDER BY p.numero`,
    args
  );

  return {
    renglones: r.rows,
    porPeriodo: porPeriodo.rows,
    totales: {
      trabajadores: r.rows.length,
      gravado: redondear(suma(r.rows, 'gravado')),
      exento: redondear(suma(r.rows, 'exento')),
      isr: redondear(suma(r.rows, 'isr')),
      subsidio: redondear(suma(r.rows, 'subsidio')),
    },
  };
}

/**
 * Reporte de IMSS — la cuota OBRERA.
 *
 * Es sólo la parte del trabajador: lo que el patrón retuvo. La cuota patronal
 * no se calcula en este sistema y por eso no aparece; ponerla en cero haría
 * creer que es cero.
 */
export async function imss(companyId: string, f: Filtro) {
  revisarRango(f);
  const { cond, args } = alcance(companyId, f);

  const r = await query<any>(
    `SELECT r.num_empleado, r.nombre, r.rfc, r.nss,
            COUNT(*)::int   AS periodos,
            SUM(r.dias)     AS dias,
            SUM(r.imss)     AS imss
       FROM nomina_recibos r
       JOIN nomina_periodos p ON p.id = r.periodo_id
      WHERE ${cond}
      GROUP BY r.num_empleado, r.nombre, r.rfc, r.nss
      ORDER BY r.num_empleado`,
    args
  );

  const porPeriodo = await query<any>(
    `SELECT p.numero AS periodo,
            TO_CHAR(p.fecha_fin,'YYYY-MM-DD') AS fecha_fin,
            COUNT(*)::int AS trabajadores,
            SUM(r.dias)   AS dias,
            SUM(r.imss)   AS imss
       FROM nomina_recibos r
       JOIN nomina_periodos p ON p.id = r.periodo_id
      WHERE ${cond}
      GROUP BY p.numero, p.fecha_fin
      ORDER BY p.numero`,
    args
  );

  /* Quién no cotizó y por qué. Al salario mínimo la cuota obrera es CERO por
   * el Art. 36 LSS —la absorbe el patrón—, y verlo en el reporte evita que
   * alguien lo reporte como un error del sistema. */
  const sinCuota = r.rows.filter((x: any) => Number(x.imss) === 0).length;

  return {
    renglones: r.rows,
    porPeriodo: porPeriodo.rows,
    totales: {
      trabajadores: r.rows.length,
      sinCuota,
      dias: suma(r.rows, 'dias'),
      imss: redondear(suma(r.rows, 'imss')),
    },
  };
}

/** Qué periodos CERRADOS hay, para que la pantalla no ofrezca rangos vacíos. */
export async function periodosDisponibles(companyId: string, anio: number) {
  const r = await query<any>(
    `SELECT p.tipo, p.numero, p.concepto,
            TO_CHAR(p.fecha_inicio,'YYYY-MM-DD') AS fecha_inicio,
            TO_CHAR(p.fecha_fin,'YYYY-MM-DD')    AS fecha_fin,
            COUNT(r.id)::int AS recibos
       FROM nomina_periodos p
       LEFT JOIN nomina_recibos r ON r.periodo_id = p.id
      WHERE p.company_id = $1 AND p.anio = $2 AND p.estatus = 'CERRADO'
      GROUP BY p.tipo, p.numero, p.concepto, p.fecha_inicio, p.fecha_fin
      ORDER BY p.tipo, p.numero`,
    [companyId, anio]
  );

  const porTipo: Record<string, any[]> = {};
  for (const x of r.rows) {
    (porTipo[x.tipo] = porTipo[x.tipo] || []).push(x);
  }
  return porTipo;
}

const suma = (filas: any[], campo: string) =>
  filas.reduce((a, x) => a + Number(x[campo] || 0), 0);

const redondear = (v: number) => Math.round(v * 100) / 100;

function sumar(filas: any[]) {
  return {
    renglones: filas.length,
    percepciones: redondear(suma(filas, 'total_percepciones')),
    gravado: redondear(suma(filas, 'total_gravado')),
    exento: redondear(suma(filas, 'total_exento')),
    imss: redondear(suma(filas, 'imss')),
    isr: redondear(suma(filas, 'isr')),
    deducciones: redondear(suma(filas, 'total_deducciones')),
    neto: redondear(suma(filas, 'neto')),
  };
}

/** Despacha por tipo, para que la ruta no tenga un switch. */
export async function generar(companyId: string, que: TipoReporte, f: Filtro) {
  switch (que) {
    case 'prenomina': return prenomina(companyId, f);
    case 'cfdi':      return cfdi(companyId, f);
    case 'isr':       return isr(companyId, f);
    case 'imss':      return imss(companyId, f);
    default:
      throw new ValidationError(`No existe el reporte "${que}"`);
  }
}

/* ═════════════════ EL MISMO REPORTE, EN EXCEL ═════════════════ */

/**
 * Cualquiera de los cuatro, a hoja de cálculo.
 *
 * Sale de la MISMA función que alimenta la pantalla, no de una consulta
 * paralela: si fueran dos, tarde o temprano dirían cosas distintas y cuadrar
 * uno contra otro se volvería un trabajo en sí mismo.
 */
export async function generarExcel(
  companyId: string,
  que: TipoReporte,
  f: Filtro
): Promise<{ buffer: Buffer; nombre: string }> {
  const XLSX = await import('xlsx');
  const d: any = await generar(companyId, que, f);

  const emp = await query<any>(
    `SELECT business_name, rfc, registro_patronal FROM companies WHERE id = $1`,
    [companyId]
  );
  const e = emp.rows[0] || {};

  const TITULOS: Record<TipoReporte, string> = {
    prenomina: 'Prenómina — detalle de lo pagado',
    cfdi:      'CFDI de nómina — timbrado',
    isr:       'ISR retenido por nómina',
    imss:      'IMSS — cuota obrera',
  };

  const aoa: any[][] = [
    [`GDM NEXO · ${TITULOS[que]}`],
    [],
    ['Empresa:', e.business_name || '', '', 'RFC:', e.rfc || ''],
    ['Registro patronal:', e.registro_patronal || '(sin capturar)', '',
     'Generado:', new Date().toLocaleString('es-MX')],
    ['Periodos:', `${f.tipo} del ${f.desde} al ${f.hasta} de ${f.anio}`],
    ['', 'Sólo periodos CERRADOS, con los importes tal como se pagaron.'],
    [],
  ];

  /* Cada reporte tiene sus columnas; se declaran en un solo lugar para que la
   * hoja y la pantalla no se separen. */
  const COLUMNAS: Record<TipoReporte, Array<[string, string]>> = {
    prenomina: [
      ['periodo', 'Periodo'], ['num_empleado', 'Núm.'], ['nombre', 'Trabajador'],
      ['rfc', 'RFC'], ['dias', 'Días'],
      ['total_percepciones', 'Percepciones'], ['total_gravado', 'Gravado'],
      ['total_exento', 'Exento'], ['imss', 'IMSS'], ['isr', 'ISR'],
      ['total_deducciones', 'Deducciones'], ['neto', 'Neto'],
    ],
    cfdi: [
      ['periodo', 'Periodo'], ['num_empleado', 'Núm.'], ['nombre', 'Trabajador'],
      ['rfc', 'RFC'], ['uuid', 'Folio fiscal (UUID)'],
      ['timbrado_at', 'Timbrado'], ['enviado_at', 'Enviado'], ['neto', 'Neto'],
    ],
    isr: [
      ['num_empleado', 'Núm.'], ['nombre', 'Trabajador'], ['rfc', 'RFC'],
      ['periodos', 'Periodos'], ['gravado', 'Gravado'], ['exento', 'Exento'],
      ['isr', 'ISR retenido'], ['subsidio', 'Subsidio al empleo'],
    ],
    imss: [
      ['num_empleado', 'Núm.'], ['nombre', 'Trabajador'], ['nss', 'NSS'],
      ['periodos', 'Periodos'], ['dias', 'Días'], ['imss', 'Cuota obrera'],
    ],
  };

  const cols = COLUMNAS[que];
  aoa.push(cols.map(([, t]) => t));
  for (const r of d.renglones) {
    aoa.push(cols.map(([k]) => {
      const v = r[k];
      return v === null || v === undefined ? '' : (typeof v === 'number' ? v : v);
    }));
  }

  /* Los totales, con su etiqueta pegada al primer renglón para que se lea. */
  aoa.push([]);
  aoa.push(['TOTALES', ...Object.entries(d.totales).map(([k, v]) => `${k}: ${v}`)]);

  /* El corte por periodo, cuando el reporte lo trae. */
  if (d.porPeriodo?.length) {
    aoa.push([]);
    aoa.push(['POR PERIODO']);
    const claves = Object.keys(d.porPeriodo[0]);
    aoa.push(claves);
    for (const r of d.porPeriodo) aoa.push(claves.map((k) => r[k]));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = cols.map(([k]) =>
    ({ wch: k === 'nombre' ? 30 : k === 'uuid' ? 38 : 14 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, TITULOS[que].slice(0, 28));

  return {
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    nombre: `${que}-${f.tipo.toLowerCase()}-${f.desde}a${f.hasta}-${f.anio}.xlsx`,
  };
}
