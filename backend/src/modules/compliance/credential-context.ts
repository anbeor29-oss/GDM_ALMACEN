/**
 * EphemeralCredentialContext — carga la config cifrada de una empresa+tipo,
 * descifra sus secretos SÓLO en memoria y los suelta al terminar (dispose()).
 *
 * NEXO CONSERVA las credenciales cifradas en la BD (facturación y descarga de
 * XML corren a diario, decisión de negocio del usuario). Aun así, en CLARO viven
 * lo mínimo: se descifran al ejecutar y se sueltan al cerrar; nunca se registran
 * ni se serializan. (Las cadenas en JS son inmutables: no se pueden "borrar" a
 * cero, pero al soltar la referencia quedan para el GC y fuera de todo log.)
 */
import { query } from '../../config/database';
import { descifrarTexto, bovedaLista } from '../sat-descarga/boveda';
import type { CredContext, MetodoObtencion, OrganismoTipo } from './types';

export class EphemeralCredentialContext implements CredContext {
  metodo: MetodoObtencion = 'API';
  baseUrl?: string;
  usuario?: string;
  credencial?: string;
  token?: string;
  extra?: any;
  activo = false;

  private constructor() {}

  /** Devuelve el contexto de la empresa+tipo, o null si no hay configuración. */
  static async cargar(companyId: string, tipo: OrganismoTipo): Promise<EphemeralCredentialContext | null> {
    const r = await query<any>(
      `SELECT metodo, base_url, usuario, credencial, token, extra, activo
         FROM cumplimiento_config WHERE company_id=$1 AND tipo=$2`,
      [companyId, tipo]);
    if (!r.rows.length) return null;
    const row = r.rows[0];
    const ctx = new EphemeralCredentialContext();
    ctx.metodo = (row.metodo || 'API') as MetodoObtencion;
    ctx.baseUrl = row.base_url || undefined;
    ctx.usuario = row.usuario || undefined;
    ctx.extra = row.extra || undefined;
    ctx.activo = row.activo === true;
    // Descifra sólo si la bóveda está lista. Si no, se deja sin secreto y el
    // adaptador decidirá si puede operar (p.ej. consulta pública por RFC).
    if (bovedaLista()) {
      if (row.credencial) ctx.credencial = descifrarTexto(row.credencial);
      if (row.token) ctx.token = descifrarTexto(row.token);
    }
    return ctx;
  }

  /** Suelta los secretos en claro para que no sobrevivan al uso. */
  dispose(): void {
    this.credencial = undefined;
    this.token = undefined;
  }
}
