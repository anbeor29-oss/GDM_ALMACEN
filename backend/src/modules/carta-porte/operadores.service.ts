/**
 * operadores.service — figuras de transporte por empresa.
 * tipo_figura 01=Operador exige NumLicencia; los demás tipos no.
 */
import { pool } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';

const RFC_RE = /^([A-ZÑ&]{3,4})(\d{6})([A-Z\d]{3})$/i;

export interface OperadorInput {
  alias: string;
  tipoFigura: string;
  rfc: string;
  numLicencia?: string;
  nombre: string;
  numRegIdTrib?: string;
  residenciaFiscal?: string;
}

function normalize(input: any): OperadorInput {
  const req = (v: any, n: string) => {
    if (v == null || String(v).trim() === '') throw new ValidationError(`Requerido: ${n}`);
    return String(v).trim();
  };
  const opt = (v: any) => v == null || v === '' ? undefined : String(v).trim();
  const rfc = req(input.rfc, 'rfc').toUpperCase();
  if (!RFC_RE.test(rfc)) throw new ValidationError('RFC inválido');
  const tipo = req(input.tipoFigura, 'tipoFigura').padStart(2, '0');
  const numLic = opt(input.numLicencia);
  if (tipo === '01' && !numLic) throw new ValidationError('numLicencia es obligatorio para tipo Operador (01)');
  return {
    alias: req(input.alias, 'alias').slice(0, 60),
    tipoFigura: tipo,
    rfc,
    numLicencia: numLic?.slice(0, 20),
    nombre: req(input.nombre, 'nombre').slice(0, 300),
    numRegIdTrib: opt(input.numRegIdTrib)?.slice(0, 40),
    residenciaFiscal: opt(input.residenciaFiscal)?.toUpperCase()?.slice(0, 3),
  };
}

export async function list(companyId: string, opts: { q?: string; tipo?: string; incluirInactivos?: boolean } = {}) {
  const params: any[] = [companyId];
  const filters = ['company_id = $1'];
  if (!opts.incluirInactivos) filters.push('activo = true');
  if (opts.q) {
    params.push(`%${opts.q}%`);
    filters.push(`(alias ILIKE $${params.length} OR nombre ILIKE $${params.length} OR rfc ILIKE $${params.length})`);
  }
  if (opts.tipo) {
    params.push(String(opts.tipo).padStart(2, '0'));
    filters.push(`tipo_figura = $${params.length}`);
  }
  const r = await pool.query(
    `SELECT * FROM cp_operadores WHERE ${filters.join(' AND ')} ORDER BY usos DESC, alias ASC LIMIT 200`,
    params,
  );
  return r.rows;
}

export async function create(companyId: string, input: any) {
  const d = normalize(input);
  const r = await pool.query(
    `INSERT INTO cp_operadores (
       company_id, alias, tipo_figura, rfc, num_licencia, nombre,
       num_reg_id_trib, residencia_fiscal
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (company_id, alias) DO UPDATE SET
       tipo_figura = EXCLUDED.tipo_figura,
       rfc = EXCLUDED.rfc,
       num_licencia = EXCLUDED.num_licencia,
       nombre = EXCLUDED.nombre,
       num_reg_id_trib = EXCLUDED.num_reg_id_trib,
       residencia_fiscal = EXCLUDED.residencia_fiscal,
       activo = true,
       updated_at = NOW()
     RETURNING *`,
    [
      companyId, d.alias, d.tipoFigura, d.rfc, d.numLicencia ?? null, d.nombre,
      d.numRegIdTrib ?? null, d.residenciaFiscal ?? null,
    ],
  );
  return r.rows[0];
}

export async function update(companyId: string, id: string, input: any) {
  const d = normalize(input);
  const r = await pool.query(
    `UPDATE cp_operadores SET
       alias=$3, tipo_figura=$4, rfc=$5, num_licencia=$6, nombre=$7,
       num_reg_id_trib=$8, residencia_fiscal=$9, updated_at=NOW()
     WHERE id=$1 AND company_id=$2 RETURNING *`,
    [
      id, companyId, d.alias, d.tipoFigura, d.rfc, d.numLicencia ?? null, d.nombre,
      d.numRegIdTrib ?? null, d.residenciaFiscal ?? null,
    ],
  );
  if (!r.rowCount) throw new ValidationError('Operador no encontrado');
  return r.rows[0];
}

export async function deactivate(companyId: string, id: string) {
  const r = await pool.query(
    `UPDATE cp_operadores SET activo=false, updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING id`,
    [id, companyId],
  );
  return { removed: r.rowCount ?? 0 };
}
