/**
 * finiquito.service — qué se le debe a alguien que se va.
 *
 * FINIQUITO Y LIQUIDACIÓN NO SON LO MISMO
 * El FINIQUITO son las partes proporcionales que el trabajador ya se ganó y
 * todavía no cobra: los días del último periodo, el aguinaldo del año corrido,
 * las vacaciones que no tomó y su prima. Se paga SIEMPRE, se vaya como se vaya
 * —renuncia, término de contrato, despido justificado—.
 *
 * La LIQUIDACIÓN es la indemnización que se suma cuando el despido es
 * injustificado: tres meses de salario (Art. 48 LFT) y la prima de antigüedad
 * (Art. 162), doce días por año. Los veinte días del Art. 50 Fr. II NO se
 * calculan aquí, por decisión del despacho: sólo proceden cuando un tribunal
 * exime al patrón de reinstalar, y no son parte de una liquidación ordinaria.
 *
 * Aquí se calculan LOS DOS y se devuelven por separado, porque quién paga qué
 * es una decisión jurídica que el sistema no debe tomar por nadie. La pantalla
 * los muestra lado a lado y el usuario elige antes de generar el periodo
 * especial.
 *
 * DE DÓNDE SALEN LOS DÍAS
 *   · Aguinaldo      Art. 87 LFT — mínimo 15 días al año, proporcional a los
 *                    días trabajados del año. La empresa puede dar más: se usa
 *                    lo que tenga capturado en sus parámetros.
 *   · Vacaciones     Art. 76 reformado ("vacaciones dignas", desde 2023). Los
 *                    días son por antigüedad y se paga lo NO disfrutado del
 *                    último año, proporcional.
 *   · Prima vac.     Art. 80 — 25% de lo que corresponde a esas vacaciones.
 *   · Indemnización  Art. 48 — tres meses de salario DIARIO INTEGRADO, no del
 *                    diario a secas (Art. 89: las indemnizaciones se calculan
 *                    con el salario que incluye las prestaciones).
 *   · Prima antig.   Art. 162 — 12 días por año, con el salario TOPADO a dos
 *                    veces el mínimo (Fr. II, en relación con el Art. 485).
 *
 * LO QUE ESTE SERVICIO NO HACE
 * No retiene el ISR del Art. 93 Fr. XIII ni aplica el Art. 95 (cálculo de
 * indemnizaciones). El finiquito se paga por un periodo ESPECIAL y ahí pasa por
 * el motor con sus exenciones. Esto es la cuenta de lo que se debe, no el
 * recibo.
 */

import { query } from '../../config/database';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import * as ejercicios from './ejercicios.service';
import * as periodosSvc from './periodos.service';
import { pesos, diasDeVacaciones, smgDeZona, Zona } from './motor';

/** Días completos entre dos fechas, sin que la zona horaria mueva el día. */
function diasEntre(desde: string, hasta: string): number {
  const a = new Date(`${desde}T12:00:00`);
  const b = new Date(`${hasta}T12:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Aniversarios REALMENTE cumplidos, contados por calendario.
 *
 * No se puede usar días/365: entre 2020-01-01 y 2026-12-31 hay 2,556 días, que
 * son 7.0027 "años" y redondean a siete —pero el séptimo aniversario cae el
 * 2027-01-01, un día después—. Darlo por cumplido salta un renglón de la tabla
 * del Art. 76 y, peor, coloca el último aniversario en el futuro: las
 * vacaciones proporcionales salían en CERO.
 */
function aniversariosCumplidos(ingreso: string, salida: string): number {
  let n = 0;
  for (;;) {
    const f = new Date(`${ingreso}T12:00:00`);
    f.setFullYear(f.getFullYear() + n + 1);
    if (f.toISOString().slice(0, 10) > salida) return n;
    n++;
    if (n > 100) return n;            // red de seguridad, no debería llegar
  }
}

/** La fecha del último aniversario cumplido. */
function fechaDeAniversario(ingreso: string, n: number): string {
  const f = new Date(`${ingreso}T12:00:00`);
  f.setFullYear(f.getFullYear() + n);
  return f.toISOString().slice(0, 10);
}

/**
 * Antigüedad en años: los aniversarios cumplidos más la fracción corrida desde
 * el último. Es lo que multiplica los 12 días de la prima de antigüedad (162).
 */
function antiguedadEnAnos(ingreso: string, salida: string): number {
  const n = aniversariosCumplidos(ingreso, salida);
  const desde = fechaDeAniversario(ingreso, n);
  return n + Math.max(0, diasEntre(desde, salida)) / 365;
}

export interface Concepto {
  clave: string;      // clave del c_TipoPercepcion, para el CFDI
  concepto: string;
  dias: number;
  base: number;       // salario con el que se calculó
  importe: number;
  fundamento: string;
}

export interface Calculo {
  empleado: {
    id: string; num_empleado: string; nombre: string;
    fecha_ingreso: string; salario_diario: number; salario_diario_integrado: number;
  };
  fechaBaja: string;
  antiguedad: { dias: number; anos: number; texto: string };
  /** Lo que se paga siempre. */
  finiquito: { conceptos: Concepto[]; total: number };
  /** Lo que se suma SÓLO si el despido fue injustificado. */
  liquidacion: { conceptos: Concepto[]; total: number };
  /** finiquito + liquidación. */
  totalConIndemnizacion: number;
  avisos: string[];
}

/**
 * Calcula finiquito y liquidación a una fecha de baja. NO escribe nada.
 */
export async function calcular(
  companyId: string,
  empleadoId: string,
  fechaBaja: string,
  opciones: { vacacionesYaDisfrutadas?: number; diasPendientesDePagar?: number } = {}
): Promise<Calculo> {
  const e = await query<any>(
    `SELECT id, num_empleado, nombre, apellido_pat, apellido_mat,
            TO_CHAR(fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso,
            salario_diario, salario_diario_integrado, zona_geografica
       FROM nomina_empleados
      WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
    [empleadoId, companyId]
  );
  if (e.rows.length === 0) throw new NotFoundError('No encontré a ese trabajador');
  const t = e.rows[0];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaBaja)) {
    throw new NotFoundError('La fecha de baja debe venir como YYYY-MM-DD');
  }

  const anio = Number(fechaBaja.slice(0, 4));
  const ej = await ejercicios.cargar(anio, fechaBaja);
  const zona: Zona = (t.zona_geografica === 'frontera_norte' ? 'frontera_norte' : 'general');

  const meta = await query<any>(
    `SELECT fi_aguinaldo_dias, fi_prima_vac_pct FROM companies WHERE id = $1`,
    [companyId]
  );
  const diasAguinaldo = Number(meta.rows[0]?.fi_aguinaldo_dias) || 15;   // Art. 87 mínimo
  const primaVacPct   = Number(meta.rows[0]?.fi_prima_vac_pct) || 25;    // Art. 80 mínimo

  const diario   = Number(t.salario_diario) || 0;
  const integrado = Number(t.salario_diario_integrado) || diario;

  const diasTrabajados = diasEntre(t.fecha_ingreso, fechaBaja);
  const anos = antiguedadEnAnos(t.fecha_ingreso, fechaBaja);

  const avisos: string[] = [];
  if (diasTrabajados < 0) avisos.push('La fecha de baja es anterior a la de ingreso.');
  if (integrado < diario) {
    avisos.push(
      'El salario integrado está por debajo del diario, cosa imposible: el factor ' +
      'de integración nunca baja de 1. Revisa el expediente antes de liquidar.'
    );
  }

  /* ── FINIQUITO ── */
  const finiquito: Concepto[] = [];

  // Días del último periodo que no se han pagado. Los captura quien liquida:
  // el sistema no sabe hasta dónde llegó la última nómina cerrada.
  const diasPendientes = Number(opciones.diasPendientesDePagar) || 0;
  if (diasPendientes > 0) {
    finiquito.push({
      clave: '001', concepto: 'Sueldos pendientes de pago',
      dias: diasPendientes, base: diario, importe: pesos(diario * diasPendientes),
      fundamento: 'Art. 82 LFT — el salario devengado y no cubierto',
    });
  }

  // Aguinaldo proporcional: los días del año corrido, del 1 de enero a la baja.
  const inicioDelAno = `${anio}-01-01`;
  const desdeParaAguinaldo = t.fecha_ingreso > inicioDelAno ? t.fecha_ingreso : inicioDelAno;
  const diasDelAno = Math.max(0, diasEntre(desdeParaAguinaldo, fechaBaja));
  const diasAgui = (diasAguinaldo / 365) * diasDelAno;
  finiquito.push({
    clave: '002', concepto: 'Aguinaldo proporcional',
    dias: Math.round(diasAgui * 100) / 100, base: diario,
    importe: pesos(diario * diasAgui),
    fundamento: `Art. 87 LFT — ${diasAguinaldo} días al año, por ${diasDelAno} días trabajados`,
  });

  /* Vacaciones: los días que le tocan por su antigüedad, proporcionales al
   * tiempo corrido desde su último aniversario, menos las que ya disfrutó. */
  const aniversarios = aniversariosCumplidos(t.fecha_ingreso, fechaBaja);
  const diasQueLeTocan = diasDeVacaciones(aniversarios);
  const desdeAniversario = fechaDeAniversario(t.fecha_ingreso, aniversarios);
  const diasCorridos = Math.max(0, diasEntre(desdeAniversario, fechaBaja));

  const vacProporcionales = (diasQueLeTocan / 365) * diasCorridos;
  const yaDisfrutadas = Number(opciones.vacacionesYaDisfrutadas) || 0;
  const vacPorPagar = Math.max(0, vacProporcionales - yaDisfrutadas);

  finiquito.push({
    clave: '001', concepto: 'Vacaciones no disfrutadas',
    dias: Math.round(vacPorPagar * 100) / 100, base: diario,
    importe: pesos(diario * vacPorPagar),
    fundamento:
      `Art. 76 LFT — ${diasQueLeTocan} días con ${aniversarios} año(s) de antigüedad, ` +
      `proporcionales a ${diasCorridos} días desde su aniversario` +
      (yaDisfrutadas > 0 ? `, menos ${yaDisfrutadas} ya disfrutados` : ''),
  });

  finiquito.push({
    clave: '021', concepto: 'Prima vacacional',
    dias: Math.round(vacPorPagar * 100) / 100, base: diario,
    importe: pesos(diario * vacPorPagar * (primaVacPct / 100)),
    fundamento: `Art. 80 LFT — ${primaVacPct}% sobre las vacaciones`,
  });

  /* ── LIQUIDACIÓN — sólo si el despido es injustificado ── */
  const liquidacion: Concepto[] = [];

  liquidacion.push({
    clave: '025', concepto: 'Indemnización constitucional (3 meses)',
    dias: 90, base: integrado, importe: pesos(integrado * 90),
    fundamento: 'Art. 48 LFT — tres meses de salario integrado (Art. 89)',
  });

  /* Los VEINTE DÍAS POR AÑO del Art. 50 Fr. II no se calculan.
   *
   * Decisión del despacho, 2026-08-18. Ese concepto sólo procede cuando el
   * trabajador demanda la reinstalación y un tribunal exime al patrón de
   * reinstalarlo; no es parte de una liquidación ordinaria. Calcularlo "por si
   * acaso" inflaba la cifra que se ve en pantalla y con ella la expectativa de
   * lo que hay que pagar.
   *
   * Si algún día hace falta —una liquidación por laudo—, se captura a mano como
   * otro ingreso en el periodo especial. */

  /* Prima de antigüedad: 12 días por año, pero con el salario TOPADO a dos
   * veces el mínimo. El tope es del Art. 162 Fr. II en relación con el 485, y
   * es lo que más se equivoca al liquidar: sin él, a un sueldo alto se le paga
   * de más y ya no se recupera. */
  const topeDosMinimos = smgDeZona(ej, zona) * 2;
  const baseAntiguedad = Math.min(diario, topeDosMinimos);
  const diasAntiguedad = 12 * anos;
  liquidacion.push({
    clave: '022', concepto: 'Prima de antigüedad',
    dias: Math.round(diasAntiguedad * 100) / 100, base: baseAntiguedad,
    importe: pesos(baseAntiguedad * diasAntiguedad),
    fundamento:
      `Art. 162 LFT — 12 días por año` +
      (baseAntiguedad < diario
        ? `, con el salario topado a dos mínimos ($${topeDosMinimos.toFixed(2)})`
        : ''),
  });

  if (anos < 15 && diario <= topeDosMinimos) {
    avisos.push(
      'La prima de antigüedad del Art. 162 sólo se paga por renuncia con 15 años ' +
      'o más de servicio; en despido se paga siempre. Aquí se calcula: quien ' +
      'liquida decide si aplica.'
    );
  }

  const totalFiniquito   = pesos(finiquito.reduce((a, c) => a + c.importe, 0));
  const totalLiquidacion = pesos(liquidacion.reduce((a, c) => a + c.importe, 0));

  return {
    empleado: {
      id: t.id, num_empleado: t.num_empleado,
      nombre: [t.nombre, t.apellido_pat, t.apellido_mat].filter(Boolean).join(' '),
      fecha_ingreso: t.fecha_ingreso,
      salario_diario: diario, salario_diario_integrado: integrado,
    },
    fechaBaja,
    antiguedad: {
      dias: diasTrabajados, anos: Math.round(anos * 100) / 100,
      texto:
        `${Math.floor(anos)} año(s) y ${Math.round((anos - Math.floor(anos)) * 365)} días`,
    },
    finiquito:   { conceptos: finiquito,   total: totalFiniquito },
    liquidacion: { conceptos: liquidacion, total: totalLiquidacion },
    totalConIndemnizacion: pesos(totalFiniquito + totalLiquidacion),
    avisos,
  };
}

/**
 * Pasa el finiquito a un periodo ESPECIAL de una sola persona.
 *
 * QUÉ CREA
 * Un periodo ESPECIAL con `empleado_id`, así que la prenómina traerá ese único
 * renglón en vez de la plantilla completa. Sus fechas son el tramo que se le
 * debe —de ahí sale el sueldo de la semana, con el motor de siempre— y sus
 * conceptos extra los deriva `calcular()` cada vez, no se copian aquí.
 *
 * POR QUÉ NO SE GUARDAN LOS IMPORTES
 * Si se guardaran y luego alguien corrige la fecha de baja o el sueldo, la
 * cuenta quedaría con números que ya no corresponden a los datos. Derivándola
 * se corrige con ellos. Al CERRAR el periodo sí se congela, en nomina_recibos,
 * y de ahí en adelante no se mueve — que es exactamente cuando debe dejar de
 * moverse.
 *
 * NO DA DE BAJA AL TRABAJADOR
 * Eso lo hace `empleados.darDeBaja`. Aquí sólo se prepara el pago: separar las
 * dos cosas permite recalcular el finiquito sin volver a dar de baja a nadie.
 */
export async function pasarANominaEspecial(
  companyId: string,
  empleadoId: string,
  d: {
    fechaBaja: string;
    tipo: 'FINIQUITO' | 'LIQUIDACION';
    /** Desde cuándo se le debe el sueldo. Es el inicio del periodo. */
    desde?: string;
    vacacionesYaDisfrutadas?: number;
    motivo?: string;
    fechaPago?: string;
  }
) {
  /* Se calcula primero: si el expediente está incompleto o la fecha no cuadra,
   * mejor tronar antes de crear un periodo que habría que borrar. */
  const cuenta = await calcular(companyId, empleadoId, d.fechaBaja, {
    vacacionesYaDisfrutadas: d.vacacionesYaDisfrutadas,
  });

  /* El tramo que se le debe. Por omisión el mismo día de la baja —un solo día—,
   * porque suponer una semana completa le pagaría de más a quien renunció a
   * media semana. Quien liquida ajusta el inicio si le deben más días. */
  const desde = d.desde && /^\d{4}-\d{2}-\d{2}$/.test(d.desde) ? d.desde : d.fechaBaja;
  if (desde > d.fechaBaja) {
    throw new ValidationError('El inicio del tramo no puede ser posterior a la fecha de baja');
  }

  const nombre = cuenta.empleado.nombre;
  const etiqueta = d.tipo === 'LIQUIDACION' ? 'Liquidación' : 'Finiquito';

  const periodo = await periodosSvc.crearEspecial(companyId, {
    anio: Number(d.fechaBaja.slice(0, 4)),
    concepto: `${etiqueta} de ${nombre}`.slice(0, 200),
    fecha_inicio: desde,
    fecha_fin: d.fechaBaja,
    fecha_pago: d.fechaPago || d.fechaBaja,
  });

  await query(
    `UPDATE nomina_periodos
        SET empleado_id = $2, finiquito_tipo = $3, finiquito_datos = $4::jsonb
      WHERE id = $1 AND company_id = $5`,
    [
      periodo.id, empleadoId, d.tipo,
      JSON.stringify({
        vacacionesYaDisfrutadas: Number(d.vacacionesYaDisfrutadas) || 0,
        motivo: d.motivo || null,
        fechaBaja: d.fechaBaja,
      }),
      companyId,
    ]
  );

  logger.info(
    `[nómina] ${etiqueta} de ${nombre} en el periodo especial #${periodo.numero} ` +
    `de ${periodo.anio} — sólo ese trabajador`
  );

  return {
    periodo: { ...periodo, empleado_id: empleadoId, finiquito_tipo: d.tipo },
    cuenta,
    /* Lo que el usuario necesita saber para no buscarlo: a dónde ir. */
    aviso:
      `Se creó el periodo ESPECIAL #${periodo.numero} con ${etiqueta.toLowerCase()} de ` +
      `${nombre}. Ábrelo en Nómina → Especial: trae sólo a esa persona, con los días ` +
      'que se le deben y sus conceptos. Revísalo y ciérralo para generar el CFDI.',
  };
}

/**
 * Los conceptos del finiquito como "otros ingresos" del periodo especial.
 *
 * Los llama la prenómina cuando el periodo trae `finiquito_tipo`. El sueldo de
 * los días que se le deben NO va aquí: sale del motor con las fechas del
 * periodo, igual que en cualquier nómina. Duplicarlo lo pagaría dos veces.
 */
export async function conceptosParaPrenomina(
  companyId: string,
  periodo: { empleado_id: string; finiquito_tipo: string; finiquito_datos: any; fecha_fin: string }
): Promise<Array<{ clave: string; importe: number }>> {
  const datos = periodo.finiquito_datos || {};
  const cuenta = await calcular(
    companyId, periodo.empleado_id,
    datos.fechaBaja || periodo.fecha_fin,
    { vacacionesYaDisfrutadas: Number(datos.vacacionesYaDisfrutadas) || 0 }
  );

  const conceptos = [...cuenta.finiquito.conceptos];
  if (periodo.finiquito_tipo === 'LIQUIDACION') {
    conceptos.push(...cuenta.liquidacion.conceptos);
  }

  /* "Sueldos pendientes de pago" se descarta: el motor ya cobra los días del
   * periodo con la clave 001. Es el único concepto que se solaparía. */
  return conceptos
    .filter((c) => !c.concepto.startsWith('Sueldos pendientes'))
    .filter((c) => c.importe > 0)
    .map((c) => ({ clave: c.clave, importe: c.importe }));
}
