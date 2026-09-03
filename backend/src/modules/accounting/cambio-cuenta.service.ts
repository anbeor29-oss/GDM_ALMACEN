/**
 * Cambio de cuenta — mantenimiento del catálogo tras una migración:
 *
 *   1. reasignarMovimientos — mueve las PARTIDAS de una cuenta a otra, opcional por
 *      rango de fechas. Es para sustituir la cuenta temporal (MIG-TEMPORAL) por la
 *      cuenta real del catálogo en el periodo que toque.
 *   2. fusionarCuenta — unifica dos cuentas duplicadas (el mismo tercero capturado
 *      dos veces por un typo o por mayúsculas/minúsculas): mueve TODAS las partidas
 *      de la origen a la destino, reengancha sus hijos y borra la origen.
 *
 * Tras cualquiera de las dos se recalcula la balanza de los AÑOS afectados, para
 * que los saldos queden bien sin dar «Actualizar desde pólizas» a mano.
 */
import { query, transaction } from '../../config/database';
import type { PoolClient } from 'pg';
import { alimentarDesdePolizas } from './periodos.service';

const norm = (s: string) => (s || '').toUpperCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Los años que tocan las partidas de una cuenta (para recalcular su balanza). */
async function aniosDeCuenta(
  companyId: string, cuentaId: string, desde?: string, hasta?: string
): Promise<number[]> {
  const cond = ['e.company_id=$1', 'l.account_id=$2'];
  const params: any[] = [companyId, cuentaId];
  if (desde) { params.push(desde); cond.push(`e.fecha >= $${params.length}::date`); }
  if (hasta) { params.push(hasta); cond.push(`e.fecha <= $${params.length}::date`); }
  const r = await query<any>(
    `SELECT DISTINCT EXTRACT(YEAR FROM e.fecha)::int AS anio
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE ${cond.join(' AND ')}`, params);
  return r.rows.map((x: any) => Number(x.anio)).filter(Boolean);
}

async function recalcularAnios(companyId: string, anios: number[], userId?: string) {
  for (const anio of anios) {
    for (let mes = 1; mes <= 12; mes++) {
      try { await alimentarDesdePolizas(companyId, anio, mes, { userId }); } catch { /* cerrado/vacío */ }
    }
  }
}

export async function reasignarMovimientos(
  companyId: string, origenId: string, destinoId: string,
  opts: { desde?: string; hasta?: string; userId?: string } = {}
): Promise<{ partidas: number; anios: number[] }> {
  if (!origenId || !destinoId) throw new Error('Falta la cuenta origen o destino.');
  if (origenId === destinoId) throw new Error('La cuenta origen y la destino no pueden ser la misma.');
  const ctas = await query<any>(
    `SELECT id, permite_movimientos FROM accounting_accounts WHERE company_id=$1 AND id = ANY($2)`,
    [companyId, [origenId, destinoId]]);
  if (ctas.rows.length < 2) throw new Error('No encontré la cuenta origen o la destino.');
  const dest = ctas.rows.find((c: any) => c.id === destinoId);
  if (dest && !dest.permite_movimientos) throw new Error('La cuenta destino no admite movimientos (elige una cuenta de detalle).');

  // Fechas de rango válidas (año 2000-2199). Una fecha malformada —p.ej. «0026» por
  // teclear el año a 2 dígitos— se ignora, para no dejar el rango vacío y reasignar 0.
  const okFecha = (d?: string) => (d && /^(20|21)\d{2}-\d{2}-\d{2}$/.test(d)) ? d : undefined;
  const desde = okFecha(opts.desde);
  const hasta = okFecha(opts.hasta);
  const anios = await aniosDeCuenta(companyId, origenId, desde, hasta);
  const cond = ['e.company_id=$1', 'l.account_id=$2'];
  const params: any[] = [companyId, origenId, destinoId];
  if (desde) { params.push(desde); cond.push(`e.fecha >= $${params.length}::date`); }
  if (hasta) { params.push(hasta); cond.push(`e.fecha <= $${params.length}::date`); }
  const r = await query(
    `UPDATE journal_lines l SET account_id = $3
       FROM journal_entries e
      WHERE e.id = l.entry_id AND ${cond.join(' AND ')}`, params);
  await recalcularAnios(companyId, anios, opts.userId);
  return { partidas: r.rowCount || 0, anios };
}

export async function fusionarCuenta(
  companyId: string, origenId: string, destinoId: string, userId?: string
): Promise<{ partidas: number; anios: number[] }> {
  if (!origenId || !destinoId) throw new Error('Falta la cuenta origen o destino.');
  if (origenId === destinoId) throw new Error('No puedes fusionar una cuenta consigo misma.');
  const anios = await aniosDeCuenta(companyId, origenId);
  const partidas = await transaction(async (client: PoolClient) => {
    const ctas = await client.query(
      `SELECT id FROM accounting_accounts WHERE company_id=$1 AND id = ANY($2)`,
      [companyId, [origenId, destinoId]]);
    if (ctas.rows.length < 2) throw new Error('No encontré la cuenta origen o la destino.');
    const r = await client.query(
      `UPDATE journal_lines l SET account_id=$2
         FROM journal_entries e
        WHERE e.id=l.entry_id AND e.company_id=$3 AND l.account_id=$1`,
      [origenId, destinoId, companyId]);
    // Reenganchar los hijos de la origen a la destino y quitar sus saldos (FK
    // RESTRICT) antes de borrarla.
    await client.query(`UPDATE accounting_accounts SET parent_id=$2 WHERE parent_id=$1 AND company_id=$3`,
      [origenId, destinoId, companyId]);
    await client.query(`DELETE FROM accounting_period_balances WHERE account_id=$1`, [origenId]);
    await client.query(`DELETE FROM accounting_accounts WHERE id=$1 AND company_id=$2`, [origenId, companyId]);
    return r.rowCount || 0;
  });
  await recalcularAnios(companyId, anios, userId);
  return { partidas, anios };
}

/**
 * Grupos de cuentas con el mismo nombre normalizado (mayúsculas, sin acentos) —
 * posibles duplicados por typo. Devuelve sólo los grupos con 2+ cuentas. `q` filtra
 * por texto en nombre o código.
 */
export async function candidatasDuplicadas(companyId: string, q?: string) {
  const r = await query<any>(
    `SELECT id, codigo, nombre, codigo_agrupador, tercero_rfc, permite_movimientos
       FROM accounting_accounts WHERE company_id=$1 ORDER BY nombre, codigo`, [companyId]);
  const filtro = norm(q || '');
  const grupos = new Map<string, any[]>();
  for (const c of r.rows) {
    const nombreN = norm(c.nombre);
    if (!nombreN) continue;
    if (filtro && !nombreN.includes(filtro) && !String(c.codigo).toLowerCase().includes((q || '').toLowerCase())) continue;
    if (!grupos.has(nombreN)) grupos.set(nombreN, []);
    grupos.get(nombreN)!.push(c);
  }
  return [...grupos.values()].filter((g) => g.length > 1).slice(0, 100);
}
