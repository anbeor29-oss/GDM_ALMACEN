/**
 * satgo.consultas.service — consultas SatGo por EMPRESA (no super admin):
 *   · Información Fiscal (JSON)     → requiere clave CIEC de la empresa.
 *   · Declaraciones (ZIP)           → requiere clave CIEC + ejercicio/mes.
 *   · Validación de CFDI            → sólo el RFC de la empresa (sin CIEC).
 *
 * El RFC se toma de `companies`; la CIEC se lee cifrada de `cumplimiento_config`
 * (tipo SAT y, en su defecto, CSF) y se descifra SÓLO en memoria vía el contexto
 * efímero — se suelta (dispose) al terminar. Nunca se registra ni se serializa.
 */
import { query } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import { EphemeralCredentialContext } from '../compliance/credential-context';
import { extraerBinarios, ZipSospechoso } from '../sat-descarga/zip-seguro';
import * as satgo from './satgo.service';

async function rfcDe(companyId: string): Promise<string> {
  const r = await query<any>(`SELECT rfc FROM companies WHERE id=$1`, [companyId]);
  const rfc = String(r.rows[0]?.rfc || '').toUpperCase().trim();
  if (!rfc) throw new ValidationError('La empresa no tiene RFC capturado.');
  return rfc;
}

/** Carga la CIEC de la empresa (SAT y, si no, CSF). Devuelve la clave + dispose(). */
async function ciecDe(companyId: string): Promise<{ ciec: string; dispose: () => void }> {
  for (const tipo of ['SAT', 'CSF'] as const) {
    const ctx = await EphemeralCredentialContext.cargar(companyId, tipo);
    if (ctx?.credencial) return { ciec: ctx.credencial, dispose: () => ctx.dispose() };
    ctx?.dispose();
  }
  throw new ValidationError('Falta la clave CIEC de la empresa. Captúrala en Servicios SAT → Configurar (pestaña Opinión 32-D o CIF/CSF).');
}

/** Información fiscal (JSON) de la empresa. */
export async function infoFiscal(companyId: string) {
  const rfc = await rfcDe(companyId);
  const { ciec, dispose } = await ciecDe(companyId);
  try { return await satgo.infoFiscalCiec(rfc, ciec); }
  finally { dispose(); }
}

/** Declaraciones (ZIP) de un ejercicio/mes. mes=0 = todo el ejercicio. */
export async function declaraciones(companyId: string, ejercicio: number, mes = 0): Promise<{ buffer: Buffer; nombre: string }> {
  if (!Number.isInteger(ejercicio) || ejercicio < 2000 || ejercicio > 2100) throw new ValidationError('Ejercicio inválido.');
  const m = Number.isInteger(mes) ? Math.max(0, Math.min(12, mes)) : 0;
  const rfc = await rfcDe(companyId);
  const { ciec, dispose } = await ciecDe(companyId);
  try {
    const buffer = await satgo.declaracionesCiec(rfc, ciec, ejercicio, m);
    const nombre = `Declaraciones_${rfc}_${ejercicio}${m ? '-' + String(m).padStart(2, '0') : ''}.zip`;
    return { buffer, nombre };
  } finally { dispose(); }
}

/**
 * Declaraciones DESCOMPRIMIDAS de un ejercicio/mes: baja el ZIP de SatGo, lo abre en
 * memoria (extractor seguro, anti-bomba) y devuelve cada documento como data-URL
 * base64 (PDF o acuse). Si SatGo devolvió un PDF suelto (no ZIP), lo regresa igual.
 * Pensado para una cuadrícula año×mes que aloja el PDF; una consulta por celda
 * (cuida la cuota de SatGo).
 */
export async function declaracionesContenido(companyId: string, ejercicio: number, mes = 0) {
  if (!Number.isInteger(ejercicio) || ejercicio < 2000 || ejercicio > 2100) throw new ValidationError('Ejercicio inválido.');
  const m = Number.isInteger(mes) ? Math.max(0, Math.min(12, mes)) : 0;
  const rfc = await rfcDe(companyId);
  const { ciec, dispose } = await ciecDe(companyId);
  let buf: Buffer;
  try { buf = await satgo.declaracionesCiec(rfc, ciec, ejercicio, m); }
  finally { dispose(); }

  let archivos: Array<{ nombre: string; contenido: Buffer }> = [];
  try {
    archivos = extraerBinarios(buf, ['pdf', 'txt']);
  } catch (e) {
    // ¿SatGo devolvió un PDF suelto en vez de un ZIP?
    if (e instanceof ZipSospechoso && buf.slice(0, 5).toString('latin1') === '%PDF-') {
      archivos = [{ nombre: `Declaracion_${rfc}_${ejercicio}${m ? '-' + String(m).padStart(2, '0') : ''}.pdf`, contenido: buf }];
    } else if (e instanceof ZipSospechoso) {
      throw new ValidationError('SatGo no devolvió declaraciones para ese periodo (o no es un ZIP/PDF válido).');
    } else { throw e; }
  }

  // Tope de respuesta (evita payloads gigantes); PDFs primero.
  const MAX_TOTAL = 12 * 1024 * 1024;
  let total = 0;
  const out: Array<{ nombre: string; esPdf: boolean; base64: string }> = [];
  for (const a of archivos.sort((x, y) => Number(/\.pdf$/i.test(y.nombre)) - Number(/\.pdf$/i.test(x.nombre)))) {
    total += a.contenido.length;
    if (total > MAX_TOTAL) break;
    const esPdf = /\.pdf$/i.test(a.nombre);
    out.push({ nombre: a.nombre, esPdf, base64: `data:${esPdf ? 'application/pdf' : 'text/plain'};base64,${a.contenido.toString('base64')}` });
  }
  return { ejercicio, mes: m, total: archivos.length, archivos: out };
}

/** Valida un CFDI ante el SAT (sin CIEC; sólo el RFC de la empresa como consultante). */
export async function validarCfdi(companyId: string, d: { re?: string; rr?: string; tt?: string | number; id?: string; fe?: string }) {
  const re = String(d?.re || '').toUpperCase().trim();
  const rr = String(d?.rr || '').toUpperCase().trim();
  const id = String(d?.id || '').trim();
  if (!re || !rr || !id || d?.tt == null || d?.tt === '') {
    throw new ValidationError('Faltan datos del CFDI: RFC emisor, RFC receptor, total y UUID (folio fiscal).');
  }
  const rfc = await rfcDe(companyId);
  return satgo.consultaCfdi(rfc, { re, rr, tt: d.tt, id, fe: d.fe });
}
