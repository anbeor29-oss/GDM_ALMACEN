/**
 * Programación del motor: calcula la PRÓXIMA ejecución de una empresa+tipo.
 *
 * Regla indicada por el usuario: SAT y CSF se refrescan el DÍA 1; IMSS el DÍA 17.
 * Prioridad: si la config define frecuencia_dias → cada N días; si define
 * dia_mes → ese día del mes; si no → el default por tipo. MANUAL no se programa.
 * La hora se fija a las 06:00 del servidor (Render corre en UTC).
 */
import { query } from '../../config/database';
import type { OrganismoTipo } from './types';

const DIA_DEFAULT: Record<OrganismoTipo, number> = { SAT: 1, CSF: 1, IMSS: 17, INFONAVIT: 17 };

interface ProgCfg { modo?: string; dia_mes?: number | null; frecuencia_dias?: number | null; }

export function proximaFecha(cfg: ProgCfg, tipo: OrganismoTipo, desde = new Date()): Date | null {
  if (cfg.modo === 'MANUAL' || !cfg.modo) return null;
  if (cfg.frecuencia_dias && cfg.frecuencia_dias > 0) {
    const d = new Date(desde);
    d.setDate(d.getDate() + cfg.frecuencia_dias);
    return d;
  }
  const dia = cfg.dia_mes && cfg.dia_mes >= 1 && cfg.dia_mes <= 28 ? cfg.dia_mes : DIA_DEFAULT[tipo];
  // Próximo día `dia`: si aún no pasa este mes, este mes; si ya pasó, el siguiente.
  const d = new Date(desde.getFullYear(), desde.getMonth(), dia, 6, 0, 0);
  if (d <= desde) d.setMonth(d.getMonth() + 1);
  return d;
}

export async function calcularProxima(companyId: string, tipo: OrganismoTipo): Promise<Date | null> {
  const r = await query<any>(
    `SELECT modo, dia_mes, frecuencia_dias FROM cumplimiento_config WHERE company_id=$1 AND tipo=$2`,
    [companyId, tipo]);
  if (!r.rows.length) return null;
  return proximaFecha(r.rows[0], tipo);
}

/** Config activas, en automático, cuya próxima ejecución ya venció (scheduler). */
export async function pendientes(): Promise<Array<{ company_id: string; tipo: OrganismoTipo }>> {
  const r = await query<any>(
    `SELECT company_id, tipo FROM cumplimiento_config
      WHERE activo = true AND modo IN ('AUTOMATICO','AMBOS')
        AND (proxima_ejecucion IS NULL OR proxima_ejecucion <= NOW())`);
  return r.rows;
}
