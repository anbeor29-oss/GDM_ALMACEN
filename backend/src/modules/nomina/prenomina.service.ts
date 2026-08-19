/**
 * prenomina.service — lo que se va a pagar, antes de pagarlo.
 *
 * QUÉ HACE
 * Toma un periodo, junta a los trabajadores que le tocan, y calcula el recibo
 * de cada uno con el motor. Devuelve la rejilla: tipo de nómina, nombre, días
 * trabajados, ingresos, egresos y total a cobrar.
 *
 * NO GUARDA NADA
 * La prenómina se corre veinte veces mientras se ajustan días y conceptos. Si
 * cada corrida escribiera, habría que borrar antes de volver a calcular y una
 * corrida interrumpida dejaría medio periodo pagado y medio no. Se calcula al
 * vuelo y se persiste sólo al cerrar el periodo.
 *
 * A QUIÉN LE TOCA EL PERIODO
 * A quien tenga esa periodicidad en su expediente: el semanal es para los de
 * `periodicidad_pago = 02`, el quincenal para los de `04`, el mensual para los
 * de `05`. Una misma empresa corre las tres, y por eso el filtro es por
 * trabajador y no por empresa.
 *
 * LA NÓMINA ESPECIAL VA A TODOS
 * Un aguinaldo, un reparto de utilidades o un finiquito no siguen la
 * periodicidad de nadie: se decide a quién se le paga. Por eso el especial
 * arranca con la plantilla completa y se desmarca.
 *
 * QUIEN NO TRABAJÓ EL PERIODO NO ENTRA
 * Alguien que ingresó a media quincena, o que causó baja, sólo cobra los días
 * que efectivamente estuvo. Se calculan de la intersección entre el periodo y
 * su relación laboral, no de los días del periodo.
 */

import { query } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';
import * as ejercicios from './ejercicios.service';
import * as periodosSvc from './periodos.service';
import * as finiquitoSvc from './finiquito.service';
import {
  calcularRecibo, EntradaCalculo, Periodicidad, Zona, pesos, partirGravadoExento,
  costoDeFaltas, DEDUCCIONES_POR_DIAS,
} from './motor';

/** Del tipo de periodo a la clave del expediente (c_PeriodicidadPago). */
const PERIODICIDAD_DE_TIPO: Record<string, string> = {
  SEMANAL: '02',
  QUINCENAL: '04',
  MENSUAL: '05',
};

/** Del tipo de periodo al factor de mensualización que usa el motor. */
const PERIODICIDAD_MOTOR: Record<string, Periodicidad> = {
  SEMANAL: 'SEMANAL',
  QUINCENAL: 'QUINCENAL',
  MENSUAL: 'MENSUAL',
  /* Un finiquito o un aguinaldo se calculan sobre base mensual: no tienen una
   * periodicidad propia con la que mensualizar. */
  ESPECIAL: 'MENSUAL',
};

export interface RenglonPrenomina {
  empleado_id: string;
  num_empleado: string;
  nombre: string;
  puesto: string | null;
  departamento: string | null;
  /** Días que le tocan del periodo, ya recortados por ingreso y baja. */
  dias: number;
  diasDelPeriodo: number;
  salario_diario: number;
  sdi: number;
  /* El borrador de este trabajador, para que la pantalla lo reponga al volver.
   * Las faltas viajan en `dias` y sin importe: lo calcula el servidor. */
  capturado?: {
    otrosIngresos: Array<{ clave: string; importe: number; gravadoManual?: number }>;
    otrasDeducciones: Array<{ clave: string; importe?: number; dias?: number }>;
  };
  /* Los bloques de la rejilla, ya separados. Se calculan aquí y no en la
   * pantalla: partir el total en la vista garantizaría que un día la suma de
   * las columnas no cuadre con el neto que se va a pagar. */
  sueldo: number;
  otrosIngresos: number;
  totalPercepciones: number;
  imss: number;
  isr: number;
  prestamos: number;
  otrasDeducciones: number;
  totalDeducciones: number;
  /* Gravado y exento del periodo, antes de sumar. */
  gravado: number;
  exento: number;
  neto: number;
  subsidio: number;
  /* Se conservan por compatibilidad con lo que ya consume la pantalla. */
  ingresos: number;
  egresos: number;
  /** El desglose completo, para el recibo y la vista previa del CFDI. */
  percepciones: any[];
  deducciones: any[];
  /** Lo que impide timbrarle. Vacío = listo. */
  faltantes: string[];
  avisos: string[];
}

/**
 * Días que le corresponden a un trabajador dentro del periodo.
 *
 * Se cruza el periodo con su relación laboral: quien entró el día 10 de una
 * quincena que empieza el 1 cobra 6 días, no 15. Lo mismo al revés con la baja.
 */
export function diasQueLeTocan(
  periodo: { fecha_inicio: string; fecha_fin: string; dias: number },
  empleado: { fecha_ingreso: string; fecha_baja?: string | null; fecha_reingreso?: string | null }
): number {
  const dia = (s: string) => new Date(`${s}T00:00:00Z`).getTime();
  const DIA_MS = 86400000;

  const iniP = dia(periodo.fecha_inicio);
  const finP = dia(periodo.fecha_fin);

  /* El reingreso, cuando existe, es la fecha desde la que vuelve a contar: su
   * ingreso original puede ser de hace años pero estuvo fuera en medio. */
  const desde = Math.max(iniP, dia(empleado.fecha_reingreso || empleado.fecha_ingreso));
  const hasta = empleado.fecha_baja ? Math.min(finP, dia(empleado.fecha_baja)) : finP;

  if (hasta < desde) return 0;
  const dias = Math.round((hasta - desde) / DIA_MS) + 1;
  return Math.min(dias, periodo.dias);
}

/**
 * Lo que se captura a mano sobre un renglón de la rejilla.
 *
 * Son los conceptos del Anexo 20 que NO salen del expediente: las horas extra
 * de esta semana, el bono de este mes, la falta del martes. Viajan con la
 * petición y se recalculan al vuelo — no se guardan hasta cerrar el periodo.
 */
export interface CapturaPorTrabajador {
  empleadoId: string;
  /** Días a pagar, cuando se corrigen a mano (faltas, permisos). */
  dias?: number;
  otrosIngresos?: Array<{ clave: string; importe: number; gravadoManual?: number }>;
  /* `dias` para los conceptos que se capturan en días —las faltas— y que el
   * cálculo convierte a pesos con el salario de cada trabajador. */
  otrasDeducciones?: Array<{ clave: string; concepto?: string; importe?: number; dias?: number }>;
}

/**
 * Arma la prenómina de un periodo. NO escribe nada.
 */
export async function calcular(
  companyId: string,
  periodoId: string,
  opciones: { empleadoIds?: string[]; captura?: CapturaPorTrabajador[] } = {}
) {
  const periodo = await periodosSvc.obtener(companyId, periodoId);

  /* El ejercicio del año del periodo. Si no está cargado, el motor se niega a
   * calcular en vez de usar el del año pasado — y aquí se dice con el periodo
   * a la vista, que es más útil que un error suelto. */
  let ej;
  try {
    ej = await ejercicios.cargar(periodo.anio, periodo.fecha_fin);
  } catch (e: any) {
    throw new ValidationError(
      `No se puede calcular el periodo ${periodo.numero} de ${periodo.anio}: ${e.message}`
    );
  }

  /* Un finiquito de UNA persona que NO trae a quién.
   *
   * Los periodos especiales creados antes de que el finiquito se acotara a un
   * trabajador quedaron sin `empleado_id`, así que la rejilla los llenaba con
   * la plantilla ENTERA y con los días completos del rango: un finiquito de una
   * persona salía con diez trabajadores y un millón de pesos de ingresos. Son
   * cifras que nadie debe creer y que además se pueden cerrar.
   *
   * No se adivina a quién se refería: no se trae a nadie y se explica. */
  const huerfano =
    periodo.tipo === 'ESPECIAL' &&
    !periodo.empleado_id &&
    /finiquito|liquidaci/i.test(String(periodo.concepto || ''));

  const avisosDelPeriodo: string[] = [];
  const meta = await query<any>(
    `SELECT registro_patronal, prima_riesgo, fi_aguinaldo_dias, fi_prima_vac_pct
       FROM companies WHERE id = $1`,
    [companyId]
  );
  const emp = meta.rows[0] || {};
  if (!emp.registro_patronal) {
    avisosDelPeriodo.push(
      'La empresa no tiene capturado su registro patronal del IMSS. Se puede calcular, ' +
      'pero no timbrar. Está en Nómina → Parámetros.'
    );
  }
  if (huerfano) {
    avisosDelPeriodo.push(
      `Este periodo dice "${periodo.concepto}" pero no tiene guardado a quién se ` +
      'liquida: se creó antes de que el finiquito se acotara a una persona. No se ' +
      'calcula nada a propósito — con toda la plantilla y los días completos del ' +
      'rango daría cifras que no son reales.'
    );
    avisosDelPeriodo.push(
      'Vuelve a generarlo desde el expediente del trabajador, con el icono de baja: ' +
      'ese queda ligado a la persona. Este se puede borrar.'
    );
  }

  const confirmado = await query<any>(
    `SELECT confirmado FROM nomina_ejercicios WHERE anio = $1`, [periodo.anio]
  );
  if (confirmado.rows[0] && !confirmado.rows[0].confirmado) {
    avisosDelPeriodo.push(
      `Las tarifas de ${periodo.anio} todavía no están confirmadas contra el DOF. ` +
      'Los importes de ISR de abajo salen de números que nadie ha cotejado.'
    );
  }

  /* ── A quién le toca ── */
  const cond = ['e.company_id = $1', 'e.deleted_at IS NULL'];
  const args: any[] = [companyId];

  /* Sólo quien estuvo activo en algún momento del periodo: alguien que causó
   * baja el año pasado no tiene por qué aparecer en la rejilla de hoy. */
  args.push(periodo.fecha_fin);
  cond.push(`COALESCE(e.fecha_reingreso, e.fecha_ingreso) <= $${args.length}::date`);
  args.push(periodo.fecha_inicio);
  cond.push(`(e.fecha_baja IS NULL OR e.fecha_baja >= $${args.length}::date)`);

  if (periodo.tipo !== 'ESPECIAL') {
    args.push(PERIODICIDAD_DE_TIPO[periodo.tipo]);
    cond.push(`e.periodicidad_pago = $${args.length}`);
  }
  if (opciones.empleadoIds?.length) {
    args.push(opciones.empleadoIds);
    cond.push(`e.id = ANY($${args.length}::uuid[])`);
  }

  /* Un periodo de UNA persona trae UNA persona.
   *
   * Los especiales se pensaron para el aguinaldo y la PTU, que alcanzan a
   * todos, y el finiquito heredó ese comportamiento: al liquidar a alguien la
   * rejilla mostraba la plantilla completa. Quien liquida tenía que confiar en
   * no cerrar por error un periodo que no era el suyo. */
  if (huerfano) {
    cond.push('FALSE');
  }

  if (periodo.empleado_id) {
    args.push(periodo.empleado_id);
    cond.push(`e.id = $${args.length}`);
  }

  /* ── Quiénes entran a un especial ──
   *
   * Un especial no siempre alcanza a todos: puede ser un bono a un turno o una
   * gratificación a tres personas. Si el periodo tiene lista, se respeta; sin
   * lista alcanza a todos, que es como se comportaban antes de que existiera
   * —y como debe seguir comportándose el aguinaldo—. */
  if (periodo.tipo === 'ESPECIAL' && !periodo.empleado_id) {
    args.push(periodo.id);
    cond.push(
      `(NOT EXISTS (SELECT 1 FROM nomina_periodo_empleados pe
                     WHERE pe.periodo_id = $${args.length})
        OR EXISTS (SELECT 1 FROM nomina_periodo_empleados pe
                    WHERE pe.periodo_id = $${args.length} AND pe.empleado_id = e.id))`
    );
  }

  const r = await query<any>(
    `SELECT e.id, e.num_empleado, e.puesto, e.departamento,
            TRIM(e.nombre || ' ' || e.apellido_pat || ' ' || COALESCE(e.apellido_mat,'')) AS nombre,
            e.salario_diario, e.salario_diario_integrado, e.zona_geografica,
            e.nss, e.codigo_postal, e.entidad_federativa, e.tipo_jornada,
            TO_CHAR(e.fecha_ingreso, 'YYYY-MM-DD')   AS fecha_ingreso,
            TO_CHAR(e.fecha_baja, 'YYYY-MM-DD')      AS fecha_baja,
            TO_CHAR(e.fecha_reingreso, 'YYYY-MM-DD') AS fecha_reingreso,
            e.tiene_infonavit, e.infonavit_tipo_descuento, e.infonavit_descuento,
            e.infonavit_seguro_danos,
            e.tiene_pension_alimenticia, e.pension_tipo, e.pension_monto
       FROM nomina_empleados e
      WHERE ${cond.join(' AND ')}
      ORDER BY e.apellido_pat, e.apellido_mat NULLS FIRST, e.nombre`,
    args
  );

  /* Los créditos activos de todos, en UNA consulta.
   *
   * Pedirlos uno por uno dentro del bucle serían cincuenta viajes a la base
   * cada vez que alguien ajusta un día en la rejilla. */
  const creditos = await query<any>(
    `SELECT c.empleado_id, c.id, c.origen, c.descuento_por_periodo, c.saldo, c.numero
       FROM nomina_creditos c
      WHERE c.company_id = $1 AND c.estatus = 'ACTIVO' AND c.saldo > 0`,
    [companyId]
  );
  const porEmpleado = new Map<string, any[]>();
  for (const c of creditos.rows) {
    const l = porEmpleado.get(c.empleado_id) || [];
    l.push(c);
    porEmpleado.set(c.empleado_id, l);
  }

  /* La captura llega indexada por trabajador: buscarla en un arreglo dentro
   * del bucle sería recorrerlo cincuenta veces por cada cincuenta renglones. */
  const capturaDe = new Map<string, CapturaPorTrabajador>();
  /* Lo guardado es la BASE; lo que manda la pantalla va encima, por trabajador.
   *
   * Preferir una sobre otra estaba mal, y costó una tarde. La pantalla manda
   * sólo a quien se acaba de teclear —si abro el diálogo de JUAN, el POST lleva
   * a JUAN y a nadie más—, así que quedarse con esa lista descartaba lo de los
   * otros cuarenta y nueve. En pantalla se veían desaparecer; y al cerrar, los
   * recibos se congelaban sin sus conceptos.
   *
   * Fusionar por empleado resuelve los dos casos: el que viene en el POST se
   * actualiza y el resto conserva lo suyo. */
  const guardada = await leerCaptura(companyId, periodoId);
  for (const c of guardada) capturaDe.set(c.empleadoId, c);
  for (const c of opciones.captura || []) capturaDe.set(c.empleadoId, c);

  /* ── Los conceptos del finiquito ──
   *
   * Se DERIVAN del expediente y de la fecha de baja cada vez que se calcula, no
   * se copiaron al crear el periodo: así, si se corrige la fecha o el sueldo, la
   * cuenta se corrige con ellos en vez de quedar congelada en un número que ya
   * no corresponde. Al cerrar el periodo sí se congelan, en nomina_recibos.
   *
   * Se AGREGAN a lo que el usuario haya capturado a mano, no lo reemplazan: en
   * una liquidación real casi siempre hay algo más —un bono pendiente, un
   * descuento acordado— y perderlo al recalcular sería peor que no derivar
   * nada. */
  if (periodo.finiquito_tipo && periodo.empleado_id) {
    const delFiniquito = await finiquitoSvc.conceptosParaPrenomina(companyId, periodo);
    const previo = capturaDe.get(periodo.empleado_id);
    capturaDe.set(periodo.empleado_id, {
      empleadoId: periodo.empleado_id,
      dias: previo?.dias,
      otrosIngresos: [...delFiniquito, ...(previo?.otrosIngresos || [])],
      otrasDeducciones: previo?.otrasDeducciones || [],
    });
    avisosDelPeriodo.push(
      periodo.finiquito_tipo === 'LIQUIDACION'
        ? 'Liquidación: además de los proporcionales trae la indemnización de tres meses ' +
          'y la prima de antigüedad. Los 20 días del Art. 50 no se incluyen.'
        : 'Finiquito: sólo las partes proporcionales —aguinaldo, vacaciones y su prima—. ' +
          'Si el despido fue injustificado, se pasa como LIQUIDACIÓN.'
    );
  }

  const periodicidad = PERIODICIDAD_MOTOR[periodo.tipo];
  const renglones: RenglonPrenomina[] = [];

  for (const e of r.rows) {
    const cap = capturaDe.get(e.id);
    let dias = diasQueLeTocan(periodo, e);

    /* Los días capturados a mano mandan sobre los del calendario: son las
     * faltas y los permisos, que el sistema no puede saber. Nunca más de los
     * que le tocan — pagarle 10 días de una semana de 7 no es una corrección,
     * es un error de dedo. */
    if (cap?.dias !== undefined && cap.dias !== null) {
      const d = Number(cap.dias);
      if (Number.isFinite(d) && d >= 0) dias = Math.min(d, diasQueLeTocan(periodo, e));
    }
    /* Cero días: estuvo de baja todo el periodo. No se calcula ni se enseña con
     * ceros, que se confundiría con "no se le pagó por error". */
    if (dias <= 0) continue;

    const sd = Number(e.salario_diario) || 0;
    const sdi = Number(e.salario_diario_integrado) || sd;

    /* Los créditos entran como deducciones, sin pasarse del saldo: el último
     * abono casi nunca es completo. */
    const otrasDeducciones = [
      ...(porEmpleado.get(e.id) || []).map((c) => ({
        clave: c.origen === 'FONACOT' ? '011' : '012',
        concepto: c.origen === 'FONACOT'
          ? `FONACOT ${c.numero || ''}`.trim()
          : 'Préstamo de la empresa',
        importe: Math.min(Number(c.descuento_por_periodo), Number(c.saldo)),
      })),
      /* Y lo capturado a mano: faltas, cuotas sindicales, lo que sea.
       *
       * Las faltas llegan en DÍAS y se convierten aquí, con el salario de ESTE
       * trabajador: el mismo número de faltas cuesta distinto a cada quien, así
       * que capturarlas en pesos para varios sería incorrecto por definición.
       * Y cada día faltado se lleva además su parte del séptimo (Art. 69 LFT). */
      ...(cap?.otrasDeducciones || [])
        .map((d: any) => {
          if (Number(d.dias) > 0 && DEDUCCIONES_POR_DIAS.has(d.clave)) {
            const c = costoDeFaltas(Number(d.dias), sd);
            return {
              clave: d.clave,
              concepto:
                `Faltas: ${c.diasDescontados} día(s) + ${c.septimoProporcional.toFixed(2)} ` +
                'del séptimo (Art. 69 LFT)',
              importe: c.importe,
              dias: Number(d.dias),
            };
          }
          return d;
        })
        .filter((d: any) => Number(d.importe) > 0),
    ];

    const entrada: EntradaCalculo = {
      salarioDiario: sd,
      sdi,
      dias,
      zona: (e.zona_geografica as Zona) || 'general',
      periodicidad,
      /* Horas extra, bonos, despensa: cada uno con su exención del Art. 93,
       * que la calcula el motor según el concepto. */
      otrosIngresos: (cap?.otrosIngresos || []).filter((x) => Number(x.importe) > 0),
      otrasDeducciones,
      infonavit: {
        tiene: !!e.tiene_infonavit,
        tipo: e.infonavit_tipo_descuento,
        valor: e.infonavit_descuento === null ? null : Number(e.infonavit_descuento),
        seguroDanosDiario: e.infonavit_seguro_danos === null ? null : Number(e.infonavit_seguro_danos),
      },
      pension: {
        tiene: !!e.tiene_pension_alimenticia,
        tipo: e.pension_tipo,
        monto: e.pension_monto === null ? null : Number(e.pension_monto),
      },
    };

    let recibo;
    try {
      recibo = calcularRecibo(entrada, ej);
    } catch (err: any) {
      /* Un trabajador que no se puede calcular no debe tumbar la rejilla
       * entera: se enseña con el motivo y los demás siguen. */
      renglones.push({
        empleado_id: e.id, num_empleado: e.num_empleado, nombre: e.nombre,
        puesto: e.puesto, departamento: e.departamento,
        dias, diasDelPeriodo: periodo.dias,
        salario_diario: sd, sdi,
        sueldo: 0, otrosIngresos: 0, totalPercepciones: 0,
        imss: 0, isr: 0, prestamos: 0, otrasDeducciones: 0, totalDeducciones: 0,
        gravado: 0, exento: 0,
        ingresos: 0, egresos: 0, neto: 0, subsidio: 0,
        percepciones: [], deducciones: [],
        faltantes: ['no se pudo calcular'],
        avisos: [err.message],
      });
      continue;
    }

    /* Lo que impide TIMBRARLE, que no es lo mismo que lo que impide calcular. */
    const faltantes: string[] = [];
    if (!e.nss) faltantes.push('NSS');
    if (!e.codigo_postal) faltantes.push('CP fiscal');
    if (!e.entidad_federativa) faltantes.push('entidad federativa');
    if (!e.tipo_jornada) faltantes.push('tipo de jornada');
    if (sd <= 0) faltantes.push('salario diario');

    const avisos: string[] = [];
    if (Number(e.salario_diario_integrado) <= 0 && sd > 0) {
      avisos.push('Sin SDI capturado: se usó el salario diario, y eso deja la cuota del IMSS corta.');
    }
    /* Los volteados ya no deberían existir —la migración los enderezó y hay un
     * CHECK—, pero el aviso se queda: si alguno se cuela por una carga vieja,
     * más vale verlo ANTES de cerrar el periodo que después de timbrar. */
    if (Number(e.salario_diario_integrado) > 0 && Number(e.salario_diario_integrado) < sd) {
      avisos.push(
        'El SDI está por debajo del salario diario, cosa imposible (Art. 84 LSS). ' +
        'Parecen invertidos: la cuota del IMSS de este trabajador sale mal.'
      );
    }

    /* Los bloques de la rejilla. El sueldo es la clave 001; todo lo demás que
     * venga en percepciones son "otros ingresos". Los préstamos y el FONACOT se
     * separan del resto de deducciones porque son los que el cierre va a
     * abonar, y verlos aparte es lo que permite cuadrarlos. */
    /* El sueldo es el que el motor MARCÓ, no todo lo que traiga clave 001: las
     * vacaciones de un finiquito y los retroactivos también la usan. */
    const sueldo = recibo.percepciones
      .filter((p) => p.esSueldoDelPeriodo)
      .reduce((a, p) => a + p.importe, 0);
    const otrosIngresos = pesos(recibo.totalPercepciones - sueldo);

    const CLAVES_CREDITO = ['011', '012'];
    const prestamos = recibo.deducciones
      .filter((d) => CLAVES_CREDITO.includes(d.clave))
      .reduce((a, d) => a + d.importe, 0);
    /* Todo lo que no es IMSS, ISR ni crédito: faltas, pensión alimenticia,
     * INFONAVIT, cuotas sindicales. Se llama distinto de la variable de entrada
     * al motor —`otrasDeducciones` es el arreglo que se le manda— para no
     * confundir el importe con la lista. */
    const importeOtrasDeducciones = pesos(
      recibo.totalDeducciones - recibo.imss - recibo.isr - prestamos
    );

    const gravado = pesos(recibo.percepciones.reduce((a, p) => a + (p.gravado || 0), 0));
    const exento  = pesos(recibo.percepciones.reduce((a, p) => a + (p.exento  || 0), 0));

    renglones.push({
      empleado_id: e.id,
      num_empleado: e.num_empleado,
      nombre: e.nombre,
      puesto: e.puesto,
      departamento: e.departamento,
      dias,
      diasDelPeriodo: periodo.dias,
      /* Lo que este trabajador tiene capturado, para que la pantalla lo reponga
       * al volver a entrar en vez de arrancar en blanco — y no mande después un
       * recálculo incompleto. */
      capturado: {
        otrosIngresos: cap?.otrosIngresos || [],
        otrasDeducciones: cap?.otrasDeducciones || [],
      },
      salario_diario: sd,
      sdi,
      sueldo: pesos(sueldo),
      otrosIngresos,
      totalPercepciones: recibo.totalPercepciones,
      imss: recibo.imss,
      isr: recibo.isr,
      prestamos: pesos(prestamos),
      otrasDeducciones: importeOtrasDeducciones,
      totalDeducciones: recibo.totalDeducciones,
      gravado,
      exento,
      ingresos: recibo.totalPercepciones,
      egresos: recibo.totalDeducciones,
      neto: recibo.neto,
      subsidio: recibo.subsidio,
      percepciones: recibo.percepciones,
      deducciones: recibo.deducciones,
      faltantes,
      avisos,
    });
  }

  const suma = (f: (x: RenglonPrenomina) => number) =>
    pesos(renglones.reduce((a, x) => a + f(x), 0));

  return {
    periodo,
    ejercicio: { anio: ej.anio, umaDiaria: ej.umaDiaria, smgGeneral: ej.smgGeneral },
    avisos: avisosDelPeriodo,
    renglones,
    totales: {
      trabajadores: renglones.length,
      sueldo: suma((x) => x.sueldo),
      otrosIngresos: suma((x) => x.otrosIngresos),
      totalPercepciones: suma((x) => x.totalPercepciones),
      prestamos: suma((x) => x.prestamos),
      otrasDeducciones: suma((x) => x.otrasDeducciones),
      totalDeducciones: suma((x) => x.totalDeducciones),
      gravado: suma((x) => x.gravado),
      exento: suma((x) => x.exento),
      ingresos: suma((x) => x.ingresos),
      egresos: suma((x) => x.egresos),
      neto: suma((x) => x.neto),
      isr: suma((x) => x.isr),
      imss: suma((x) => x.imss),
      subsidio: suma((x) => x.subsidio),
      sinPoderTimbrar: renglones.filter((x) => x.faltantes.length > 0).length,
    },
  };
}

/**
 * Cuántos trabajadores le tocan a cada tipo de nómina.
 *
 * Lo usa la pantalla para decir "semanal: 12 personas" antes de generar nada:
 * un tipo con cero trabajadores casi siempre significa que la periodicidad del
 * expediente quedó mal, y verlo antes ahorra generar 53 periodos vacíos.
 */
export async function plantillaPorTipo(companyId: string) {
  const r = await query<any>(
    `SELECT periodicidad_pago, COUNT(*) AS n
       FROM nomina_empleados
      WHERE company_id = $1 AND deleted_at IS NULL AND activo
      GROUP BY periodicidad_pago`,
    [companyId]
  );
  const porClave: Record<string, number> = {};
  for (const x of r.rows) porClave[x.periodicidad_pago] = Number(x.n);

  const total = Object.values(porClave).reduce((a, b) => a + b, 0);
  return {
    SEMANAL: porClave['02'] || 0,
    QUINCENAL: porClave['04'] || 0,
    MENSUAL: porClave['05'] || 0,
    /* El especial alcanza a todos: no sigue la periodicidad de nadie. */
    ESPECIAL: total,
    /* Los que tienen una periodicidad que no corresponde a ningún tipo de
     * periodo —diario, catorcenal, decenal—: no entrarían en ninguna corrida y
     * hay que decirlo en vez de dejarlos fuera en silencio. */
    sinTipo: total - (porClave['02'] || 0) - (porClave['04'] || 0) - (porClave['05'] || 0),
    total,
  };
}

/**
 * Parte en gravado y exento lo que se está capturando, ANTES de aplicarlo.
 *
 * POR QUÉ ESTO VIVE EN EL SERVIDOR
 * La pantalla necesita mostrar cuánto de lo tecleado grava y cuánto no, y la
 * tentación es calcularlo en el navegador con la misma fórmula. Ya nos costó
 * caro una vez: el importe con letra estaba duplicado en dos archivos y el
 * arreglo llegó a uno solo, así que las facturas quedaron bien y los
 * complementos siguieron mal durante meses. Las exenciones del Art. 93 son
 * exactamente el tipo de regla que no puede tener dos copias.
 *
 * Así que la pantalla pregunta y el motor —el único— responde.
 *
 * Las deducciones no se parten: la ley grava ingresos, no descuentos. Se
 * devuelven con su importe para que la pantalla sume, y ya.
 */
export async function partirConceptos(
  companyId: string,
  periodoId: string,
  empleadoId: string,
  lado: 'ingresos' | 'egresos',
  lineas: Array<{ clave: string; importe: number; gravadoManual?: number }>
) {
  const p = await periodosSvc.obtener(companyId, periodoId);
  const ej = await ejercicios.cargar(p.anio, p.fecha_fin);

  const e = await query<any>(
    `SELECT salario_diario, zona_geografica
       FROM nomina_empleados
      WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
    [empleadoId, companyId]
  );
  if (e.rows.length === 0) throw new ValidationError('No encontré a ese trabajador');

  const zona: Zona =
    e.rows[0].zona_geografica === 'frontera_norte' ? 'frontera_norte' : 'general';
  const ctx = {
    ejercicio: ej,
    zona,
    salarioDiario: Number(e.rows[0].salario_diario) || 0,
    dias: Number(p.dias) || 0,
  };

  const detalle = (lineas || [])
    .filter((l) => l && l.clave && Number(l.importe) > 0)
    .map((l) => {
      const importe = Number(l.importe);
      if (lado === 'egresos') {
        return { clave: l.clave, importe, gravado: 0, exento: 0, aplica: false };
      }
      const { gravado, exento } = partirGravadoExento(
        l.clave, importe, ctx,
        l.gravadoManual === undefined || l.gravadoManual === null
          ? undefined
          : Number(l.gravadoManual)
      );
      return { clave: l.clave, importe, gravado, exento, aplica: true };
    });

  const suma = (k: 'importe' | 'gravado' | 'exento') =>
    Math.round(detalle.reduce((a, d) => a + (d as any)[k], 0) * 100) / 100;

  return {
    lado,
    lineas: detalle,
    totales: { importe: suma('importe'), gravado: suma('gravado'), exento: suma('exento') },
  };
}

/* ═════════════════ LA CAPTURA QUE SE QUEDA ═════════════════ */

/**
 * Guarda el borrador de la prenómina.
 *
 * Se llama en cada recálculo, así que tiene que ser barato y ser idempotente:
 * veinte recálculos dejan una fila por trabajador, no veinte. El ON CONFLICT se
 * apoya en el índice único (periodo, empleado).
 *
 * Un trabajador al que se le borran todos los conceptos pierde su fila en vez de
 * quedarse con una vacía: así "no hay captura" y "hay captura vacía" son el
 * mismo estado, que es como lo piensa quien usa la pantalla.
 */
export async function guardarCaptura(
  companyId: string,
  periodoId: string,
  captura: CapturaPorTrabajador[],
  userId?: string
) {
  const p = await periodosSvc.obtener(companyId, periodoId);
  if (p.estatus === 'CERRADO') {
    throw new ValidationError(
      'Ese periodo ya está cerrado: sus importes quedaron congelados en los recibos.'
    );
  }

  let guardados = 0;
  for (const c of captura || []) {
    if (!c?.empleadoId) continue;
    const ingresos = (c.otrosIngresos || []).filter((x: any) => x?.clave && Number(x.importe) > 0);
    /* Las faltas se guardan en DÍAS y sin importe: el importe depende del
     * salario de cada quien y se calcula al armar el recibo. Una línea con días
     * es válida aunque su importe venga en cero. */
    const egresos = (c.otrasDeducciones || []).filter(
      (x: any) => x?.clave && (Number(x.importe) > 0 || Number(x.dias) > 0)
    );
    const dias = c.dias === undefined || c.dias === null || c.dias === ('' as any)
      ? null : Number(c.dias);

    if (ingresos.length === 0 && egresos.length === 0 && dias === null) {
      await query(
        `DELETE FROM nomina_captura WHERE periodo_id = $1 AND empleado_id = $2 AND company_id = $3`,
        [periodoId, c.empleadoId, companyId]
      );
      continue;
    }

    await query(
      `INSERT INTO nomina_captura
         (company_id, periodo_id, empleado_id, dias, otros_ingresos, otras_deducciones, capturado_por)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
       ON CONFLICT (periodo_id, empleado_id) DO UPDATE
         SET dias              = EXCLUDED.dias,
             otros_ingresos    = EXCLUDED.otros_ingresos,
             otras_deducciones = EXCLUDED.otras_deducciones,
             capturado_por     = EXCLUDED.capturado_por,
             updated_at        = NOW()`,
      [companyId, periodoId, c.empleadoId, dias,
       JSON.stringify(ingresos), JSON.stringify(egresos), userId || null]
    );
    guardados++;
  }
  return { guardados };
}

/** Lo capturado que sigue vivo en un periodo. */
export async function leerCaptura(
  companyId: string,
  periodoId: string
): Promise<CapturaPorTrabajador[]> {
  const r = await query<any>(
    `SELECT empleado_id, dias, otros_ingresos, otras_deducciones
       FROM nomina_captura
      WHERE company_id = $1 AND periodo_id = $2`,
    [companyId, periodoId]
  );
  return r.rows.map((x) => ({
    empleadoId: x.empleado_id,
    dias: x.dias === null ? undefined : Number(x.dias),
    otrosIngresos: x.otros_ingresos || [],
    otrasDeducciones: x.otras_deducciones || [],
  }));
}

/** Al cerrar, el borrador ya no sirve: los importes viven en el recibo. */
export async function borrarCaptura(companyId: string, periodoId: string) {
  await query(
    `DELETE FROM nomina_captura WHERE company_id = $1 AND periodo_id = $2`,
    [companyId, periodoId]
  );
}

/**
 * Aplica un concepto a VARIOS trabajadores de un jalón.
 *
 * POR QUÉ EXISTE
 * Un bono de fin de mes o el día del 16 de septiembre le toca a toda la
 * plantilla. Capturarlo de uno en uno en cien renglones no sólo es lento: es
 * donde se cuelan los errores, porque a la mitad uno pierde la cuenta de a
 * quién ya le tocó.
 *
 * SUMA, NO PISA
 * Si el trabajador ya tenía ese concepto capturado, el importe se REEMPLAZA en
 * lugar de sumarse. Aplicar dos veces el mismo bono por error dejaría el doble
 * sin que se note; reemplazar es idempotente y se ve en pantalla. Lo demás que
 * tuviera capturado se respeta.
 *
 * NO CALCULA NADA
 * Sólo escribe el borrador. El recálculo va después y por su camino de siempre,
 * con las exenciones del Art. 93 que correspondan a la clave.
 */
export async function aplicarAVarios(
  companyId: string,
  periodoId: string,
  d: {
    lado: 'ingresos' | 'egresos';
    clave: string;
    importe?: number;
    /** Para las faltas, que se capturan en días. */
    dias?: number;
    empleadoIds: string[];
    gravadoManual?: number;
  },
  userId?: string
) {
  const p = await periodosSvc.obtener(companyId, periodoId);
  if (p.estatus === 'CERRADO') {
    throw new ValidationError('Ese periodo ya está cerrado: sus importes no se mueven.');
  }
  if (!d.clave) throw new ValidationError('Falta el concepto');

  /* Las faltas se piden en DÍAS, no en pesos. Es la única forma correcta de
   * aplicarlas a varios: el mismo día de ausencia le cuesta distinto a cada
   * quien, y un importe fijo le descontaría lo mismo al de $315 que al de $600.
   * El importe se calcula por trabajador al armar el recibo, con su salario y
   * con la parte del séptimo día que manda el Art. 69 LFT. */
  const porDias = DEDUCCIONES_POR_DIAS.has(d.clave) && d.lado === 'egresos';
  const dias = Number(d.dias);
  const importe = Number(d.importe);

  if (porDias) {
    if (!Number.isFinite(dias) || dias <= 0) {
      throw new ValidationError('Las faltas se capturan en días: pon cuántos días faltó');
    }
    if (dias > 31) {
      throw new ValidationError('No se pueden capturar más de 31 días de falta');
    }
  } else if (!Number.isFinite(importe) || importe <= 0) {
    throw new ValidationError('El importe tiene que ser mayor que cero');
  }
  const ids = (d.empleadoIds || []).filter(Boolean);
  if (ids.length === 0) throw new ValidationError('No elegiste a ningún trabajador');

  /* Que todos sean de ESTA empresa. Sin esta comprobación, un id ajeno pegado a
   * mano escribiría en el borrador de otra. */
  const suyos = await query<any>(
    `SELECT id FROM nomina_empleados
      WHERE company_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
    [companyId, ids]
  );
  if (suyos.rows.length !== ids.length) {
    throw new ValidationError('Alguno de los trabajadores no es de esta empresa');
  }

  const previas = await leerCaptura(companyId, periodoId);
  const porEmpleado = new Map(previas.map((c) => [c.empleadoId, c]));

  const campo = d.lado === 'ingresos' ? 'otrosIngresos' : 'otrasDeducciones';
  const nuevas: CapturaPorTrabajador[] = [];

  for (const id of ids) {
    const previa = porEmpleado.get(id) || {
      empleadoId: id, otrosIngresos: [], otrasDeducciones: [],
    } as CapturaPorTrabajador;

    const lista = [...((previa as any)[campo] || [])].filter(
      (x: any) => x.clave !== d.clave
    );
    lista.push(
      porDias
        ? { clave: d.clave, dias }
        : {
            clave: d.clave,
            importe,
            ...(d.gravadoManual !== undefined && d.gravadoManual !== null
              ? { gravadoManual: Number(d.gravadoManual) }
              : {}),
          }
    );

    nuevas.push({ ...previa, [campo]: lista } as CapturaPorTrabajador);
  }

  await guardarCaptura(companyId, periodoId, nuevas, userId);
  return { aplicados: nuevas.length, clave: d.clave, importe, dias: porDias ? dias : undefined };
}
