/**
 * Opinión de Cumplimiento — SAT (32-D), IMSS e INFONAVIT.
 *
 * Registro y seguimiento de las tres opiniones: la más reciente por tipo es la
 * vigente; se conserva el histórico. La descarga automática es una fase posterior;
 * hoy se captura lo que se obtiene del portal de cada dependencia.
 */
import { query } from '../../config/database';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler';

export const TIPOS = ['SAT', 'IMSS', 'INFONAVIT'] as const;
export const SENTIDOS = ['POSITIVA', 'NEGATIVA', 'SIN_ADEUDOS', 'SUSPENDIDA', 'OTRO'] as const;
const RX_PDF = /^data:application\/pdf;base64,[A-Za-z0-9+/=\s]+$/;

/** Resumen: la opinión vigente (más reciente) de cada tipo. */
export async function resumen(companyId: string) {
  const r = await query<any>(
    `SELECT DISTINCT ON (tipo) tipo, sentido,
            TO_CHAR(fecha_opinion,'YYYY-MM-DD') AS fecha_opinion, folio, observaciones,
            (pdf IS NOT NULL) AS tiene_pdf, id
       FROM opinion_cumplimiento
      WHERE company_id=$1
      ORDER BY tipo, fecha_opinion DESC, created_at DESC`,
    [companyId]);
  const porTipo: Record<string, any> = {};
  for (const x of r.rows) porTipo[x.tipo] = x;
  return { vigentes: porTipo };
}

/** Histórico de un tipo (o de todos si no se indica). */
export async function historial(companyId: string, tipo?: string) {
  const cond = ['company_id=$1']; const params: any[] = [companyId];
  if (tipo) { params.push(tipo); cond.push(`tipo=$${params.length}`); }
  const r = await query<any>(
    `SELECT id, tipo, sentido, TO_CHAR(fecha_opinion,'YYYY-MM-DD') AS fecha_opinion,
            folio, observaciones, (pdf IS NOT NULL) AS tiene_pdf,
            TO_CHAR(created_at,'YYYY-MM-DD HH24:MI') AS registrado
       FROM opinion_cumplimiento
      WHERE ${cond.join(' AND ')}
      ORDER BY fecha_opinion DESC, created_at DESC`,
    params);
  return r.rows;
}

export async function registrar(companyId: string, d: any, userId?: string) {
  const tipo = String(d?.tipo || '').toUpperCase();
  if (!TIPOS.includes(tipo as any)) throw new ValidationError('Tipo inválido (SAT, IMSS o INFONAVIT).');
  const sentido = String(d?.sentido || 'POSITIVA').toUpperCase();
  if (!SENTIDOS.includes(sentido as any)) throw new ValidationError('Sentido inválido.');
  const fecha = String(d?.fecha_opinion || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ValidationError('Fecha de la opinión inválida (AAAA-MM-DD).');
  const pdf = d?.pdf ? String(d.pdf) : null;
  if (pdf && !RX_PDF.test(pdf)) throw new ValidationError('El PDF debe ser un archivo .pdf.');
  if (pdf && pdf.length > 2_200_000) throw new ValidationError('El PDF es muy grande (máximo ~1.5 MB).');

  const r = await query<any>(
    `INSERT INTO opinion_cumplimiento (company_id, tipo, sentido, fecha_opinion, folio, observaciones, pdf, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [companyId, tipo, sentido, fecha, d?.folio || null, d?.observaciones || null, pdf, userId || null]);
  return { id: r.rows[0].id };
}

export async function borrar(companyId: string, id: string) {
  const r = await query<any>(`DELETE FROM opinion_cumplimiento WHERE id=$1 AND company_id=$2 RETURNING id`, [id, companyId]);
  if (!r.rows.length) throw new NotFoundError('Registro no encontrado');
  return { borrado: true };
}

export async function pdfDe(companyId: string, id: string): Promise<string> {
  const r = await query<any>(`SELECT pdf FROM opinion_cumplimiento WHERE id=$1 AND company_id=$2`, [id, companyId]);
  if (!r.rows.length || !r.rows[0].pdf) throw new NotFoundError('Sin PDF para este registro');
  return r.rows[0].pdf;
}
