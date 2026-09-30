/**
 * Programación del motor: la PRÓXIMA ejecución automática.
 *
 * Regla (indicada por el usuario, 2026-09-30): se refresca **todos los domingos
 * en la noche** — global, no por día del mes. MANUAL no se programa. Cada corrida
 * SUSTITUYE la opinión anterior (no se acumula; ver compliance.service).
 */
import { query } from '../../config/database';
import type { OrganismoTipo } from './types';

interface ProgCfg { modo?: string }

/** El próximo domingo ~22:00 (hora del servidor). */
export function proximoDomingoNoche(desde = new Date()): Date {
  const d = new Date(desde);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));   // avanza al domingo (getDay 0)
  d.setHours(22, 0, 0, 0);
  if (d <= desde) d.setDate(d.getDate() + 7);
  return d;
}

/** Próxima ejecución = domingo en la noche para cualquier config en automático. */
export function proximaFecha(cfg: ProgCfg, _tipo: OrganismoTipo, desde = new Date()): Date | null {
  if (!cfg.modo || cfg.modo === 'MANUAL') return null;
  return proximoDomingoNoche(desde);
}

export async function calcularProxima(companyId: string, tipo: OrganismoTipo): Promise<Date | null> {
  const r = await query<any>(`SELECT modo FROM cumplimiento_config WHERE company_id=$1 AND tipo=$2`, [companyId, tipo]);
  if (!r.rows.length) return null;
  return proximaFecha(r.rows[0], tipo);
}

/** Config marcadas «Activa» que SatGo puede bajar (INFONAVIT es manual). El barrido
 *  dominical las recorre; basta con marcar «Activa» en Configurar (no depende de modo). */
export async function todasActivas(): Promise<Array<{ company_id: string; tipo: OrganismoTipo }>> {
  const r = await query<any>(
    `SELECT company_id, tipo FROM cumplimiento_config
      WHERE activo = true AND tipo IN ('SAT','CSF','IMSS')`);
  return r.rows;
}
