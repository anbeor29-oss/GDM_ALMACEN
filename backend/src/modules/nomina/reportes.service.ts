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
import * as patronal from './imss-patronal.service';
import * as ejercicios from './ejercicios.service';

export type TipoReporte = 'prenomina' | 'cfdi' | 'isr' | 'imss';

export interface Filtro {
  anio: number;
  tipo: TipoPeriodo;
  desde: number;
  hasta: number;
  /** Para sacar el reporte de una sola persona. */
  empleadoId?: string;
  /**
   * Un renglón POR TRABAJADOR con sus periodos sumados, en vez de uno por
   * trabajador y periodo. Pedir "de la semana 32 a la 34" y recibir tres
   * renglones de cada quien obliga a sumar a mano lo que el reporte ya sabe.
   */
  acumulado?: boolean;
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

  /* ── Acumulado por trabajador ──
   *
   * Cuando el rango abarca varios periodos, lo que se quiere ver casi siempre
   * es cuánto llevó cada quien EN TODO EL RANGO —para cuadrar contra el banco,
   * para la constancia, para la junta—, no tres renglones que hay que sumar a
   * mano. El detalle sigue estando: es el otro modo.
   *
   * Se agrupa por num_empleado, nombre y rfc y no sólo por el número porque el
   * número es un dato capturado: si dos personas comparten uno, agrupar por él
   * solo las fundiría en un renglón y nadie lo notaría. */
  if (f.acumulado) {
    const r = await query<any>(
      `SELECT r.num_empleado, r.nombre, r.rfc,
              COUNT(*)::int        AS periodos,
              MIN(p.numero)::int   AS primer_periodo,
              MAX(p.numero)::int   AS ultimo_periodo,
              SUM(r.dias)               AS dias,
              SUM(r.total_percepciones) AS total_percepciones,
              SUM(r.total_gravado)      AS total_gravado,
              SUM(r.total_exento)       AS total_exento,
              SUM(r.imss)               AS imss,
              SUM(r.isr)                AS isr,
              SUM(r.total_deducciones)  AS total_deducciones,
              SUM(r.neto)               AS neto
         FROM nomina_recibos r
         JOIN nomina_periodos p ON p.id = r.periodo_id
        WHERE ${cond}
        GROUP BY r.num_empleado, r.nombre, r.rfc
        ORDER BY r.num_empleado`,
      args
    );

    /* Cuántos periodos cerrados hay de verdad en el rango. Sirve para señalar a
     * quien no los trae todos: acumular esconde justo eso —que a alguien le
     * falta una semana— y es lo primero que se pregunta al revisar. */
    const cuantos = await query<any>(
      `SELECT COUNT(DISTINCT p.id)::int AS n
         FROM nomina_recibos r
         JOIN nomina_periodos p ON p.id = r.periodo_id
        WHERE ${cond}`,
      args
    );
    const periodosDelRango = cuantos.rows[0]?.n || 0;

    const renglones = r.rows.map((x: any) => ({
      ...x,
      completo: Number(x.periodos) === periodosDelRango,
    }));
    const incompletos = renglones.filter((x: any) => !x.completo).length;

    const avisos: string[] = [];
    if (incompletos > 0) {
      avisos.push(
        `${incompletos} trabajador(es) no aparecen en los ${periodosDelRango} ` +
        'periodos del rango —altas, bajas o ausencias—. Van marcados: su ' +
        'acumulado es de menos periodos que el resto.'
      );
    }

    return {
      renglones,
      acumulado: true,
      periodosDelRango,
      avisos,
      totales: { ...sumar(renglones), recibos: suma(renglones, 'periodos') },
    };
  }

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
  return {
    renglones: r.rows,
    acumulado: false,
    totales: { ...sumar(r.rows), recibos: r.rows.length },
  };
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

  /* ── La cuota PATRONAL, para provisionar ──
   *
   * Es lo que la nómina le cuesta a la empresa ADEMÁS del sueldo: la obrera se
   * retiene, la patronal sale del bolsillo del patrón y se paga al mes
   * siguiente. Sin este número contabilidad provisiona a ojo.
   *
   * Se calcula aquí y no se guarda en el recibo: el recibo es lo que se le
   * entregó al trabajador, y la cuota patronal no es suya. Además la prima de
   * riesgo puede corregirse después y la provisión debe seguirla. */
  const cuota = await patronal.cargarTasas(f.anio);
  const avisos: string[] = [];
  let porTrabajador = new Map<string, any>();
  let sumaPatronal = {
    emCuotaFija: 0, emExcedente: 0, emDinero: 0, emPensionados: 0,
    invalidezVida: 0, riesgosTrabajo: 0, guarderias: 0, retiro: 0,
    cesantiaVejez: 0, totalImss: 0, infonavit: 0, total: 0,
  };

  if (!cuota) {
    avisos.push(
      `No hay tasas del IMSS cargadas para ${f.anio}, así que no se puede calcular ` +
      'la cuota patronal. Se capturan en Parámetros.'
    );
  } else {
    /* El SBC y los días salen de los recibos: son los que se pagaron. */
    const detalle = await query<any>(
      `SELECT r.num_empleado, e.salario_diario_integrado AS sbc, SUM(r.dias) AS dias
         FROM nomina_recibos r
         JOIN nomina_periodos p ON p.id = r.periodo_id
         LEFT JOIN nomina_empleados e ON e.id = r.empleado_id
        WHERE ${cond}
        GROUP BY r.num_empleado, e.salario_diario_integrado`,
      args
    );

    const ej = await ejercicios.cargar(f.anio).catch(() => null);
    const emp = await query<any>(
      `SELECT prima_riesgo FROM companies WHERE id = $1`, [companyId]
    );
    const prima = emp.rows[0]?.prima_riesgo ?? null;

    if (ej) {
      for (const x of detalle.rows) {
        const c = patronal.calcularPatronal({
          sbc: Number(x.sbc) || 0,
          dias: Number(x.dias) || 0,
          umaDiaria: ej.umaDiaria,
          salarioMinimo: ej.smgGeneral,
          primaRiesgo: prima === null ? null : Number(prima),
          tasas: cuota,
        });
        porTrabajador.set(x.num_empleado, c);
        for (const k of Object.keys(sumaPatronal) as Array<keyof typeof sumaPatronal>) {
          sumaPatronal[k] += (c as any)[k];
        }
        for (const a of c.avisos) if (!avisos.includes(a)) avisos.push(a);
      }
      for (const k of Object.keys(sumaPatronal) as Array<keyof typeof sumaPatronal>) {
        sumaPatronal[k] = redondear(sumaPatronal[k]);
      }
    }
  }

  const renglones = r.rows.map((x: any) => ({
    ...x,
    patronal: porTrabajador.get(x.num_empleado)?.total ?? null,
    cvPorcentaje: porTrabajador.get(x.num_empleado)?.cvPorcentaje ?? null,
  }));

  return {
    renglones,
    porPeriodo: porPeriodo.rows,
    /* El desglose por rama: es como se captura la provisión en contabilidad,
     * una cuenta por rama y no un solo importe. */
    patronal: { ...sumaPatronal, tasas: cuota?.fuente || null },
    avisos,
    totales: {
      trabajadores: r.rows.length,
      sinCuota,
      dias: suma(r.rows, 'dias'),
      imss: redondear(suma(r.rows, 'imss')),
      patronal: sumaPatronal.total,
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
  const {
    ExcelJS, C, titulo, dato, encabezado, celda, totales, anchos, aBuffer,
  } = await import('./estilo-excel');

  const d: any = await generar(companyId, que, f);

  const emp = await query<any>(
    `SELECT business_name, rfc, registro_patronal FROM companies WHERE id = $1`,
    [companyId]
  );
  const e = emp.rows[0] || {};

  const TITULOS: Record<TipoReporte, string> = {
    prenomina: f.acumulado
      ? 'Prenómina — acumulado por trabajador'
      : 'Prenómina — detalle de lo pagado',
    cfdi:      'CFDI de nómina — timbrado',
    isr:       'ISR retenido por nómina',
    imss:      'IMSS — cuota obrera y patronal',
  };

  /* Las columnas de cada reporte, con su color: el mismo criterio de la Lista
   * de Raya —azul lo que entra, rojo lo que se descuenta, verde el neto— para
   * que las cinco hojas se lean igual y se archiven juntas. */
  type Col = {
    k: string; t: string; color: string;
    tinta?: 'base' | 'rojo' | 'verde' | 'gris'; ancho?: number;
  };

  const COLUMNAS: Record<TipoReporte, Col[]> = {
    prenomina: [
      f.acumulado
        ? { k: 'periodos', t: 'PERIODOS', color: C.identidad, ancho: 10 }
        : { k: 'periodo', t: 'PERIODO', color: C.identidad, ancho: 9 },
      { k: 'num_empleado', t: 'NÚM.', color: C.identidad, ancho: 8 },
      { k: 'nombre', t: 'TRABAJADOR', color: C.identidad, ancho: 30 },
      { k: 'dias', t: 'DÍAS', color: C.ingresos, ancho: 7 },
      { k: 'total_percepciones', t: 'TOTAL@PERCEPCIONES', color: C.totalIngresos, ancho: 15 },
      { k: 'total_gravado', t: 'GRAVADO', color: C.ingresos, ancho: 14 },
      { k: 'total_exento', t: 'EXENTO', color: C.ingresos, tinta: 'verde', ancho: 14 },
      { k: 'imss', t: 'IMSS@OBRERO', color: C.descuentos, tinta: 'rojo', ancho: 13 },
      { k: 'isr', t: 'ISR@(ISPT)', color: C.descuentos, tinta: 'rojo', ancho: 13 },
      { k: 'total_deducciones', t: 'TOTAL@DESCUENTOS', color: C.totalDescuentos, tinta: 'rojo', ancho: 15 },
      { k: 'neto', t: 'NETO@A RECIBIR', color: C.neto, tinta: 'verde', ancho: 15 },
    ],
    cfdi: [
      { k: 'periodo', t: 'PERIODO', color: C.identidad, ancho: 9 },
      { k: 'num_empleado', t: 'NÚM.', color: C.identidad, ancho: 8 },
      { k: 'nombre', t: 'TRABAJADOR', color: C.identidad, ancho: 30 },
      { k: 'rfc', t: 'RFC', color: C.identidad, ancho: 15 },
      { k: 'uuid', t: 'FOLIO FISCAL (UUID)', color: C.ingresos, ancho: 40 },
      { k: 'timbrado_at', t: 'TIMBRADO', color: C.ingresos, ancho: 18 },
      { k: 'enviado_at', t: 'ENVIADO', color: C.ingresos, ancho: 18 },
      { k: 'neto', t: 'NETO', color: C.neto, tinta: 'verde', ancho: 15 },
    ],
    isr: [
      { k: 'num_empleado', t: 'NÚM.', color: C.identidad, ancho: 8 },
      { k: 'nombre', t: 'TRABAJADOR', color: C.identidad, ancho: 30 },
      { k: 'rfc', t: 'RFC', color: C.identidad, ancho: 15 },
      { k: 'periodos', t: 'PERIODOS', color: C.ingresos, ancho: 10 },
      { k: 'gravado', t: 'GRAVADO', color: C.ingresos, ancho: 15 },
      { k: 'exento', t: 'EXENTO', color: C.ingresos, tinta: 'verde', ancho: 15 },
      { k: 'isr', t: 'ISR@RETENIDO', color: C.totalDescuentos, tinta: 'rojo', ancho: 15 },
      { k: 'subsidio', t: 'SUBSIDIO@AL EMPLEO', color: C.ingresos, ancho: 15 },
    ],
    imss: [
      { k: 'num_empleado', t: 'NÚM.', color: C.identidad, ancho: 8 },
      { k: 'nombre', t: 'TRABAJADOR', color: C.identidad, ancho: 30 },
      { k: 'nss', t: 'NSS', color: C.identidad, ancho: 16 },
      { k: 'periodos', t: 'PERIODOS', color: C.ingresos, ancho: 10 },
      { k: 'dias', t: 'DÍAS', color: C.ingresos, ancho: 8 },
      { k: 'imss', t: 'CUOTA@OBRERA', color: C.descuentos, tinta: 'rojo', ancho: 15 },
      { k: 'patronal', t: 'CUOTA@PATRONAL', color: C.totalDescuentos, ancho: 16 },
    ],
  };

  const cols = COLUMNAS[que];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'GDM NEXO';
  const ws = wb.addWorksheet(TITULOS[que].slice(0, 28), {
    views: [{ state: 'frozen', ySplit: 8 }],
  });

  titulo(ws, `GDM NEXO · ${TITULOS[que]}`, cols.length);
  dato(ws, 3, 1, `Empresa:   ${e.business_name || ''}`, true);
  dato(ws, 3, 5, `RFC:   ${e.rfc || ''}`);
  dato(ws, 4, 1, `Reg. Patronal:   ${e.registro_patronal || '(sin capturar)'}`);
  dato(ws, 4, 5, `Generado:   ${new Date().toLocaleString('es-MX')}`);
  dato(ws, 5, 1, `Períodos:   ${f.tipo} del ${f.desde} al ${f.hasta} de ${f.anio}`);
  dato(ws, 6, 1, 'Sólo periodos CERRADOS, con los importes tal como se pagaron.');

  encabezado(ws, 8, cols.map((c) => ({ texto: c.t.replace('@', '\n'), color: c.color })));

  let fila = 9;
  for (const r of d.renglones) {
    cols.forEach((c, i) => {
      const v = r[c.k];
      /* Los conteos y los días son cantidades, no dinero: sin formato de pesos
       * para que no salgan como "14.00 días". */
      const esConteo = ['periodos', 'dias', 'periodo'].includes(c.k);
      celda(ws, fila, i + 1,
        v === null || v === undefined ? '' : (esConteo ? Number(v) : v), {
          tinta: c.tinta, pesos: !esConteo, centrado: esConteo,
          negrita: c.k === 'neto',
        });
    });
    fila++;
  }

  totales(ws, fila, cols.map((c) => {
    const t = d.totales || {};
    const mapa: Record<string, any> = {
      nombre: `${d.renglones.length} renglón(es)`,
      total_percepciones: t.percepciones, total_gravado: t.gravado, total_exento: t.exento,
      imss: t.imss, isr: t.isr, total_deducciones: t.deducciones, neto: t.neto,
      gravado: t.gravado, exento: t.exento, subsidio: t.subsidio,
      dias: t.dias, patronal: t.patronal,
    };
    const rojo = ['imss', 'isr', 'total_deducciones'].includes(c.k);
    return {
      valor: mapa[c.k] ?? '',
      fondo: c.k === 'neto' ? C.totalVerde : rojo ? C.totalRojo : C.totalAzul,
      tinta: (c.k === 'neto' ? 'verde' : rojo ? 'rojo' : 'base') as any,
    };
  }));
  fila += 2;

  /* ── El desglose de la cuota patronal, por rama ──
   *
   * Va aparte y desglosado porque así se captura la provisión en contabilidad:
   * una cuenta por rama y no un solo importe. */
  if (que === 'imss' && d.patronal) {
    dato(ws, fila, 1, 'CUOTA PATRONAL — PARA PROVISIONAR', true);
    fila++;
    const RAMAS: Array<[string, string]> = [
      ['emCuotaFija',    'Enfermedad y maternidad · cuota fija (Art. 106-I)'],
      ['emExcedente',    'Enfermedad · excedente de 3 UMA (Art. 106-II)'],
      ['emDinero',       'Prestaciones en dinero (Art. 107)'],
      ['emPensionados',  'Gastos médicos de pensionados (Art. 25)'],
      ['invalidezVida',  'Invalidez y vida (Art. 147)'],
      ['riesgosTrabajo', 'Riesgos de trabajo (Art. 71-73)'],
      ['guarderias',     'Guarderías (Art. 211)'],
      ['retiro',         'Retiro (Art. 168-I)'],
      ['cesantiaVejez',  'Cesantía y vejez (Art. 168-II)'],
      ['totalImss',      'TOTAL IMSS'],
      ['infonavit',      'INFONAVIT 5% (Art. 29-II Ley INFONAVIT)'],
      ['total',          'TOTAL A PROVISIONAR'],
    ];
    for (const [k, etiqueta] of RAMAS) {
      const fuerte = k === 'total' || k === 'totalImss';
      celda(ws, fila, 1, etiqueta, { negrita: fuerte });
      celda(ws, fila, 2, Number(d.patronal[k] || 0), {
        negrita: fuerte, tinta: 'rojo',
        fondo: fuerte ? C.totalRojo : undefined,
      });
      fila++;
    }
    fila++;
    dato(ws, fila, 1,
      'Es una ESTIMACIÓN para provisionar: el IMSS liquida con SUS registros de ' +
      'días cotizados y su prima autorizada. Lo que se paga es lo que emita el SUA.');
    fila += 2;
  }

  if (d.avisos?.length) {
    for (const a of d.avisos) { dato(ws, fila, 1, a); fila++; }
    fila++;
  }

  if (d.porPeriodo?.length) {
    dato(ws, fila, 1, 'POR PERIODO', true);
    fila++;
    const claves = Object.keys(d.porPeriodo[0]);
    encabezado(ws, fila, claves.map((k) => ({
      texto: k.toUpperCase().replace(/_/g, ' '), color: C.identidad,
    })));
    fila++;
    for (const r of d.porPeriodo) {
      claves.forEach((k, i) => {
        const esConteo = ['periodo', 'trabajadores', 'dias'].includes(k);
        celda(ws, fila, i + 1, r[k], { pesos: !esConteo, centrado: esConteo });
      });
      fila++;
    }
  }

  anchos(ws, cols.map((c) => c.ancho || 14));

  return {
    buffer: await aBuffer(wb),
    nombre: `${que}-${f.tipo.toLowerCase()}-${f.desde}a${f.hasta}-${f.anio}.xlsx`,
  };
}
