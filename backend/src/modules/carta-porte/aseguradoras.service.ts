/**
 * aseguradoras.service — pólizas por empresa. Un vehículo puede tener 1..3
 * pólizas asociadas (RespCivil obligatoria + MedAmbiente si transporta
 * materiales peligrosos + Carga si el cliente lo pide).
 */
import { pool } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';

const TIPOS = ['RespCivil', 'MedAmbiente', 'Carga'] as const;
type Tipo = typeof TIPOS[number];

export interface AseguradoraInput {
  alias: string;
  tipo: Tipo;
  nombreAseguradora: string;
  numPoliza: string;
  primaSeguro?: number;
}

function normalize(input: any): AseguradoraInput {
  const req = (v: any, n: string) => {
    if (v == null || String(v).trim() === '') throw new ValidationError(`Requerido: ${n}`);
    return String(v).trim();
  };
  const opt = (v: any) => v == null || v === '' ? undefined : String(v).trim();
  const tipo = req(input.tipo, 'tipo');
  if (!TIPOS.includes(tipo as Tipo)) throw new ValidationError('tipo debe ser RespCivil, MedAmbiente o Carga');
  const prima = input.primaSeguro == null || input.primaSeguro === '' ? undefined : Number(input.primaSeguro);
  if (prima !== undefined && !Number.isFinite(prima)) throw new ValidationError('primaSeguro debe ser numérico');
  return {
    alias: req(input.alias, 'alias').slice(0, 60),
    tipo: tipo as Tipo,
    nombreAseguradora: req(input.nombreAseguradora, 'nombreAseguradora').slice(0, 150),
    numPoliza: req(input.numPoliza, 'numPoliza').slice(0, 50),
    primaSeguro: prima,
  };
}

export async function list(companyId: string, opts: { q?: string; tipo?: string; incluirInactivos?: boolean } = {}) {
  const params: any[] = [companyId];
  const filters = ['company_id = $1'];
  if (!opts.incluirInactivos) filters.push('activo = true');
  if (opts.q) {
    params.push(`%${opts.q}%`);
    filters.push(`(alias ILIKE $${params.length} OR nombre_aseguradora ILIKE $${params.length} OR num_poliza ILIKE $${params.length})`);
  }
  if (opts.tipo && TIPOS.includes(opts.tipo as Tipo)) {
    params.push(opts.tipo);
    filters.push(`tipo = $${params.length}`);
  }
  const r = await pool.query(
    `SELECT * FROM cp_aseguradoras WHERE ${filters.join(' AND ')} ORDER BY usos DESC, alias ASC LIMIT 200`,
    params,
  );
  return r.rows;
}

export async function create(companyId: string, input: any) {
  const d = normalize(input);
  const r = await pool.query(
    `INSERT INTO cp_aseguradoras (company_id, alias, tipo, nombre_aseguradora, num_poliza, prima_seguro)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (company_id, alias) DO UPDATE SET
       tipo = EXCLUDED.tipo,
       nombre_aseguradora = EXCLUDED.nombre_aseguradora,
       num_poliza = EXCLUDED.num_poliza,
       prima_seguro = EXCLUDED.prima_seguro,
       activo = true,
       updated_at = NOW()
     RETURNING *`,
    [companyId, d.alias, d.tipo, d.nombreAseguradora, d.numPoliza, d.primaSeguro ?? null],
  );
  return r.rows[0];
}

export async function update(companyId: string, id: string, input: any) {
  const d = normalize(input);
  const r = await pool.query(
    `UPDATE cp_aseguradoras SET
       alias=$3, tipo=$4, nombre_aseguradora=$5, num_poliza=$6, prima_seguro=$7, updated_at=NOW()
     WHERE id=$1 AND company_id=$2 RETURNING *`,
    [id, companyId, d.alias, d.tipo, d.nombreAseguradora, d.numPoliza, d.primaSeguro ?? null],
  );
  if (!r.rowCount) throw new ValidationError('Aseguradora no encontrada');
  return r.rows[0];
}

export async function deactivate(companyId: string, id: string) {
  const r = await pool.query(
    `UPDATE cp_aseguradoras SET activo=false, updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING id`,
    [id, companyId],
  );
  return { removed: r.rowCount ?? 0 };
}
