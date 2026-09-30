/**
 * Motor de cumplimiento — orquesta un intento de obtener la opinión/constancia:
 *   1) carga la config + descifra credenciales (EphemeralCredentialContext),
 *   2) abre una ejecución en la bitácora (compliance_execution = STARTED),
 *   3) llama al adaptador del organismo (IComplianceProvider),
 *   4) si SUCCESS con PDF, guarda la evidencia (opinion_cumplimiento + sha256 + liga),
 *   5) cierra la ejecución y actualiza la programación (última/próxima),
 *   6) SIEMPRE suelta los secretos (dispose), pase lo que pase.
 *
 * Nunca registra secretos. CAPTCHA/MFA lo maneja el adaptador → REQUIRES_USER_ACTION.
 * Un error técnico jamás se guarda como opinión NEGATIVA.
 */
import * as crypto from 'crypto';
import { query } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import { EphemeralCredentialContext } from './credential-context';
import { getProvider } from './providers';
import { calcularProxima } from './programacion';
import type { ComplianceResult, CredContext, Disparo, OrganismoTipo } from './types';

const TIPOS: OrganismoTipo[] = ['SAT', 'IMSS', 'INFONAVIT', 'CSF'];

function sha256DePdf(dataUrl: string): string {
  const b64 = dataUrl.replace(/^data:application\/pdf;base64,/, '');
  return crypto.createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');
}

export async function ejecutar(
  companyId: string,
  tipo: OrganismoTipo,
  disparo: Disparo = 'MANUAL',
  userId?: string,
): Promise<ComplianceResult> {
  if (!TIPOS.includes(tipo)) throw new ValidationError('Tipo inválido (SAT, IMSS, INFONAVIT o CSF).');

  const emp = await query<any>(`SELECT rfc FROM companies WHERE id=$1`, [companyId]);
  const rfc: string | undefined = emp.rows[0]?.rfc || undefined;

  const cred = await EphemeralCredentialContext.cargar(companyId, tipo);

  // Si lo dispara el programador y no hay config activa, se salta sin registrar ruido.
  if (disparo === 'SCHEDULER' && !(cred && cred.activo)) {
    return { executionId: '', estado: 'SKIPPED', mensaje: 'Sin configuración activa.' };
  }

  const ex = await query<any>(
    `INSERT INTO compliance_execution (company_id, tipo, disparo, metodo, estado, created_by)
     VALUES ($1,$2,$3,$4,'STARTED',$5) RETURNING id`,
    [companyId, tipo, disparo, cred?.metodo || null, userId || null]);
  const executionId: string = ex.rows[0].id;
  const t0 = Date.now();

  try {
    const provider = await getProvider(tipo);
    const r = await provider.ejecutar(
      { companyId, tipo, rfc, disparo, userId },
      cred || ({ metodo: 'API' } as CredContext),
    );

    let resultadoId: string | undefined;
    if (r.estado === 'SUCCESS' && r.pdfBase64) {
      const sha = sha256DePdf(r.pdfBase64);
      const ins = await query<any>(
        `INSERT INTO opinion_cumplimiento
           (company_id, tipo, sentido, fecha_opinion, folio, observaciones, pdf, sha256, execution_id, origen, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'MOTOR',$10) RETURNING id`,
        [companyId, tipo, r.sentido || 'OTRO',
         r.fechaOpinion || new Date().toISOString().slice(0, 10),
         r.folio || null, r.observaciones || null, r.pdfBase64, sha, executionId, userId || null]);
      resultadoId = ins.rows[0].id;
    }

    await query(
      `UPDATE compliance_execution
          SET estado=$2, http_status=$3, mensaje=$4, resultado_id=$5, duracion_ms=$6, terminado_at=NOW()
        WHERE id=$1`,
      [executionId, r.estado, r.httpStatus ?? null, r.mensaje || null, resultadoId || null, Date.now() - t0]);

    // Programación: registra la última corrida y calcula la próxima (si hay config).
    if (cred) {
      const proxima = await calcularProxima(companyId, tipo);
      await query(
        `UPDATE cumplimiento_config
            SET ultima_ejecucion=NOW(), ultimo_estado=$3, proxima_ejecucion=$4
          WHERE company_id=$1 AND tipo=$2`,
        [companyId, tipo, r.estado, proxima]);
    }

    return { executionId, resultadoId, ...r };
  } catch (e: any) {
    const msg = String(e?.message || 'Error inesperado').slice(0, 500);
    await query(
      `UPDATE compliance_execution SET estado='ERROR', mensaje=$2, duracion_ms=$3, terminado_at=NOW() WHERE id=$1`,
      [executionId, msg, Date.now() - t0]);
    return { executionId, estado: 'ERROR', mensaje: msg };
  } finally {
    cred?.dispose();
  }
}

/** Ejecuta los tipos de una empresa en serie (para el botón "Consultar todo"). */
export async function ejecutarTodos(
  companyId: string,
  tipos: OrganismoTipo[] = TIPOS,
  disparo: Disparo = 'MANUAL',
  userId?: string,
): Promise<Record<string, ComplianceResult>> {
  const out: Record<string, ComplianceResult> = {};
  for (const t of tipos) out[t] = await ejecutar(companyId, t, disparo, userId);
  return out;
}

/** Bitácora reciente de ejecuciones de una empresa (sin secretos). */
export async function bitacora(companyId: string, limite = 50) {
  const r = await query<any>(
    `SELECT id, tipo, disparo, metodo, estado, http_status, mensaje,
            (resultado_id IS NOT NULL) AS con_evidencia, duracion_ms,
            TO_CHAR(iniciado_at,'YYYY-MM-DD HH24:MI:SS') AS iniciado
       FROM compliance_execution
      WHERE company_id=$1 ORDER BY iniciado_at DESC LIMIT $2`,
    [companyId, Math.min(Math.max(limite, 1), 200)]);
  return r.rows;
}
