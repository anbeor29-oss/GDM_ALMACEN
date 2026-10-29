/**
 * ptu.service — PARTICIPACIÓN DE LOS TRABAJADORES EN LAS UTILIDADES (LFT 117-131).
 *
 * El periodo de PTU es un ESPECIAL, pero su cálculo es propio y NO paga sueldo base
 * (por eso no va por la prenómina normal, que siempre paga salario × días):
 *
 *   · La cantidad a repartir se parte en DOS mitades iguales (Art. 123 LFT):
 *       - 50% por los DÍAS TRABAJADOS en el año (por igual, sin importar el salario).
 *       - 50% por los SALARIOS DEVENGADOS en el año (proporcional al salario).
 *     («antigüedad» NO; la ley usa los días trabajados en el ejercicio.)
 *   · Salario = cuota diaria del expediente (Art. 124); salario devengado = cuota × días.
 *   · Con derecho (Art. 127): se excluyen eventuales con < 60 días (automático) y los
 *     directivos (a mano, con el interruptor). Los topes II (confianza) y VIII (3 meses /
 *     promedio) NO se aplican en esta versión (quedan como ajuste manual).
 *   · ISR: exención de 15 × UMA diaria (LISR 93-XIV); el excedente gravado causa ISR por
 *     el Art. 96 (sobre el gravado, sin subsidio al empleo). El Art. 142 RLISR (opcional,
 *     más favorable) queda como mejora futura.
 */
import { PoolClient } from 'pg';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, ConflictError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import * as periodosSvc from './periodos.service';
import * as ejercicios from './ejercicios.service';
import { calcularIsr, pesos } from './motor';
import { diasQueLeTocan } from './prenomina.service';
import { construirXmlPretimbre } from './cierre.service';

const DIAS_MIN_DERECHO = 60;       // eventuales con menos quedan sin derecho (Art. 127-IV)
const EXENCION_UMA = 15;           // 15 × UMA diaria (LISR 93-XIV)

export interface RenglonPtu {
  empleado_id: string; num_empleado: string; nombre: string; puesto: string | null;
  dias_auto: number; dias: number; salario_diario: number; salario_devengado: number;
  con_derecho: boolean; menos_60: boolean;
  ptu_dias: number; ptu_salario: number; ptu: number;
  exento: number; gravado: number; isr: number; neto: number;
}

/** Trae a los participantes del especial (la lista elegida; o toda la plantilla activa). */
async function participantesDelPeriodo(companyId: string, periodo: any) {
  const cond = ['e.company_id = $1', 'e.deleted_at IS NULL'];
  const args: any[] = [companyId];
  // Activos en algún momento del rango del ejercicio de utilidades.
  args.push(periodo.fecha_fin);   cond.push(`COALESCE(e.fecha_reingreso, e.fecha_ingreso) <= $${args.length}::date`);
  args.push(periodo.fecha_inicio); cond.push(`(e.fecha_baja IS NULL OR e.fecha_baja >= $${args.length}::date)`);
  // Si el especial trae lista de participantes, se respeta; sin lista, toda la plantilla.
  args.push(periodo.id);
  cond.push(
    `(NOT EXISTS (SELECT 1 FROM nomina_periodo_empleados pe WHERE pe.periodo_id = $${args.length})
      OR EXISTS (SELECT 1 FROM nomina_periodo_empleados pe WHERE pe.periodo_id = $${args.length} AND pe.empleado_id = e.id))`
  );
  const r = await query<any>(
    `SELECT e.id, e.num_empleado, e.puesto, e.salario_diario,
            TRIM(e.nombre || ' ' || e.apellido_pat || ' ' || COALESCE(e.apellido_mat,'')) AS nombre,
            TO_CHAR(e.fecha_ingreso, 'YYYY-MM-DD')   AS fecha_ingreso,
            TO_CHAR(e.fecha_baja, 'YYYY-MM-DD')      AS fecha_baja,
            TO_CHAR(e.fecha_reingreso, 'YYYY-MM-DD') AS fecha_reingreso
       FROM nomina_empleados e
      WHERE ${cond.join(' AND ')}
      ORDER BY e.apellido_pat, e.apellido_mat NULLS FIRST, e.nombre`,
    args);
  return r.rows;
}

/** El reparto completo de un periodo de PTU: la cantidad, los renglones, los totales. */
export async function obtener(companyId: string, periodoId: string) {
  const periodo = await periodosSvc.obtener(companyId, periodoId);
  if (periodo.tipo !== 'ESPECIAL') {
    throw new ValidationError('La PTU se calcula sobre un periodo especial de PTU.');
  }

  const cfg = await query<any>(`SELECT cantidad_repartir FROM nomina_ptu WHERE periodo_id=$1`, [periodoId]);
  const cantidadRepartir = Number(cfg.rows[0]?.cantidad_repartir) || 0;

  const det = await query<any>(
    `SELECT empleado_id, dias_trabajados, salario_diario, con_derecho
       FROM nomina_ptu_detalle WHERE periodo_id=$1`, [periodoId]);
  const ajuste = new Map<string, any>(det.rows.map((x: any) => [x.empleado_id, x]));

  // UMA y tarifa del AÑO DE PAGO (la PTU se paga el año siguiente al de las utilidades).
  const fechaPago = periodo.fecha_pago || new Date().toISOString().slice(0, 10);
  const anioPago = Number(String(fechaPago).slice(0, 4));
  const ej = await ejercicios.cargar(anioPago, fechaPago);
  const umaDiaria = Number(ej.umaDiaria) || 0;
  const exencionTope = pesos(EXENCION_UMA * umaDiaria);
  const conf = await query<any>(`SELECT confirmado FROM nomina_ejercicios WHERE anio=$1`, [anioPago]);
  const tarifasConfirmadas = conf.rows[0] ? conf.rows[0].confirmado !== false : true;

  const participantes = await participantesDelPeriodo(companyId, periodo);
  const filas: RenglonPtu[] = participantes.map((e: any) => {
    const g = ajuste.get(e.id);
    const diasAuto = diasQueLeTocan(
      { fecha_inicio: periodo.fecha_inicio, fecha_fin: periodo.fecha_fin, dias: periodo.dias },
      e);
    const dias = g?.dias_trabajados != null ? Number(g.dias_trabajados) : diasAuto;
    const salario = g?.salario_diario != null ? Number(g.salario_diario) : (Number(e.salario_diario) || 0);
    const menos60 = dias < DIAS_MIN_DERECHO;
    /* con_derecho: NULL/sin ajuste = automático (con derecho salvo < 60 días, que
     * aplica a los eventuales). Si el usuario lo fijó a mano (incluir a un planta
     * que entró tarde, o excluir a un directivo), manda su elección. */
    const conDerecho = (g?.con_derecho === null || g?.con_derecho === undefined) ? !menos60 : g.con_derecho;
    return {
      empleado_id: e.id, num_empleado: e.num_empleado, nombre: e.nombre, puesto: e.puesto,
      dias_auto: diasAuto, dias, salario_diario: salario, salario_devengado: pesos(salario * dias),
      con_derecho: conDerecho, menos_60: menos60,
      ptu_dias: 0, ptu_salario: 0, ptu: 0, exento: 0, gravado: 0, isr: 0, neto: 0,
    };
  });

  // Reparto: mitad por días, mitad por salarios devengados (sólo entre los CON DERECHO).
  const conDerecho = filas.filter((f) => f.con_derecho);
  const sumaDias = conDerecho.reduce((a, f) => a + f.dias, 0);
  const sumaSal = conDerecho.reduce((a, f) => a + f.salario_devengado, 0);
  const mitad = pesos(cantidadRepartir / 2);
  const factorDias = sumaDias > 0 ? mitad / sumaDias : 0;
  const factorSal = sumaSal > 0 ? mitad / sumaSal : 0;

  for (const f of filas) {
    if (!f.con_derecho || cantidadRepartir <= 0) continue;
    f.ptu_dias = pesos(factorDias * f.dias);
    f.ptu_salario = pesos(factorSal * f.salario_devengado);
    f.ptu = pesos(f.ptu_dias + f.ptu_salario);
    f.exento = pesos(Math.min(f.ptu, exencionTope));
    f.gravado = pesos(f.ptu - f.exento);
    f.isr = f.gravado > 0 ? calcularIsr(f.gravado, 'MENSUAL', ej, { sinSubsidio: true }).isr : 0;
    f.neto = pesos(f.ptu - f.isr);
  }

  const suma = (k: keyof RenglonPtu) => pesos(filas.reduce((a, f) => a + (Number(f[k]) || 0), 0));
  const totales = {
    con_derecho: conDerecho.length,
    sin_derecho: filas.length - conDerecho.length,
    dias: sumaDias,
    salario_devengado: pesos(sumaSal),
    ptu: suma('ptu'), exento: suma('exento'), gravado: suma('gravado'),
    isr: suma('isr'), neto: suma('neto'),
  };
  // Por el redondeo, la suma repartida puede diferir de la cantidad por unos centavos.
  const diferencia = pesos(cantidadRepartir - totales.ptu);

  const avisos: string[] = [];
  if (cantidadRepartir <= 0) avisos.push('Captura la cantidad a repartir (10% de la renta gravable del ejercicio).');
  const nMenos60 = filas.filter((f) => f.menos_60).length;
  if (nMenos60) avisos.push(`${nMenos60} trabajador(es) con menos de 60 días quedan SIN derecho (Art. 127-IV LFT).`);
  avisos.push('Los directivos (directores, administradores y gerentes generales) se excluyen a mano con el interruptor «Con derecho» (Art. 127-I). Los topes de confianza (II) y de 3 meses/promedio (VIII) no se aplican en esta versión.');
  if (Math.abs(diferencia) >= 0.01) avisos.push(`Diferencia por redondeo entre lo repartido y la cantidad: ${diferencia.toFixed(2)}.`);
  if (!tarifasConfirmadas) avisos.push(`Las tarifas del ${anioPago} no están confirmadas contra el DOF; el ISR es provisional.`);

  return {
    periodo, cantidadRepartir, uma_diaria: umaDiaria, exencion_tope: exencionTope, anio_pago: anioPago,
    mitad, factor_dias: pesos(factorDias), factor_salario: pesos(factorSal),
    filas, totales, diferencia, avisos,
    tarifas_confirmadas: tarifasConfirmadas,
  };
}

/** Guarda la cantidad a repartir y los ajustes por trabajador (días/salario/derecho). */
export async function guardar(
  companyId: string, periodoId: string,
  d: { cantidadRepartir?: number; detalle?: Array<{ empleadoId: string; dias?: number | null; salario?: number | null; conDerecho?: boolean }> },
) {
  const p = await periodosSvc.obtener(companyId, periodoId);
  if (p.estatus === 'CERRADO') throw new ValidationError('Ese periodo ya está cerrado.');

  if (d.cantidadRepartir !== undefined) {
    const monto = Number(d.cantidadRepartir);
    if (!Number.isFinite(monto) || monto < 0) throw new ValidationError('La cantidad a repartir no puede ser negativa.');
    await query(
      `INSERT INTO nomina_ptu (periodo_id, company_id, cantidad_repartir, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (periodo_id) DO UPDATE SET cantidad_repartir=EXCLUDED.cantidad_repartir, updated_at=NOW()`,
      [periodoId, companyId, pesos(monto)]);
  }

  // La pantalla manda UN campo a la vez (días, salario o derecho). Se CONSERVAN los
  // otros dos: leer-fusionar-escribir evita que editar los días borre el salario o
  // el interruptor que el usuario ya había ajustado.
  const parseNum = (v: any) => (v === '' || v === null || v === undefined ? null : Number(v));
  for (const row of d.detalle || []) {
    if (!row?.empleadoId) continue;
    const ex = await query<any>(
      `SELECT dias_trabajados, salario_diario, con_derecho FROM nomina_ptu_detalle
        WHERE periodo_id=$1 AND empleado_id=$2`, [periodoId, row.empleadoId]);
    const cur = ex.rows[0];
    const dias = 'dias' in row ? parseNum(row.dias) : (cur ? (cur.dias_trabajados === null ? null : Number(cur.dias_trabajados)) : null);
    const salario = 'salario' in row ? parseNum(row.salario) : (cur ? (cur.salario_diario === null ? null : Number(cur.salario_diario)) : null);
    const conDerecho = 'conDerecho' in row ? !!row.conDerecho : (cur ? cur.con_derecho : null);
    if (dias !== null && (!Number.isFinite(dias) || dias < 0)) throw new ValidationError('Los días no pueden ser negativos.');
    if (salario !== null && (!Number.isFinite(salario) || salario < 0)) throw new ValidationError('El salario no puede ser negativo.');
    await query(
      `INSERT INTO nomina_ptu_detalle (periodo_id, empleado_id, company_id, dias_trabajados, salario_diario, con_derecho)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (periodo_id, empleado_id) DO UPDATE
         SET dias_trabajados=EXCLUDED.dias_trabajados, salario_diario=EXCLUDED.salario_diario, con_derecho=EXCLUDED.con_derecho`,
      [periodoId, row.empleadoId, companyId, dias, salario, conDerecho]);
  }
  return { ok: true };
}

/**
 * Genera los recibos del reparto de PTU y cierra el periodo.
 *
 * El PTU se paga en una nómina EXTRAORDINARIA (CFDI 4.0 + nómina 1.2 con
 * TipoNomina="E"): no lleva sueldo base ni IMSS, sólo la percepción 003 (PTU)
 * con su exento/gravado y, si el excedente causa, la retención de ISR (002).
 *
 * Una vez generados, los recibos caen en la MISMA bandeja que el resto de la
 * nómina —Nómina → CFDI— y de ahí se timbran, se marcan para correo y se bajan
 * en PDF/XML, sin un camino aparte. Por eso esto NO manda correos ni timbra:
 * sólo congela los recibos (reversible) y deja el paso que cuesta un timbre para
 * la pantalla de CFDI, igual que el cierre normal.
 *
 * No toca préstamos, FONACOT ni entregas: el PTU es un pago aparte y esos saldos
 * se mueven con la nómina ordinaria, no con éste.
 */
export async function generarRecibos(companyId: string, periodoId: string, userId?: string) {
  const d = await obtener(companyId, periodoId);
  if (d.periodo.estatus === 'CERRADO') {
    throw new ConflictError('Ese periodo ya está cerrado; sus recibos ya se generaron.');
  }
  if (d.cantidadRepartir <= 0) {
    throw new ValidationError('Captura la cantidad a repartir antes de generar los recibos.');
  }
  const conDerecho = d.filas.filter((f) => f.con_derecho && f.ptu > 0);
  if (conDerecho.length === 0) {
    throw new ValidationError('Ningún trabajador tiene PTU por repartir.');
  }

  const emp = await query<any>(
    `SELECT rfc, business_name, fiscal_regime, postal_code, registro_patronal
       FROM companies WHERE id = $1`, [companyId]);
  const empresa = emp.rows[0];

  /* Los datos del expediente que van en el CFDI y no están en el reparto. */
  const det = await query<any>(
    `SELECT id, curp, nss, codigo_postal, regimen_fiscal, tipo_contrato, tipo_regimen,
            tipo_jornada, entidad_federativa, departamento, puesto, email,
            salario_diario_integrado, rfc,
            TO_CHAR(fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso
       FROM nomina_empleados
      WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [companyId, conDerecho.map((f) => f.empleado_id)]);
  const porId = new Map(det.rows.map((e: any) => [e.id, e]));

  return transaction(async (client: PoolClient) => {
    let recibos = 0;
    for (const f of conDerecho) {
      const e = porId.get(f.empleado_id);
      if (!e) continue;

      const percepciones = [{
        clave: '003',
        concepto: 'Participación de los Trabajadores en las Utilidades (PTU)',
        importe: f.ptu, gravado: f.gravado, exento: f.exento,
      }];
      const deducciones = f.isr > 0
        ? [{ clave: '002', concepto: 'ISR', importe: f.isr }]
        : [];

      const fila = {
        num_empleado: f.num_empleado, nombre: f.nombre,
        rfc: e.rfc, curp: e.curp, nss: e.nss,
        dias: f.dias, total_percepciones: f.ptu, total_deducciones: f.isr, neto: f.neto,
        percepciones, deducciones,
      };

      const xml = construirXmlPretimbre({
        empresa, periodo: d.periodo, recibo: fila, empleado: e, tipoNomina: 'E',
      });

      const ins = await transactionQuery<{ id: string }>(
        client,
        `INSERT INTO nomina_recibos
           (company_id, periodo_id, empleado_id, num_empleado, nombre, rfc, curp, nss,
            dias, total_percepciones, total_deducciones, total_otros_pagos,
            total_gravado, total_exento, isr, imss, neto,
            percepciones, deducciones, xml_pretimbre, correo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                 $18::jsonb,$19::jsonb,$20,$21)
         ON CONFLICT (periodo_id, empleado_id) DO NOTHING
         RETURNING id`,
        [
          companyId, periodoId, f.empleado_id, f.num_empleado, f.nombre,
          e.rfc, e.curp, e.nss, f.dias,
          f.ptu, f.isr, 0, f.gravado, f.exento, f.isr, 0, f.neto,
          JSON.stringify(percepciones), JSON.stringify(deducciones),
          xml, e.email || null,
        ]);
      if (ins.rows.length > 0) recibos++;
    }

    await transactionQuery(
      client,
      `UPDATE nomina_periodos
          SET estatus = 'CERRADO', cerrado_at = NOW(), cerrado_por = $3
        WHERE id = $1 AND company_id = $2`,
      [periodoId, companyId, userId || null]);

    logger.info(
      `[nómina] PTU #${d.periodo.numero} ${d.periodo.anio}: ${recibos} recibo(s) generados`);

    return { recibos, periodo: `PTU #${d.periodo.numero}`, neto: d.totales.neto };
  });
}
