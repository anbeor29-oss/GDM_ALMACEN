/**
 * Conceptos de nómina y su cuenta — la config de la que sale la póliza de pasivo.
 * La lista es de código (nomina-conceptos.data); aquí se le pega la cuenta que
 * cada empresa asignó y se guarda cuando cambia.
 */
import { query } from '../../config/database';
import { CONCEPTOS_NOMINA, GrupoConcepto } from './nomina-conceptos.data';

/** El catálogo con la cuenta asignada de la empresa pegada a cada concepto. */
export async function conceptosConCuenta(companyId: string) {
  const r = await query<any>(
    `SELECT grupo, clave, cuenta_codigo FROM nomina_concepto_cuenta WHERE company_id=$1`,
    [companyId]);
  const asignadas = new Map<string, string>();
  for (const row of r.rows) asignadas.set(`${row.grupo}|${row.clave}`, row.cuenta_codigo);

  return CONCEPTOS_NOMINA.map((c) => ({
    ...c,
    cuenta: asignadas.get(`${c.grupo}|${c.clave}`) || null,
  }));
}

/** Asigna (o limpia con null) la cuenta de un concepto. */
export async function asignarCuentaConcepto(
  companyId: string, grupo: string, clave: string, cuenta: string | null
): Promise<boolean> {
  // Sólo conceptos que existen en el catálogo de código.
  const existe = CONCEPTOS_NOMINA.some((c) => c.grupo === grupo && c.clave === clave);
  if (!existe) return false;

  await query(
    `INSERT INTO nomina_concepto_cuenta (company_id, grupo, clave, cuenta_codigo, updated_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (company_id, grupo, clave)
       DO UPDATE SET cuenta_codigo = EXCLUDED.cuenta_codigo, updated_at = NOW()`,
    [companyId, grupo, clave, cuenta ? cuenta.trim().slice(0, 40) || null : null]);
  return true;
}

/** Cuántos conceptos de un grupo siguen sin cuenta (para avisar antes de armar la póliza). */
export async function faltantesPorGrupo(companyId: string): Promise<Record<GrupoConcepto, number>> {
  const lista = await conceptosConCuenta(companyId);
  const out = { PERCEPCION: 0, DEDUCCION: 0, NETO: 0, PROVISION: 0 } as Record<GrupoConcepto, number>;
  for (const c of lista) if (!c.cuenta) out[c.grupo]++;
  return out;
}
