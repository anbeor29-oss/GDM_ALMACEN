/**
 * motor — el cálculo de la nómina.
 *
 * POR QUÉ ESTÁ AQUÍ Y NO EN LA PANTALLA
 * En el sistema anterior estas fórmulas vivían dentro de nomina.html, en el
 * navegador. Eso significa dos cosas: que cualquiera puede cambiar su propio
 * ISR desde la consola, y que si un día alguien abre la pantalla con otra
 * versión del archivo en caché, calcula distinto sin que nadie se entere. El
 * cálculo de un impuesto retenido no puede estar del lado del cliente.
 *
 * ESTE ARCHIVO NO TOCA LA BASE DE DATOS
 * Recibe los parámetros del ejercicio ya cargados y devuelve el resultado. Así
 * se puede probar contra casos conocidos sin levantar Postgres, que es la única
 * forma de tener confianza en algo que decide cuánto se le retiene a cada
 * persona.
 *
 * LAS TARIFAS NO SE INVENTAN NI SE INTERPOLAN
 * Entran como parámetro desde `nomina_ejercicios`. Si falta el ejercicio, el
 * motor se niega a calcular en vez de suponer el del año pasado.
 *
 * FUNDAMENTO DE LAS EXENCIONES (portado íntegro del sistema anterior)
 *
 *   ISR   Art. 93 Fr. XIV LISR — los ingresos equivalentes al salario mínimo
 *         general del área del trabajador NO causan impuesto. Respaldo
 *         constitucional: Art. 123 Ap. A Fr. VI CPEUM.
 *   IMSS  Art. 36 LSS — con salario base igual al mínimo, el asegurado queda
 *         exento de cubrir cuotas obreras.
 *
 *   La exención del Art. 93 Fr. XIV es del TRABAJADOR que gana el mínimo, no
 *   del concepto: si además recibe otro ingreso gravado, pierde la exención y
 *   la base incluye el salario. Esa regla se conserva tal cual.
 */

/* ═══════════════════ LO QUE EL MOTOR NECESITA SABER ═══════════════════ */

export interface RenglonTarifa {
  limite_inferior: number;
  limite_superior: number | null;
  cuota_fija: number;
  porcentaje: number;   // en por ciento: 6.40, no 0.064
}

export interface RenglonSubsidio {
  limite_inferior: number;
  limite_superior: number | null;
  subsidio: number;
  /* Desde 2026 el decreto trae un porcentaje distinto para enero, así que un
   * ejercicio puede tener dos renglones con el mismo rango y distinta vigencia.
   * El cálculo no las mira —quien carga el ejercicio ya eligió el renglón que
   * toca—, pero la revisión sí las necesita para no leer dos vigencias como si
   * fueran dos escalones de una misma escalera. */
  vigente_desde?: string | null;
  vigente_hasta?: string | null;
  porcentaje_uma?: number | null;
}

export interface Ejercicio {
  anio: number;
  umaDiaria: number;
  umaMensual: number;
  /* Unidad Mixta Infonavit. Base de los créditos en VSM desde la reforma de
   * 2016 — no el salario mínimo. Opcional porque los ejercicios anteriores a
   * esta migración no la traen; si falta, el descuento en VSM se detiene en vez
   * de calcularse con el número equivocado. */
  umiDiaria?: number | null;
  smgGeneral: number;
  smgFrontera: number;
  tarifaIsr: RenglonTarifa[];
  subsidio: RenglonSubsidio[];
}

export type Periodicidad = 'SEMANAL' | 'QUINCENAL' | 'MENSUAL';
export type Zona = 'general' | 'frontera_norte';

/**
 * Factor de mensualización.
 *
 * 30.4 es el promedio de días por mes (365/12). El sistema anterior calcula
 * así, y se conserva: cambiarlo a las tarifas por periodicidad del Anexo 8
 * movería el ISR de toda la plantilla sin que nadie lo hubiera pedido.
 */
export const FACTOR: Record<Periodicidad, number> = {
  SEMANAL:   30.4 / 7,
  QUINCENAL: 30.4 / 15,
  MENSUAL:   1,
};

/** Días que se pagan en un periodo completo. */
export const DIAS_PERIODO: Record<Periodicidad, number> = {
  SEMANAL: 7, QUINCENAL: 15, MENSUAL: 30,
};

export function smgDeZona(e: Ejercicio, zona: Zona): number {
  return zona === 'frontera_norte' ? e.smgFrontera : e.smgGeneral;
}

/** Redondeo a centavos. Se hace en cada renglón del recibo, no al final. */
export function pesos(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/* ═══════════════════ CONCEPTOS Y SUS EXENCIONES ═══════════════════ */

/**
 * Cómo se grava cada concepto — catálogo portado del sistema anterior.
 *
 *   exento_total      no causa ISR
 *   gravado_total     grava por completo
 *   smg               exento hasta N veces el salario mínimo (Art. 93 Fr. XIV)
 *   uma_diaria        exento hasta factor × UMA diaria × días
 *   uma_mensual_pct   exento hasta factor × UMA mensual
 *   sal_pct           exento hasta factor × salario diario × días
 *   manual            lo decide quien captura (horas extra, primas, finiquitos)
 */
export type FormaDeGravar =
  | 'exento_total' | 'gravado_total' | 'smg'
  | 'uma_diaria' | 'uma_mensual_pct' | 'sal_pct' | 'manual';

export interface ConceptoPercepcion {
  /** Clave del c_TipoPercepcion del Anexo 20. */
  clave: string;
  nombre: string;
  tipo: FormaDeGravar;
  factor?: number;
}

export const PERCEPCIONES: ConceptoPercepcion[] = [
  { clave: '014', nombre: 'Cuotas sindicales pagadas por el patrón', tipo: 'exento_total' },
  { clave: '050', nombre: 'Viáticos comprobados',                    tipo: 'exento_total' },
  { clave: '024', nombre: 'Seguro de retiro / vida',                  tipo: 'exento_total' },
  { clave: '028', nombre: 'Seguro de gastos médicos mayores',         tipo: 'exento_total' },
  { clave: '004', nombre: 'Reembolso de gastos médicos',              tipo: 'exento_total' },
  { clave: '029', nombre: 'Subsidio por incapacidad',                 tipo: 'exento_total' },
  { clave: '030', nombre: 'Becas educativas',                         tipo: 'exento_total' },
  { clave: '036', nombre: 'Ayuda para anteojos / dental',             tipo: 'exento_total' },
  { clave: '038', nombre: 'Ayuda para gastos de funeral',             tipo: 'exento_total' },
  { clave: '035', nombre: 'Ayuda para artículos escolares',           tipo: 'exento_total' },

  { clave: '050NC', nombre: 'Viáticos NO comprobados',                tipo: 'gravado_total' },
  { clave: '012', nombre: 'Gratificaciones / bonos',                  tipo: 'gravado_total' },
  { clave: '046', nombre: 'Comisiones',                               tipo: 'gravado_total' },
  { clave: '039', nombre: 'Otros ingresos gravados',                  tipo: 'gravado_total' },

  { clave: '002', nombre: 'Aguinaldo',        tipo: 'smg', factor: 30 },
  { clave: '021', nombre: 'Prima vacacional', tipo: 'smg', factor: 15 },
  { clave: '003', nombre: 'PTU',              tipo: 'smg', factor: 15 },

  { clave: '047', nombre: 'Alimentación',            tipo: 'uma_diaria', factor: 0.40 },
  { clave: '040', nombre: 'Jubilaciones y pensiones', tipo: 'uma_diaria', factor: 15 },

  { clave: '015', nombre: 'Vales de despensa', tipo: 'uma_mensual_pct', factor: 0.40 },

  { clave: '048', nombre: 'Habitación',             tipo: 'sal_pct', factor: 0.10 },
  { clave: '010', nombre: 'Premios de puntualidad', tipo: 'sal_pct', factor: 0.10 },
  { clave: '049', nombre: 'Premios de asistencia',  tipo: 'sal_pct', factor: 0.10 },

  { clave: '019', nombre: 'Horas extras',          tipo: 'manual' },
  { clave: '020', nombre: 'Prima dominical',       tipo: 'manual' },
  { clave: '022', nombre: 'Prima de antigüedad',   tipo: 'manual' },
  { clave: '025', nombre: 'Indemnización',         tipo: 'manual' },
  { clave: '006', nombre: 'Caja / fondo de ahorro', tipo: 'manual' },
  { clave: '037', nombre: 'Ayuda para transporte', tipo: 'manual' },
  { clave: '023', nombre: 'Pagos por separación',  tipo: 'manual' },
];

/** Deducciones que se capturan a mano (las calculadas no van aquí). */
export const DEDUCCIONES: Array<{ clave: string; nombre: string }> = [
  { clave: '011', nombre: 'Cuota FONACOT' },
  { clave: '020', nombre: 'Faltas y retardos (ausencias)' },
  { clave: '007', nombre: 'Pensión alimenticia' },
  { clave: '012', nombre: 'Anticipo de salarios / préstamos' },
  { clave: '017', nombre: 'Adquisición de artículos de la empresa' },
  { clave: '018', nombre: 'Fondo de ahorro (cuota del trabajador)' },
  { clave: '019', nombre: 'Cuotas sindicales' },
  { clave: '013', nombre: 'Pagos hechos con exceso al trabajador' },
  { clave: '016', nombre: 'Descuento por daños o averías' },
  { clave: '004', nombre: 'Otros descuentos' },
  { clave: '006', nombre: 'Descuento por incapacidad' },
  { clave: '008', nombre: 'Renta' },
];

const PERCEPCION_POR_CLAVE = new Map(PERCEPCIONES.map((p) => [p.clave, p]));

/**
 * Parte un importe en gravado y exento, según la regla del concepto.
 *
 * `gravadoManual` sólo se usa en los conceptos de tipo 'manual', donde la ley
 * no fija una exención automática y la decide quien captura.
 */
export function partirGravadoExento(
  claveConcepto: string,
  importe: number,
  ctx: { ejercicio: Ejercicio; zona: Zona; salarioDiario: number; dias: number },
  gravadoManual?: number
): { gravado: number; exento: number } {
  const imp = Number(importe) || 0;
  if (imp <= 0) return { gravado: 0, exento: 0 };

  const c = PERCEPCION_POR_CLAVE.get(claveConcepto);
  /* Un concepto que no está en el catálogo se grava completo, que es la
   * postura conservadora: gravar de más se corrige, no retener se paga. */
  if (!c) return { gravado: pesos(imp), exento: 0 };

  const { ejercicio: e, zona, salarioDiario, dias } = ctx;
  const f = c.factor ?? 0;
  let gravado: number;

  switch (c.tipo) {
    case 'exento_total':    gravado = 0; break;
    case 'gravado_total':   gravado = imp; break;
    case 'smg':             gravado = Math.max(0, imp - f * smgDeZona(e, zona)); break;
    case 'uma_diaria':      gravado = Math.max(0, imp - f * e.umaDiaria * dias); break;
    case 'uma_mensual_pct': gravado = Math.max(0, imp - f * e.umaMensual); break;
    case 'sal_pct':         gravado = Math.max(0, imp - f * salarioDiario * dias); break;
    case 'manual':
      gravado = gravadoManual === undefined ? imp : Math.min(Math.max(0, gravadoManual), imp);
      break;
    default:                gravado = imp;
  }

  gravado = pesos(Math.min(gravado, imp));
  return { gravado, exento: pesos(imp - gravado) };
}

/**
 * Lo que cuesta faltar: el día perdido MÁS su parte del séptimo.
 *
 * EL ART. 69 LFT
 * Por cada seis días de trabajo corresponde uno de descanso, y ese séptimo se
 * paga con salario íntegro (Art. 72). Quien no completa sus seis días no se
 * ganó el séptimo completo: pierde la sexta parte por cada día que faltó.
 *
 *     descuento = faltas × (1 + 1/6) × salario diario
 *
 * La cuenta se sostiene sola en el extremo: con SEIS faltas el trabajador
 * pierde 6 + 6/6 = SIETE días, o sea la semana entera con su día de descanso.
 * Es la comprobación que hay que hacer si alguien duda de la fórmula.
 *
 * POR QUÉ SE CAPTURAN DÍAS Y NO PESOS
 * Porque el costo depende del salario de CADA quien. Un importe fijo aplicado a
 * media plantilla —que es como se capturan las faltas de la semana— le
 * descontaría lo mismo al de $315 que al de $600, y los dos estarían mal.
 * Con días, cada recibo lo convierte con su propio salario.
 *
 * NO SE TOPA AQUÍ
 * Seis faltas en una semana ya son la semana completa; más que eso lo decide
 * quien captura, no esta función, porque en periodos quincenales y mensuales
 * los días faltados sí pasan de seis.
 */
export function costoDeFaltas(dias: number, salarioDiario: number): {
  diasDescontados: number;
  septimoProporcional: number;
  importe: number;
} {
  const faltas = Number(dias) || 0;
  const diario = Number(salarioDiario) || 0;
  if (faltas <= 0 || diario <= 0) {
    return { diasDescontados: 0, septimoProporcional: 0, importe: 0 };
  }
  const septimo = faltas / 6;
  return {
    diasDescontados: faltas,
    septimoProporcional: Math.round(septimo * 10000) / 10000,
    importe: pesos((faltas + septimo) * diario),
  };
}

/** Las deducciones que se capturan en DÍAS y no en pesos. */
export const DEDUCCIONES_POR_DIAS = new Set(['020']);   // faltas y retardos

/* ═══════════════════ ISR / SUBSIDIO ═══════════════════ */

/**
 * ISR del periodo por el Art. 96 LISR.
 *
 * La base se mensualiza, se busca el renglón, se resta el subsidio y el
 * resultado se devuelve a la escala del periodo. El subsidio NUNCA hace que el
 * ISR sea negativo: `Math.max(…, 0)`. Lo que sobra del subsidio se entrega
 * como "subsidio al empleo" y se reporta aparte, no como un ISR en contra.
 */
export function calcularIsr(
  baseGravablePeriodo: number,
  periodicidad: Periodicidad,
  e: Ejercicio,
  opts: { sinSubsidio?: boolean } = {}
): { isr: number; subsidio: number; baseMensual: number; renglon: number | null } {
  const base = Number(baseGravablePeriodo) || 0;
  if (base <= 0) return { isr: 0, subsidio: 0, baseMensual: 0, renglon: null };

  if (!e.tarifaIsr?.length) {
    throw new Error(
      `No hay tarifa del Art. 96 cargada para ${e.anio}. El cálculo se detiene: ` +
      'usar la del año pasado retendría de más o de menos a toda la plantilla.'
    );
  }

  const f = FACTOR[periodicidad];
  const baseMensual = base * f;

  /* Renglones ordenados: gana el último cuyo límite inferior no rebasa la
   * base. Se ordena aquí y no se confía en el orden con que vinieron. */
  const tarifa = [...e.tarifaIsr].sort((a, b) => a.limite_inferior - b.limite_inferior);
  let isrMensual = 0;
  let indice: number | null = null;
  for (let i = 0; i < tarifa.length; i++) {
    const r = tarifa[i];
    if (baseMensual >= r.limite_inferior) {
      isrMensual = r.cuota_fija + (baseMensual - r.limite_inferior) * (r.porcentaje / 100);
      indice = i + 1;
    } else break;
  }

  /* En asimilados NO hay subsidio al empleo bajo ninguna circunstancia: es un
   * beneficio de la relación laboral, y el asimilado no la tiene. */
  let subsidioMensual = 0;
  if (!opts.sinSubsidio) {
    for (const s of e.subsidio || []) {
      const dentro = baseMensual >= s.limite_inferior &&
        (s.limite_superior === null || baseMensual <= s.limite_superior);
      if (dentro) { subsidioMensual = s.subsidio; break; }
    }
  }

  const netoMensual = Math.max(isrMensual - subsidioMensual, 0);
  /* El subsidio que realmente se aplicó — no el de la tabla: si el ISR era
   * menor, sólo se usó una parte. */
  const subsidioAplicado = Math.min(subsidioMensual, isrMensual);

  return {
    isr: pesos(netoMensual / f),
    subsidio: pesos(subsidioAplicado / f),
    baseMensual: pesos(baseMensual),
    renglon: indice,
  };
}

/* ═══════════════════ CUOTAS DEL IMSS (parte obrera) ═══════════════════ */

/**
 * Cuota obrera del periodo.
 *
 * Tres conceptos, con los porcentajes de la LSS:
 *   · Excedente de 3 UMA en Enfermedades y Maternidad — 0.40 % (Art. 106 Fr. II)
 *   · Invalidez y Vida                                — 0.625 % (Art. 147)
 *   · Cesantía y Vejez                                — 1.125 % (Art. 168 Fr. III)
 *
 * Con salario diario igual o menor al mínimo la cuota obrera es CERO
 * (Art. 36 LSS): el patrón la absorbe. Esa comparación se hace contra el
 * salario diario, no contra el integrado, igual que en el sistema anterior.
 */
export function calcularImssObrero(
  salarioDiario: number,
  sdi: number,
  dias: number,
  zona: Zona,
  e: Ejercicio
): { total: number; excedente: number; invalidezVida: number; cesantiaVejez: number } {
  const cero = { total: 0, excedente: 0, invalidezVida: 0, cesantiaVejez: 0 };
  if (salarioDiario <= smgDeZona(e, zona)) return cero;
  if (sdi <= 0 || dias <= 0) return cero;

  /* El SBC se topa a 25 UMA (Art. 28 LSS).
   *
   * `calcularSdi` ya lo topa cuando el sistema propone un SDI, pero aquí llega
   * el que está CAPTURADO en el expediente —a mano o traído de un XML—, y ese
   * puede venir por encima del tope. Cotizar sobre él le retiene de más al
   * trabajador y descuadra la liquidación mensual contra el IMSS, que sí topa.
   * Sólo muerde en sueldos altos: con la UMA de 2026 el tope son $2,932.75
   * diarios. */
  const topeSbc = e.umaDiaria * 25;
  const base = Math.min(sdi, topeSbc);

  const tresUma = e.umaDiaria * 3;
  const excedente     = base > tresUma ? (base - tresUma) * 0.004 * dias : 0;
  const invalidezVida = base * 0.00625 * dias;
  const cesantiaVejez = base * 0.01125 * dias;

  return {
    excedente: pesos(excedente),
    invalidezVida: pesos(invalidezVida),
    cesantiaVejez: pesos(cesantiaVejez),
    total: pesos(excedente + invalidezVida + cesantiaVejez),
  };
}

/* ═══════════════════ INFONAVIT Y PENSIÓN ═══════════════════ */

export interface DatosInfonavit {
  tiene: boolean;
  tipo?: 'porcentaje' | 'cuota_fija' | 'vsm' | null;
  valor?: number | null;
  seguroDanosDiario?: number | null;
}

/**
 * Descuento de INFONAVIT del periodo (Art. 29 Fr. III Ley del INFONAVIT).
 *
 * Las cuotas fijas y las VSM vienen expresadas MENSUALMENTE en la carta del
 * INFONAVIT, así que se prorratean con días/30.4 — el mismo promedio que usa
 * la mensualización del ISR, para no mezclar dos convenciones de mes.
 */
export function calcularInfonavit(
  d: DatosInfonavit,
  sdi: number,
  dias: number,
  zona: Zona,
  e: Ejercicio
): { total: number; credito: number; seguroDanos: number } {
  const nada = { total: 0, credito: 0, seguroDanos: 0 };
  if (!d?.tiene || !d.valor || !d.tipo) return nada;

  const v = Number(d.valor) || 0;
  let credito = 0;
  switch (d.tipo) {
    case 'porcentaje': credito = sdi * (v / 100) * dias; break;
    case 'cuota_fija': credito = v * (dias / 30.4); break;
    /* VSM va con la UMI, NO con el salario mínimo.
     *
     * La reforma de 2016 a la Ley del INFONAVIT desligó los créditos en Veces
     * Salario Mínimo del mínimo justamente para que sus alzas no inflaran la
     * deuda; para eso se creó la Unidad Mixta Infonavit. Con los valores de
     * 2026 —mínimo $315.04 contra UMI $100.81— usar el mínimo le descontaría
     * al trabajador más del triple, y la brecha crece cada año porque el
     * mínimo sube y la UMI lleva tres ejercicios congelada.
     *
     * Si el ejercicio no trae UMI cargada no se adivina: se truena. Descontar
     * de más el crédito de una casa no es un error que se arregle después. */
    case 'vsm': {
      const umi = Number(e.umiDiaria) || 0;
      if (umi <= 0) {
        throw new Error(
          `No hay UMI cargada para ${e.anio}. Los créditos del INFONAVIT en VSM ` +
          'se calculan con la Unidad Mixta Infonavit, no con el salario mínimo. ' +
          'Captúrala en Nómina → Parámetros.'
        );
      }
      credito = umi * v * (dias / 30.4);
      break;
    }
  }

  const seguroDanos = (Number(d.seguroDanosDiario) || 0) * dias;
  return {
    credito: pesos(credito),
    seguroDanos: pesos(seguroDanos),
    total: pesos(credito + seguroDanos),
  };
}

export interface DatosPension {
  tiene: boolean;
  tipo?: 'porcentaje' | 'cuota_fija' | null;
  monto?: number | null;
}

/**
 * Pensión alimenticia (Art. 110 Fr. V LFT).
 *
 * Se calcula sobre el TOTAL de percepciones brutas salvo que el oficio diga
 * otra cosa. Viene de una orden judicial: el sistema la aplica como está
 * capturada y no la ajusta por su cuenta.
 */
export function calcularPension(
  d: DatosPension,
  totalPercepcionesBrutas: number,
  dias: number
): number {
  if (!d?.tiene || !d.monto || !d.tipo) return 0;
  const m = Number(d.monto) || 0;
  if (d.tipo === 'porcentaje') return pesos(totalPercepcionesBrutas * (m / 100));
  return pesos(m * (dias / 30.4));
}

/* ═══════════════════ EL RECIBO COMPLETO ═══════════════════ */

export interface OtroIngreso {
  clave: string;
  importe: number;
  /** Sólo para conceptos 'manual'. */
  gravadoManual?: number;
}

export interface OtraDeduccion {
  clave: string;
  concepto?: string;
  importe: number;
}

export interface EntradaCalculo {
  salarioDiario: number;
  sdi: number;
  dias: number;
  zona: Zona;
  periodicidad: Periodicidad;
  otrosIngresos?: OtroIngreso[];
  otrasDeducciones?: OtraDeduccion[];
  infonavit?: DatosInfonavit;
  pension?: DatosPension;
  /** Asimilados a salarios: ISR mensual sobre el ingreso, SIN subsidio y sin
   *  IMSS. El ingreso va como "otros ingresos" y es totalmente gravable. */
  asimilado?: boolean;
}

export interface Percepcion {
  clave: string; concepto: string; gravado: number; exento: number; importe: number;
  /* Marca el sueldo del periodo — el que sale de salario × días.
   *
   * No basta con mirar la clave: la 001 también la usan las vacaciones no
   * disfrutadas de un finiquito y cualquier retroactivo de sueldo capturado a
   * mano, porque para el SAT todos son salario. Distinguirlos por clave hacía
   * que la columna "Ingresos" de la rejilla los sumara al sueldo y
   * desaparecieran de "Otros ingresos": el total quedaba bien y el desglose
   * mentía. */
  esSueldoDelPeriodo?: boolean;
}
export interface Deduccion {
  clave: string; concepto: string; importe: number;
  /**
   * De qué entrega salió este descuento, cuando lo generó un uniforme o equipo
   * con costo.
   *
   * No es un dato fiscal y no viaja al CFDI: sirve para que el cierre pueda
   * marcar EXACTAMENTE lo que se cobró. Sin él habría que volver a deducir qué
   * entregas entraron, y esa segunda deducción es justo donde se cuela el
   * cobro doble.
   */
  entregaId?: string;
}

export interface Recibo {
  percepciones: Percepcion[];
  deducciones: Deduccion[];
  totalPercepciones: number;
  totalDeducciones: number;
  totalOtrosPagos: number;
  baseGravable: number;
  isr: number;
  subsidio: number;
  imss: number;
  neto: number;
  /* Para poder explicar el número en pantalla sin recalcular. */
  detalle: {
    sueldoPeriodo: number;
    sueldoExentoPorSalarioMinimo: boolean;
    baseMensualizada: number;
    renglonTarifa: number | null;
    imssDesglose: ReturnType<typeof calcularImssObrero>;
    infonavitDesglose: ReturnType<typeof calcularInfonavit>;
  };
}

/**
 * Calcula el recibo de un trabajador en un periodo.
 *
 * LA REGLA DEL SALARIO MÍNIMO, CON CUIDADO
 * El Art. 93 Fr. XIV exime al TRABAJADOR que gana el mínimo, no al concepto.
 * Si además recibe cualquier otro ingreso gravado, pierde la exención y la
 * base incluye el sueldo. Es la regla del sistema anterior, conservada letra
 * por letra porque cambiarla movería la retención de la parte más vulnerable
 * de la plantilla.
 */
export function calcularRecibo(entrada: EntradaCalculo, e: Ejercicio): Recibo {
  const { salarioDiario, sdi, dias, zona, periodicidad, asimilado } = entrada;
  if (dias <= 0) throw new Error('El periodo no puede tener cero días pagados');

  const ctx = { ejercicio: e, zona, salarioDiario, dias };

  /* ── Sueldo del periodo (P001) ── */
  const sueldo = pesos(salarioDiario * dias);

  /* ── Otros ingresos, cada uno con su exención ── */
  const percepciones: Percepcion[] = [];
  let gravadoOtros = 0;
  let totalOtros = 0;

  for (const oi of entrada.otrosIngresos || []) {
    const imp = Number(oi.importe) || 0;
    if (imp <= 0) continue;
    /* Asimilados: el ingreso es totalmente gravable, sin la exención del Art. 93
     * (que es de la relación laboral). Se aplica el ISR al ingreso completo. */
    const { gravado, exento } = asimilado
      ? { gravado: pesos(imp), exento: 0 }
      : partirGravadoExento(oi.clave, imp, ctx, oi.gravadoManual);
    const cat = PERCEPCION_POR_CLAVE.get(oi.clave);
    percepciones.push({
      /* Los viáticos no comprobados se capturan como '050NC' para poder
       * distinguirlos, pero en el CFDI son la clave 050 del catálogo. */
      clave: oi.clave === '050NC' ? '050' : oi.clave,
      concepto: cat?.nombre || 'Otro ingreso',
      gravado, exento, importe: pesos(imp),
    });
    gravadoOtros += gravado;
    totalOtros += imp;
  }
  gravadoOtros = pesos(gravadoOtros);

  /* ── La exención del salario mínimo ── */
  const ganaMinimo = salarioDiario <= smgDeZona(e, zona);
  const sueldoExento = ganaMinimo && gravadoOtros === 0;
  const sueldoGravable = sueldoExento ? 0 : sueldo;

  percepciones.unshift({
    clave: '001',
    concepto: 'Sueldos, salarios, rayas y jornales',
    gravado: sueldoGravable,
    exento: pesos(sueldo - sueldoGravable),
    importe: sueldo,
    esSueldoDelPeriodo: true,
  });

  const baseGravable = pesos(sueldoGravable + gravadoOtros);
  const totalPercepciones = pesos(sueldo + totalOtros);

  /* ── Impuestos y cuotas ── */
  const { isr, subsidio, baseMensual, renglon } = calcularIsr(baseGravable, periodicidad, e, { sinSubsidio: !!asimilado });
  const imss = calcularImssObrero(salarioDiario, sdi, dias, zona, e);
  const infonavit = calcularInfonavit(entrada.infonavit || { tiene: false }, sdi, dias, zona, e);
  const pension = calcularPension(entrada.pension || { tiene: false }, totalPercepciones, dias);

  /* ── Deducciones, en el orden en que se leen en un recibo ── */
  const deducciones: Deduccion[] = [];
  if (imss.total > 0)  deducciones.push({ clave: '001', concepto: 'Seguridad social', importe: imss.total });
  if (isr > 0)         deducciones.push({ clave: '002', concepto: 'ISR', importe: isr });
  if (infonavit.credito > 0) {
    deducciones.push({ clave: '004', concepto: 'Crédito INFONAVIT', importe: infonavit.credito });
  }
  if (infonavit.seguroDanos > 0) {
    deducciones.push({ clave: '004', concepto: 'Seguro de daños INFONAVIT', importe: infonavit.seguroDanos });
  }
  if (pension > 0)     deducciones.push({ clave: '007', concepto: 'Pensión alimenticia', importe: pension });

  for (const od of entrada.otrasDeducciones || []) {
    const imp = pesos(Number(od.importe) || 0);
    if (imp <= 0) continue;
    const cat = DEDUCCIONES.find((d) => d.clave === od.clave);
    deducciones.push({
      clave: od.clave,
      concepto: od.concepto || cat?.nombre || 'Otro descuento',
      importe: imp,
      /* El origen viaja con el descuento: es lo que deja al cierre marcar la
       * entrega sin volver a adivinar cuál era. */
      ...((od as any).entregaId ? { entregaId: (od as any).entregaId } : {}),
    });
  }

  const totalDeducciones = pesos(deducciones.reduce((s, d) => s + d.importe, 0));

  /* El subsidio entregado en efectivo va en OtrosPagos del CFDI, no como una
   * percepción: no es un ingreso del trabajador sino un pago del fisco. */
  const totalOtrosPagos = subsidio;

  return {
    percepciones,
    deducciones,
    totalPercepciones,
    totalDeducciones,
    totalOtrosPagos,
    baseGravable,
    isr,
    subsidio,
    imss: imss.total,
    neto: pesos(totalPercepciones - totalDeducciones + totalOtrosPagos),
    detalle: {
      sueldoPeriodo: sueldo,
      sueldoExentoPorSalarioMinimo: sueldoExento,
      baseMensualizada: baseMensual,
      renglonTarifa: renglon,
      imssDesglose: imss,
      infonavitDesglose: infonavit,
    },
  };
}

/* ═══════════════════ SALARIO DIARIO INTEGRADO ═══════════════════ */

/**
 * SDI = salario diario × factor de integración (Art. 84 LSS).
 *
 * El factor sale de la política de la empresa: los días de aguinaldo y el % de
 * prima vacacional que da, y los días de vacaciones que le tocan al trabajador
 * por su antigüedad. Se topa a 25 UMA (Art. 28 LSS).
 *
 * NO se calcula solo al guardar un expediente: se ofrece. El IMSS congela el
 * SDI al momento del aviso, y recalcularlo hoy cambiaría la cuota de recibos
 * ya emitidos.
 */
export function factorDeIntegracion(
  diasAguinaldo: number,
  primaVacPct: number,
  diasVacaciones: number
): number {
  const dias = 365;
  return (dias + diasAguinaldo + diasVacaciones * (primaVacPct / 100)) / dias;
}

/**
 * Días de vacaciones por antigüedad — tabla del Art. 76 LFT reformado
 * ("vacaciones dignas", vigente desde el 1 de enero de 2023).
 */
export function diasDeVacaciones(anosDeAntiguedad: number): number {
  const a = Math.floor(anosDeAntiguedad);
  if (a < 1) return 12;
  const primeros = [12, 14, 16, 18, 20];
  if (a <= 5) return primeros[a - 1];
  /* A partir del sexto año, dos días más por cada cinco años de servicio. */
  return 22 + Math.floor((a - 6) / 5) * 2;
}

export function calcularSdi(
  salarioDiario: number,
  diasAguinaldo: number,
  primaVacPct: number,
  anosDeAntiguedad: number,
  umaDiaria: number
): { sdi: number; factor: number; topado: boolean } {
  const dv = diasDeVacaciones(anosDeAntiguedad);
  const factor = factorDeIntegracion(diasAguinaldo, primaVacPct, dv);
  const bruto = salarioDiario * factor;
  const tope = umaDiaria * 25;
  return {
    sdi: pesos(Math.min(bruto, tope)),
    factor: Math.round(factor * 10000) / 10000,
    topado: bruto > tope,
  };
}
