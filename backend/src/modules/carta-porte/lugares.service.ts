/**
 * lugares.service — catálogo de ubicaciones frecuentes por empresa.
 *
 * Diseño:
 *   · Todos los queries filtran por company_id del JWT (nadie ve lugares
 *     de otra empresa).
 *   · alias es UNIQUE por empresa: sirve como identificador humano y evita
 *     duplicados accidentales.
 *   · usos es un contador que se incrementa cada vez que se aplica el
 *     lugar en una Carta Porte; permite ordenar por más frecuentes.
 */

import { pool } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';

export interface LugarInput {
  alias: string;
  tipoDefault?: 'Origen' | 'Destino';
  rfc: string;
  nombre?: string;
  numRegIdTrib?: string;
  residenciaFiscal?: string;
  calle?: string;
  numExterior?: string;
  numInterior?: string;
  colonia?: string;
  localidad?: string;
  referencia?: string;
  municipio?: string;
  estado: string;
  pais?: string;
  codigoPostal: string;
}

const RFC_RE = /^([A-ZÑ&]{3,4})(\d{6})([A-Z\d]{3})$/i;
const CP_RE = /^\d{5}$/;

function normalize(input: any): LugarInput {
  const req = (v: any, n: string) => {
    if (!v || String(v).trim() === '') throw new ValidationError(`Campo requerido: ${n}`);
    return String(v).trim();
  };
  const opt = (v: any) => v == null || v === '' ? undefined : String(v).trim();

  const rfc = req(input.rfc, 'rfc').toUpperCase();
  if (!RFC_RE.test(rfc)) throw new ValidationError('RFC inválido');
  const cp = req(input.codigoPostal, 'codigoPostal');
  if (!CP_RE.test(cp)) throw new ValidationError('Código postal debe ser 5 dígitos');

  const tipo = opt(input.tipoDefault);
  if (tipo && tipo !== 'Origen' && tipo !== 'Destino') {
    throw new ValidationError('tipoDefault debe ser Origen o Destino');
  }
  return {
    alias: req(input.alias, 'alias').slice(0, 60),
    tipoDefault: tipo as any,
    rfc,
    nombre: opt(input.nombre)?.slice(0, 300),
    numRegIdTrib: opt(input.numRegIdTrib),
    residenciaFiscal: opt(input.residenciaFiscal)?.toUpperCase(),
    calle: opt(input.calle),
    numExterior: opt(input.numExterior),
    numInterior: opt(input.numInterior),
    colonia: opt(input.colonia),
    localidad: opt(input.localidad),
    referencia: opt(input.referencia),
    municipio: opt(input.municipio),
    estado: req(input.estado, 'estado').toUpperCase().slice(0, 3),
    pais: (opt(input.pais) || 'MEX').toUpperCase().slice(0, 3),
    codigoPostal: cp,
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
  if (opts.tipo === 'Origen' || opts.tipo === 'Destino') {
    params.push(opts.tipo);
    filters.push(`(tipo_default = $${params.length} OR tipo_default IS NULL)`);
  }
  const r = await pool.query(
    `SELECT * FROM cp_lugares WHERE ${filters.join(' AND ')}
      ORDER BY usos DESC, alias ASC LIMIT 200`,
    params,
  );
  return r.rows;
}

export async function getById(companyId: string, id: string) {
  const r = await pool.query('SELECT * FROM cp_lugares WHERE id = $1 AND company_id = $2', [id, companyId]);
  return r.rows[0] || null;
}

export async function create(companyId: string, input: any) {
  const d = normalize(input);
  const r = await pool.query(
    `INSERT INTO cp_lugares (
       company_id, alias, tipo_default, rfc, nombre,
       num_reg_id_trib, residencia_fiscal,
       calle, num_exterior, num_interior, colonia, localidad,
       referencia, municipio, estado, pais, codigo_postal
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (company_id, alias) DO UPDATE SET
       tipo_default = EXCLUDED.tipo_default,
       rfc = EXCLUDED.rfc,
       nombre = EXCLUDED.nombre,
       num_reg_id_trib = EXCLUDED.num_reg_id_trib,
       residencia_fiscal = EXCLUDED.residencia_fiscal,
       calle = EXCLUDED.calle,
       num_exterior = EXCLUDED.num_exterior,
       num_interior = EXCLUDED.num_interior,
       colonia = EXCLUDED.colonia,
       localidad = EXCLUDED.localidad,
       referencia = EXCLUDED.referencia,
       municipio = EXCLUDED.municipio,
       estado = EXCLUDED.estado,
       pais = EXCLUDED.pais,
       codigo_postal = EXCLUDED.codigo_postal,
       activo = true,
       updated_at = NOW()
     RETURNING *`,
    [
      companyId, d.alias, d.tipoDefault, d.rfc, d.nombre,
      d.numRegIdTrib, d.residenciaFiscal,
      d.calle, d.numExterior, d.numInterior, d.colonia, d.localidad,
      d.referencia, d.municipio, d.estado, d.pais, d.codigoPostal,
    ],
  );
  return r.rows[0];
}

export async function update(companyId: string, id: string, input: any) {
  const d = normalize(input);
  const r = await pool.query(
    `UPDATE cp_lugares SET
       alias = $3, tipo_default = $4, rfc = $5, nombre = $6,
       num_reg_id_trib = $7, residencia_fiscal = $8,
       calle = $9, num_exterior = $10, num_interior = $11, colonia = $12,
       localidad = $13, referencia = $14, municipio = $15,
       estado = $16, pais = $17, codigo_postal = $18,
       updated_at = NOW()
     WHERE id = $1 AND company_id = $2
     RETURNING *`,
    [
      id, companyId, d.alias, d.tipoDefault, d.rfc, d.nombre,
      d.numRegIdTrib, d.residenciaFiscal,
      d.calle, d.numExterior, d.numInterior, d.colonia, d.localidad,
      d.referencia, d.municipio, d.estado, d.pais, d.codigoPostal,
    ],
  );
  if (!r.rowCount) throw new ValidationError('Lugar no encontrado');
  return r.rows[0];
}

export async function deactivate(companyId: string, id: string) {
  const r = await pool.query(
    `UPDATE cp_lugares SET activo = false, updated_at = NOW()
      WHERE id = $1 AND company_id = $2 RETURNING id`,
    [id, companyId],
  );
  return { removed: r.rowCount ?? 0 };
}

/** Se llama al guardar la CP: si el alias no existe lo crea; si existe lo
 *  reutiliza. En cualquier caso incrementa `usos`. */
export async function upsertAndTouch(companyId: string, input: any) {
  const row = await create(companyId, input);
  await pool.query('UPDATE cp_lugares SET usos = usos + 1 WHERE id = $1', [row.id]);
  return row;
}
