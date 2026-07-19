/**
 * vehiculos.service — flota de la empresa para Carta Porte.
 * Cada vehículo puede referenciar hasta 3 aseguradoras (RespCivil obligatoria,
 * MedAmbiente si peligroso, Carga si aplica).
 */
import { pool } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';

const PLACA_RE = /^[A-Z0-9]{5,10}$/;

export interface VehiculoInput {
  alias: string;
  permSct: string;
  numPermisoSct: string;
  configVehicular: string;
  pesoBrutoVehicular: number;
  placaVm: string;
  anioModeloVm: number;
  aseguradoraRespCivilId?: string | null;
  aseguradoraMedAmbId?: string | null;
  aseguradoraCargaId?: string | null;
}

function normalize(input: any): VehiculoInput {
  const req = (v: any, n: string) => {
    if (v == null || String(v).trim() === '') throw new ValidationError(`Requerido: ${n}`);
    return String(v).trim();
  };
  const opt = (v: any) => v == null || v === '' ? null : String(v);
  const peso = Number(input.pesoBrutoVehicular);
  if (!Number.isFinite(peso) || peso <= 0) throw new ValidationError('pesoBrutoVehicular > 0');
  const anio = Number(input.anioModeloVm);
  const anioMax = new Date().getFullYear() + 2;
  if (!Number.isInteger(anio) || anio < 1900 || anio > anioMax) {
    throw new ValidationError(`anioModeloVm debe estar entre 1900 y ${anioMax}`);
  }
  const placa = req(input.placaVm, 'placaVm').toUpperCase();
  if (!PLACA_RE.test(placa)) throw new ValidationError('placaVm inválida (5-10 alfanuméricos)');
  return {
    alias: req(input.alias, 'alias').slice(0, 60),
    permSct: req(input.permSct, 'permSct').slice(0, 10),
    numPermisoSct: req(input.numPermisoSct, 'numPermisoSct').slice(0, 50),
    configVehicular: req(input.configVehicular, 'configVehicular').slice(0, 4),
    pesoBrutoVehicular: peso,
    placaVm: placa,
    anioModeloVm: anio,
    aseguradoraRespCivilId: opt(input.aseguradoraRespCivilId),
    aseguradoraMedAmbId: opt(input.aseguradoraMedAmbId),
    aseguradoraCargaId: opt(input.aseguradoraCargaId),
  };
}

/** Lista vehículos con las aseguradoras hidratadas (JOIN LEFT). */
export async function list(companyId: string, opts: { q?: string; incluirInactivos?: boolean } = {}) {
  const params: any[] = [companyId];
  const filters = ['v.company_id = $1'];
  if (!opts.incluirInactivos) filters.push('v.activo = true');
  if (opts.q) {
    params.push(`%${opts.q}%`);
    filters.push(`(v.alias ILIKE $${params.length} OR v.placa_vm ILIKE $${params.length} OR v.num_permiso_sct ILIKE $${params.length})`);
  }
  const r = await pool.query(
    `SELECT v.*,
            arc.nombre_aseguradora AS resp_civil_nombre, arc.num_poliza AS resp_civil_poliza,
            ama.nombre_aseguradora AS med_amb_nombre,    ama.num_poliza AS med_amb_poliza,
            aca.nombre_aseguradora AS carga_nombre,      aca.num_poliza AS carga_poliza
       FROM cp_vehiculos v
       LEFT JOIN cp_aseguradoras arc ON arc.id = v.aseguradora_resp_civil_id
       LEFT JOIN cp_aseguradoras ama ON ama.id = v.aseguradora_med_amb_id
       LEFT JOIN cp_aseguradoras aca ON aca.id = v.aseguradora_carga_id
      WHERE ${filters.join(' AND ')}
      ORDER BY v.usos DESC, v.alias ASC LIMIT 200`,
    params,
  );
  return r.rows;
}

export async function create(companyId: string, input: any) {
  const d = normalize(input);
  const r = await pool.query(
    `INSERT INTO cp_vehiculos (
       company_id, alias, perm_sct, num_permiso_sct, config_vehicular,
       peso_bruto_vehicular, placa_vm, anio_modelo_vm,
       aseguradora_resp_civil_id, aseguradora_med_amb_id, aseguradora_carga_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (company_id, alias) DO UPDATE SET
       perm_sct = EXCLUDED.perm_sct,
       num_permiso_sct = EXCLUDED.num_permiso_sct,
       config_vehicular = EXCLUDED.config_vehicular,
       peso_bruto_vehicular = EXCLUDED.peso_bruto_vehicular,
       placa_vm = EXCLUDED.placa_vm,
       anio_modelo_vm = EXCLUDED.anio_modelo_vm,
       aseguradora_resp_civil_id = EXCLUDED.aseguradora_resp_civil_id,
       aseguradora_med_amb_id    = EXCLUDED.aseguradora_med_amb_id,
       aseguradora_carga_id      = EXCLUDED.aseguradora_carga_id,
       activo = true,
       updated_at = NOW()
     RETURNING *`,
    [
      companyId, d.alias, d.permSct, d.numPermisoSct, d.configVehicular,
      d.pesoBrutoVehicular, d.placaVm, d.anioModeloVm,
      d.aseguradoraRespCivilId, d.aseguradoraMedAmbId, d.aseguradoraCargaId,
    ],
  );
  return r.rows[0];
}

export async function update(companyId: string, id: string, input: any) {
  const d = normalize(input);
  const r = await pool.query(
    `UPDATE cp_vehiculos SET
       alias=$3, perm_sct=$4, num_permiso_sct=$5, config_vehicular=$6,
       peso_bruto_vehicular=$7, placa_vm=$8, anio_modelo_vm=$9,
       aseguradora_resp_civil_id=$10, aseguradora_med_amb_id=$11, aseguradora_carga_id=$12,
       updated_at=NOW()
     WHERE id=$1 AND company_id=$2 RETURNING *`,
    [
      id, companyId, d.alias, d.permSct, d.numPermisoSct, d.configVehicular,
      d.pesoBrutoVehicular, d.placaVm, d.anioModeloVm,
      d.aseguradoraRespCivilId, d.aseguradoraMedAmbId, d.aseguradoraCargaId,
    ],
  );
  if (!r.rowCount) throw new ValidationError('Vehículo no encontrado');
  return r.rows[0];
}

export async function deactivate(companyId: string, id: string) {
  const r = await pool.query(
    `UPDATE cp_vehiculos SET activo=false, updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING id`,
    [id, companyId],
  );
  return { removed: r.rowCount ?? 0 };
}
