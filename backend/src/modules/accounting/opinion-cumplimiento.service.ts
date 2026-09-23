/**
 * Opinión de Cumplimiento — SAT (32-D), IMSS e INFONAVIT.
 *
 * Registro y seguimiento de las tres opiniones: la más reciente por tipo es la
 * vigente; se conserva el histórico. La descarga automática es una fase posterior;
 * hoy se captura lo que se obtiene del portal de cada dependencia.
 */
import { query } from '../../config/database';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler';
import { cifrar, bovedaLista } from '../sat-descarga/boveda';

export const TIPOS = ['SAT', 'IMSS', 'INFONAVIT', 'CSF'] as const;
export const SENTIDOS = ['POSITIVA', 'NEGATIVA', 'SIN_ADEUDOS', 'SUSPENDIDA', 'VIGENTE', 'OTRO'] as const;
export const METODOS = ['PORTAL', 'API', 'EFIRMA'] as const;
const RX_PDF = /^data:application\/pdf;base64,[A-Za-z0-9+/=\s]+$/;

/** Resumen: la opinión vigente (más reciente) de cada tipo. */
export async function resumen(companyId: string) {
  const r = await query<any>(
    `SELECT DISTINCT ON (tipo) tipo, sentido,
            TO_CHAR(fecha_opinion,'YYYY-MM-DD') AS fecha_opinion, folio, observaciones,
            (pdf IS NOT NULL) AS tiene_pdf, id
       FROM opinion_cumplimiento
      WHERE company_id=$1
      ORDER BY tipo, fecha_opinion DESC, created_at DESC`,
    [companyId]);
  const porTipo: Record<string, any> = {};
  for (const x of r.rows) porTipo[x.tipo] = x;
  return { vigentes: porTipo };
}

/** Histórico de un tipo (o de todos si no se indica). */
export async function historial(companyId: string, tipo?: string) {
  const cond = ['company_id=$1']; const params: any[] = [companyId];
  if (tipo) { params.push(tipo); cond.push(`tipo=$${params.length}`); }
  const r = await query<any>(
    `SELECT id, tipo, sentido, TO_CHAR(fecha_opinion,'YYYY-MM-DD') AS fecha_opinion,
            folio, observaciones, (pdf IS NOT NULL) AS tiene_pdf,
            TO_CHAR(created_at,'YYYY-MM-DD HH24:MI') AS registrado
       FROM opinion_cumplimiento
      WHERE ${cond.join(' AND ')}
      ORDER BY fecha_opinion DESC, created_at DESC`,
    params);
  return r.rows;
}

export async function registrar(companyId: string, d: any, userId?: string) {
  const tipo = String(d?.tipo || '').toUpperCase();
  if (!TIPOS.includes(tipo as any)) throw new ValidationError('Tipo inválido (SAT, IMSS o INFONAVIT).');
  const sentido = String(d?.sentido || 'POSITIVA').toUpperCase();
  if (!SENTIDOS.includes(sentido as any)) throw new ValidationError('Sentido inválido.');
  const fecha = String(d?.fecha_opinion || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ValidationError('Fecha de la opinión inválida (AAAA-MM-DD).');
  const pdf = d?.pdf ? String(d.pdf) : null;
  if (pdf && !RX_PDF.test(pdf)) throw new ValidationError('El PDF debe ser un archivo .pdf.');
  if (pdf && pdf.length > 2_200_000) throw new ValidationError('El PDF es muy grande (máximo ~1.5 MB).');

  const r = await query<any>(
    `INSERT INTO opinion_cumplimiento (company_id, tipo, sentido, fecha_opinion, folio, observaciones, pdf, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [companyId, tipo, sentido, fecha, d?.folio || null, d?.observaciones || null, pdf, userId || null]);
  return { id: r.rows[0].id };
}

export async function borrar(companyId: string, id: string) {
  const r = await query<any>(`DELETE FROM opinion_cumplimiento WHERE id=$1 AND company_id=$2 RETURNING id`, [id, companyId]);
  if (!r.rows.length) throw new NotFoundError('Registro no encontrado');
  return { borrado: true };
}

export async function pdfDe(companyId: string, id: string): Promise<string> {
  const r = await query<any>(`SELECT pdf FROM opinion_cumplimiento WHERE id=$1 AND company_id=$2`, [id, companyId]);
  if (!r.rows.length || !r.rows[0].pdf) throw new NotFoundError('Sin PDF para este registro');
  return r.rows[0].pdf;
}

/* ─────────────────── CONFIGURACIÓN de la descarga automática ─────────────────── */

/** La config de un tipo SIN secretos: dice si hay contraseña/token guardados, no cuáles. */
export async function getConfig(companyId: string, tipo: string) {
  const r = await query<any>(
    `SELECT metodo, base_url, usuario, extra, activo,
            (credencial IS NOT NULL) AS tiene_credencial,
            (token IS NOT NULL)      AS tiene_token
       FROM cumplimiento_config WHERE company_id=$1 AND tipo=$2`,
    [companyId, tipo]);
  if (!r.rows.length) return { tipo, metodo: 'API', base_url: '', usuario: '', extra: null, activo: false, tiene_credencial: false, tiene_token: false };
  return { tipo, ...r.rows[0] };
}

export async function getConfigTodas(companyId: string) {
  const out: Record<string, any> = {};
  for (const t of TIPOS) out[t] = await getConfig(companyId, t);
  return { configs: out, bovedaLista: bovedaLista() };
}

/**
 * Guarda la config. Los SECRETOS (credencial/token) se CIFRAN con la bóveda; si el
 * campo llega vacío ('') se BORRA, si llega undefined/omitido se CONSERVA lo que había
 * (para no perder la contraseña al editar sólo la URL).
 */
export async function setConfig(companyId: string, tipo: string, d: any) {
  if (!TIPOS.includes(tipo as any)) throw new ValidationError('Tipo inválido.');
  const metodo = String(d?.metodo || 'API').toUpperCase();
  if (!METODOS.includes(metodo as any)) throw new ValidationError('Método inválido (PORTAL, API o EFIRMA).');
  if ((d?.credencial || d?.token) && !bovedaLista()) {
    throw new ValidationError('Falta la variable SAT_VAULT_KEY en el servidor para cifrar las credenciales.');
  }
  const actual = await query<any>(`SELECT credencial, token FROM cumplimiento_config WHERE company_id=$1 AND tipo=$2`, [companyId, tipo]);
  const prev = actual.rows[0] || {};
  // undefined = conservar; '' = borrar; valor = cifrar.
  const secreto = (nuevo: any, anterior: any) =>
    nuevo === undefined ? (anterior ?? null) : (String(nuevo) === '' ? null : cifrar(String(nuevo)));
  const credencial = secreto(d?.credencial, prev.credencial);
  const token = secreto(d?.token, prev.token);

  await query(
    `INSERT INTO cumplimiento_config (company_id, tipo, metodo, base_url, usuario, credencial, token, extra, activo, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,NOW())
     ON CONFLICT (company_id, tipo) DO UPDATE SET
       metodo=EXCLUDED.metodo, base_url=EXCLUDED.base_url, usuario=EXCLUDED.usuario,
       credencial=EXCLUDED.credencial, token=EXCLUDED.token, extra=EXCLUDED.extra,
       activo=EXCLUDED.activo, updated_at=NOW()`,
    [companyId, tipo, metodo, d?.base_url || null, d?.usuario || null, credencial, token,
     d?.extra ? JSON.stringify(d.extra) : null, d?.activo === true || d?.activo === 'true']);
  return getConfig(companyId, tipo);
}

/**
 * DESCARGA AUTOMÁTICA — gated. El motor que navega el portal / llama al proveedor y
 * guarda el PDF firmado NO está activado: requiere (1) elegir proveedor/método por
 * dependencia y su inspección real del portal (SAT con e.firma, IMSS Escritorio
 * Virtual, INFONAVIT), y (2) respetar CAPTCHA/MFA (nunca evadirlos: pausa a modo
 * asistido). Por ahora valida que exista configuración y explica el siguiente paso.
 */
export async function descargarAutomatico(_companyId: string, tipo: string): Promise<never> {
  if (!TIPOS.includes(tipo as any)) throw new ValidationError('Tipo inválido.');
  throw new ValidationError(
    `La descarga automática de ${tipo} está pendiente de activar el motor. Ya puedes capturar su ` +
    `configuración (endpoint, usuario y contraseña/token, que se guardan cifrados). Para conectarla ` +
    `hace falta definir el proveedor/método (SAT: e.firma o API tipo SatGo; IMSS/INFONAVIT: su portal) ` +
    `e inspeccionar el flujo real, sin evadir CAPTCHA/MFA. Mientras, registra la opinión a mano.`);
}
