/**
 * vacaciones.service — el control de vacaciones del trabajador.
 *
 * GANADAS − DISFRUTADAS − PAGADAS = REMANENTE
 * Las ganadas salen de la antigüedad (Art. 76 LFT): cada año cumplido aporta su
 * cuota completa, más lo proporcional del año en curso —el mismo criterio del
 * finiquito—. Las disfrutadas y pagadas se capturan aquí. La PRIMA vacacional
 * (Art. 80) de los tramos que caen en un periodo de nómina pasa a esa nómina.
 */

import { query } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';
import { diasDeVacaciones, pesos } from './motor';

/** Días completos entre dos fechas (sin +1), a mediodía para no correr el día. */
function diasEntre(desde: string, hasta: string): number {
  const a = new Date(`${desde}T12:00:00`).getTime();
  const b = new Date(`${hasta}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Aniversarios cumplidos de ingreso a una fecha. */
function aniversariosCumplidos(ingreso: string, hasta: string): number {
  let n = 0;
  for (;;) {
    const f = new Date(`${ingreso}T12:00:00`);
    f.setFullYear(f.getFullYear() + n + 1);
    if (f.toISOString().slice(0, 10) > hasta) return n;
    n++;
    if (n > 100) return n;
  }
}

function fechaDeAniversario(ingreso: string, n: number): string {
  const f = new Date(`${ingreso}T12:00:00`);
  f.setFullYear(f.getFullYear() + n);
  return f.toISOString().slice(0, 10);
}

/** Vacaciones GANADAS de ingreso a `hasta` (cuota completa por año + proporcional). */
function diasGanados(fechaIngreso: string, hasta: string): number {
  const aniversarios = aniversariosCumplidos(fechaIngreso, hasta);
  const desdeAniversario = fechaDeAniversario(fechaIngreso, aniversarios);
  const diasCorridos = Math.max(0, diasEntre(desdeAniversario, hasta));
  let g = 0;
  for (let k = 1; k <= aniversarios; k++) g += diasDeVacaciones(k);
  g += diasDeVacaciones(aniversarios + 1) * (diasCorridos / 365);
  return Math.round(g * 100) / 100;
}

export type TipoVacacion = 'DISFRUTADA' | 'PAGADA';

export async function agregar(
  companyId: string, empleadoId: string,
  d: { fechaInicio: string; fechaFin: string; dias: number; tipo: TipoVacacion; motivo?: string },
): Promise<{ id: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fechaInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(d.fechaFin)) {
    throw new ValidationError('Las fechas de las vacaciones deben venir como AAAA-MM-DD');
  }
  if (d.fechaFin < d.fechaInicio) throw new ValidationError('La fecha final no puede ser anterior a la inicial');
  const dias = Number(d.dias) || 0;
  if (!(dias > 0)) throw new ValidationError('Los días de vacaciones deben ser mayores a cero');
  const tipo: TipoVacacion = d.tipo === 'PAGADA' ? 'PAGADA' : 'DISFRUTADA';

  const chk = await query(
    'SELECT 1 FROM nomina_empleados WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL',
    [empleadoId, companyId],
  );
  if (chk.rows.length === 0) throw new NotFoundError('Ese trabajador no existe en esta empresa');

  const r = await query<{ id: string }>(
    `INSERT INTO nomina_vacaciones (company_id, empleado_id, fecha_inicio, fecha_fin, dias, tipo, motivo)
     VALUES ($1,$2,$3::date,$4::date,$5,$6,$7)
     RETURNING id`,
    [companyId, empleadoId, d.fechaInicio, d.fechaFin, dias, tipo, (d.motivo || '').slice(0, 200) || null],
  );
  return { id: r.rows[0].id };
}

export async function listar(companyId: string, empleadoId: string): Promise<any[]> {
  const r = await query<any>(
    `SELECT id, TO_CHAR(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
            TO_CHAR(fecha_fin, 'YYYY-MM-DD') AS fecha_fin, dias, tipo, motivo, created_at
       FROM nomina_vacaciones
      WHERE company_id = $1 AND empleado_id = $2
      ORDER BY fecha_inicio DESC`,
    [companyId, empleadoId],
  );
  return r.rows;
}

export async function eliminar(companyId: string, empleadoId: string, id: string): Promise<void> {
  await query(
    'DELETE FROM nomina_vacaciones WHERE id = $1 AND empleado_id = $2 AND company_id = $3',
    [id, empleadoId, companyId],
  );
}

export async function resumen(
  companyId: string, empleadoId: string,
): Promise<{ ganados: number; disfrutados: number; pagados: number; remanente: number }> {
  const e = await query<{ fecha_ingreso: string | null }>(
    `SELECT TO_CHAR(fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso
       FROM nomina_empleados WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
    [empleadoId, companyId],
  );
  if (e.rows.length === 0) throw new NotFoundError('Ese trabajador no existe en esta empresa');
  const ingreso = e.rows[0].fecha_ingreso;
  const hoy = new Date().toISOString().slice(0, 10);
  const ganados = ingreso ? diasGanados(ingreso, hoy) : 0;

  const s = await query<{ disfrutados: string; pagados: string }>(
    `SELECT COALESCE(SUM(dias) FILTER (WHERE tipo = 'DISFRUTADA'), 0) AS disfrutados,
            COALESCE(SUM(dias) FILTER (WHERE tipo = 'PAGADA'), 0)     AS pagados
       FROM nomina_vacaciones WHERE company_id = $1 AND empleado_id = $2`,
    [companyId, empleadoId],
  );
  const disfrutados = Number(s.rows[0].disfrutados) || 0;
  const pagados = Number(s.rows[0].pagados) || 0;
  return {
    ganados,
    disfrutados,
    pagados,
    remanente: Math.round((ganados - disfrutados - pagados) * 100) / 100,
  };
}

/**
 * Lo que las vacaciones aportan a un periodo de nómina: la PRIMA vacacional de
 * los tramos que caen en el rango, y —si fueron PAGADAS— el importe de los días.
 * Las disfrutadas no pagan los días aquí: el sueldo del periodo ya los cubre.
 * Devuelve percepciones listas para sumarse a `otrosIngresos`.
 */
export async function delPeriodo(
  companyId: string, empleadoId: string,
  desde: string, hasta: string, salarioDiario: number, primaVacPct: number,
): Promise<Array<{ clave: string; importe: number }>> {
  const r = await query<{ dias: string; tipo: string }>(
    `SELECT dias, tipo FROM nomina_vacaciones
      WHERE company_id = $1 AND empleado_id = $2
        AND fecha_inicio <= $4::date AND fecha_fin >= $3::date`,
    [companyId, empleadoId, desde, hasta],
  );
  let diasPrima = 0, diasPago = 0;
  for (const v of r.rows) {
    const dias = Number(v.dias) || 0;
    diasPrima += dias;                         // la prima aplica a disfrutadas y pagadas
    if (v.tipo === 'PAGADA') diasPago += dias; // las pagadas además pagan los días
  }
  const out: Array<{ clave: string; importe: number }> = [];
  if (diasPago > 0) {
    // Clave 001: pago de los días de vacaciones no disfrutadas.
    out.push({ clave: '001', importe: pesos(diasPago * (Number(salarioDiario) || 0)) });
  }
  if (diasPrima > 0) {
    out.push({ clave: '021', importe: pesos(diasPrima * (Number(salarioDiario) || 0) * (Number(primaVacPct) || 0) / 100) });
  }
  return out;
}
