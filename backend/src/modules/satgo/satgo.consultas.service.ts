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

/** Mes (1-12) por nombre en español; 0 = no identificado / anual. */
const MES_NUM: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

/**
 * Clasifica un PDF de declaración por su NOMBRE: los paquetes del SAT vienen como
 * `Normal_2026_Abril.pdf`, `Complementaria_2026_Abril.pdf`. Devuelve el tipo
 * (Normal/Complementaria/…) y el mes (1-12, o 0 si es anual / no identificable),
 * para encasillarlo en la cuadrícula año×mes.
 */
function clasificarDeclaracion(nombre: string): { tipo: string; mes: number } {
  const base = nombre.replace(/\.[^.]+$/, '');
  const lower = base.toLowerCase();
  let mes = 0;
  for (const [n, v] of Object.entries(MES_NUM)) if (lower.includes(n)) { mes = v; break; }
  const primer = base.split(/[_\-\s]/)[0] || '';
  const tipo = primer ? primer.charAt(0).toUpperCase() + primer.slice(1).toLowerCase() : 'Declaración';
  return { tipo, mes };
}

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

/* ── Respaldo del ZIP del año (cuota: se baja una vez y se relee de la BD) ──
 * El paquete de declaraciones se guarda COMPRIMIDO por (empresa, ejercicio). La
 * cuadrícula se arma leyendo de aquí, sin volver a llamar a SatGo; sólo se vuelve
 * a bajar —y se SUSTITUYE— cuando se fuerza (clic en un año concreto). */

async function zipGuardado(companyId: string, ejercicio: number): Promise<{ buf: Buffer; descargadoAt: string } | null> {
  const r = await query<any>(
    `SELECT zip, TO_CHAR(descargado_at,'YYYY-MM-DD HH24:MI') AS descargado_at
       FROM satgo_declaraciones_zip WHERE company_id = $1 AND ejercicio = $2`,
    [companyId, ejercicio]);
  if (!r.rows[0]?.zip) return null;
  return { buf: Buffer.from(r.rows[0].zip), descargadoAt: r.rows[0].descargado_at };
}

async function guardarZip(companyId: string, ejercicio: number, rfc: string, buf: Buffer): Promise<void> {
  await query(
    `INSERT INTO satgo_declaraciones_zip (company_id, ejercicio, rfc, zip, bytes, descargado_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (company_id, ejercicio)
       DO UPDATE SET zip = EXCLUDED.zip, bytes = EXCLUDED.bytes, rfc = EXCLUDED.rfc, descargado_at = NOW()`,
    [companyId, ejercicio, rfc, buf, buf.length]);
}

/** Abre el ZIP del año (o PDF suelto) y clasifica cada documento por mes. */
function abrirYClasificar(buf: Buffer, rfc: string, ejercicio: number):
  Array<{ nombre: string; esPdf: boolean; tipo: string; mes: number; contenido: Buffer }> {
  let archivos: Array<{ nombre: string; contenido: Buffer }> = [];
  try {
    archivos = extraerBinarios(buf, ['pdf', 'txt']);
  } catch (e) {
    // ¿SatGo devolvió un PDF suelto en vez de un ZIP?
    if (e instanceof ZipSospechoso && buf.slice(0, 5).toString('latin1') === '%PDF-') {
      archivos = [{ nombre: `Declaracion_${rfc}_${ejercicio}.pdf`, contenido: buf }];
    } else if (e instanceof ZipSospechoso) {
      throw new ValidationError('SatGo no devolvió declaraciones para ese periodo (o no es un ZIP/PDF válido).');
    } else { throw e; }
  }
  return archivos.map((a) => {
    const esPdf = /\.pdf$/i.test(a.nombre);
    const { tipo, mes } = clasificarDeclaracion(a.nombre);
    return { nombre: a.nombre, esPdf, tipo, mes, contenido: a.contenido };
  });
}

/**
 * Trae el ZIP del año: del respaldo si ya existe (SIN consumir cuota), o de SatGo
 * si se fuerza (clic en el año) o si aún no hay nada guardado — y en ese caso lo
 * GUARDA/sustituye. Siempre se baja el AÑO COMPLETO (mes=0) para cubrir toda la
 * cuadrícula con una sola consulta.
 */
async function zipDelAnio(companyId: string, rfc: string, ejercicio: number, forzar: boolean):
  Promise<{ buf: Buffer; desdeCache: boolean; descargadoAt?: string }> {
  if (!forzar) {
    const g = await zipGuardado(companyId, ejercicio);
    if (g) return { buf: g.buf, desdeCache: true, descargadoAt: g.descargadoAt };
  }
  const { ciec, dispose } = await ciecDe(companyId);
  let buf: Buffer;
  try { buf = await satgo.declaracionesCiec(rfc, ciec, ejercicio, 0); }
  finally { dispose(); }
  await guardarZip(companyId, ejercicio, rfc, buf).catch(() => { /* la vista no debe depender del guardado */ });
  return { buf, desdeCache: false };
}

/**
 * Declaraciones DESCOMPRIMIDAS de un ejercicio: abre el ZIP del año (del respaldo o
 * recién bajado) y devuelve cada documento como data-URL base64 (PDF o acuse),
 * clasificado por mes. `forzar=true` vuelve a bajarlo de SatGo y sustituye el
 * respaldo (clic en el año); si no, se sirve de lo guardado y NO gasta cuota.
 */
export async function declaracionesContenido(companyId: string, ejercicio: number, mes = 0, forzar = false) {
  if (!Number.isInteger(ejercicio) || ejercicio < 2000 || ejercicio > 2100) throw new ValidationError('Ejercicio inválido.');
  const m = Number.isInteger(mes) ? Math.max(0, Math.min(12, mes)) : 0;
  const rfc = await rfcDe(companyId);
  const { buf, desdeCache, descargadoAt } = await zipDelAnio(companyId, rfc, ejercicio, !!forzar);

  const todos = abrirYClasificar(buf, rfc, ejercicio);
  const sel = m ? todos.filter((a) => (a.mes || 0) === m) : todos;

  // Tope de respuesta (evita payloads gigantes); PDFs primero.
  const MAX_TOTAL = 12 * 1024 * 1024;
  let total = 0;
  const out: Array<{ nombre: string; esPdf: boolean; tipo: string; mes: number; base64: string }> = [];
  for (const a of [...sel].sort((x, y) => Number(y.esPdf) - Number(x.esPdf))) {
    total += a.contenido.length;
    if (total > MAX_TOTAL) break;
    out.push({
      nombre: a.nombre, esPdf: a.esPdf, tipo: a.tipo, mes: a.mes || m,
      base64: `data:${a.esPdf ? 'application/pdf' : 'text/plain'};base64,${a.contenido.toString('base64')}`,
    });
  }
  return { ejercicio, mes: m, total: sel.length, desdeCache, descargadoAt, archivos: out };
}

/**
 * Resumen de los años YA GUARDADOS (sin tocar SatGo): por cada ejercicio, cuántos
 * documentos hay en cada mes. Pinta la cuadrícula al entrar con lo ya bajado, sin
 * gastar cuota.
 */
export async function declaracionesResumen(companyId: string) {
  const rfc = await rfcDe(companyId).catch(() => '');
  const r = await query<any>(
    `SELECT ejercicio, bytes, TO_CHAR(descargado_at,'YYYY-MM-DD HH24:MI') AS descargado_at, zip
       FROM satgo_declaraciones_zip WHERE company_id = $1 ORDER BY ejercicio DESC`,
    [companyId]);
  const anios = r.rows.map((row: any) => {
    const porMes: Record<number, number> = {};
    try {
      for (const a of abrirYClasificar(Buffer.from(row.zip), rfc, Number(row.ejercicio))) {
        const k = a.mes || 0;
        porMes[k] = (porMes[k] || 0) + 1;
      }
    } catch { /* un ZIP corrupto no debe tumbar el resumen */ }
    return { ejercicio: Number(row.ejercicio), bytes: Number(row.bytes), descargadoAt: row.descargado_at, porMes };
  });
  return { anios };
}

/**
 * Buzón tributario: comunicados y avisos (mensajes) del SAT. El canal del buzón
 * por SatGo todavía NO está integrado (Fase B), así que por ahora regresa vacío con
 * `conectado:false`. Es el ÚNICO punto donde se enchufará la descarga real; el
 * frontend ya trae el botón «Actualizar» y la vista, listos para cuando se conecte.
 */
export async function buzonNotificaciones(_companyId: string) {
  return { conectado: false, comunicados: [] as any[], avisos: [] as any[] };
}

/**
 * VERIFICA por SatGo el estatus de los CFDI almacenados y marca los CANCELADOS en la
 * bóveda (cfdi_recibidos.estado_sat='Cancelado'). Capta cancelaciones POSTERIORES a la
 * descarga (el Metadata del SAT sólo marca el estatus al momento de bajarlo). Revisa
 * los que hoy NO están cancelados, del más reciente al más viejo. Consume cuota de
 * SatGo (1 por CFDI): va con límite.
 */
export async function verificarCancelados(companyId: string, limite = 50) {
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 300);
  const rfc = await rfcDe(companyId);   // la empresa es la consultante
  const r = await query<any>(
    `SELECT id, uuid, rfc_emisor, rfc_receptor, total
       FROM cfdi_recibidos
      WHERE company_id = $1 AND uuid IS NOT NULL
        AND COALESCE(estado_sat, 'Vigente') <> 'Cancelado'
      ORDER BY fecha_emision DESC NULLS LAST
      LIMIT $2`, [companyId, lim]);

  let revisados = 0, cancelados = 0, errores = 0;
  for (const c of r.rows) {
    revisados++;
    try {
      const data: any = await satgo.consultaCfdi(rfc, { re: c.rfc_emisor, rr: c.rfc_receptor, tt: c.total, id: c.uuid });
      const texto = JSON.stringify(data || {}).toLowerCase();
      const estado = String(data?.estado || data?.Estado || data?.estatus || data?.estadoComprobante || data?.estatusCancelacion || '').toLowerCase();
      const estaCancelado = /cancel/.test(estado) || (/cancel/.test(texto) && !/vigente/.test(estado));
      if (estaCancelado) {
        await query(`UPDATE cfdi_recibidos SET estado_sat = 'Cancelado' WHERE id = $1`, [c.id]);
        cancelados++;
      }
    } catch { errores++; }
  }
  return { revisados, cancelados, errores, restantes: Math.max(0, r.rows.length === lim ? lim : 0) };
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
