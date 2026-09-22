/**
 * recuperacion-cpq.service — recupera XML/CFDI de un respaldo .zip de CPQ y los
 * INGRESA a la bóveda existente (`cfdi_recibidos`) con `indexarCfdi`, así aparecen
 * solos en el CALENDARIO y en todo lo que lee esa tabla. No se toca el respaldo;
 * la ingesta es idempotente por UUID (no duplica).
 *
 * DE DÓNDE SALEN LOS XML
 *   · XML SUELTOS dentro del .zip (la carpeta de la ADD suele guardarlos así).
 *   · XML EMBEBIDOS en binarios (.bak, .dat…): se escanea el contenido en busca
 *     de <Comprobante> y se recorta el CFDI. Es BEST-EFFORT (texto UTF-8/latin1);
 *     si el .bak guarda los XML de otra forma (UTF-16, comprimidos), se calibra
 *     con el respaldo real y/o se usa la herramienta local. Nunca inventa datos.
 *
 * NO destructivo, repetible y auditable: cada corrida se registra con el nombre y
 * el SHA-256 del .zip y los conteos (tabla `cpq_recuperacion_corridas`).
 */
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { query } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import { indexarCfdi } from '../sat-descarga/descarga.service';

/* ── Lectura SEGURA del ZIP (sin librería, con topes anti–bomba) ───────────── */

const MAX_ENTRADA = 200 * 1024 * 1024;      // por archivo descomprimido
const MAX_TOTAL = 1024 * 1024 * 1024;       // por paquete descomprimido
const MAX_ENTRADAS = 100_000;
const MAX_ESCANEO = 120 * 1024 * 1024;      // no se escanea texto de binarios mayores a esto

interface EntradaZip { nombre: string; buffer: Buffer; }

function nombreSeguro(n: string): boolean {
  return !!n && n.length <= 400 && !n.includes('..') && !n.startsWith('/') && !n.startsWith('\\') && !/^[a-zA-Z]:/.test(n) && !n.includes('\0');
}

/** Recorre el índice central del ZIP y devuelve TODAS las entradas como buffers. */
export function entradasDelZip(zip: Buffer): EntradaZip[] {
  if (zip.length < 22) throw new ValidationError('El archivo está vacío o no es un ZIP.');
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0 && i > zip.length - 65_557; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ValidationError('No es un archivo ZIP válido (falta el índice).');

  const entradas = zip.readUInt16LE(eocd + 10);
  const inicio = zip.readUInt32LE(eocd + 16);
  if (entradas > MAX_ENTRADAS) throw new ValidationError(`El ZIP declara ${entradas} archivos; el tope es ${MAX_ENTRADAS}.`);

  const out: EntradaZip[] = [];
  let p = inicio, acumulado = 0;
  for (let n = 0; n < entradas; n++) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = zip.readUInt16LE(p + 10);
    const comprimido = zip.readUInt32LE(p + 20);
    const original = zip.readUInt32LE(p + 24);
    const largoNombre = zip.readUInt16LE(p + 28);
    const largoExtra = zip.readUInt16LE(p + 30);
    const largoComentario = zip.readUInt16LE(p + 32);
    const offsetLocal = zip.readUInt32LE(p + 42);
    const nombre = zip.slice(p + 46, p + 46 + largoNombre).toString('utf8');
    p += 46 + largoNombre + largoExtra + largoComentario;

    if (nombre.endsWith('/')) continue;
    if (!nombreSeguro(nombre)) continue;                 // no se cae por un nombre raro: se ignora
    if (original > MAX_ENTRADA) continue;                // archivo gigantesco: se omite (usar herramienta local)
    acumulado += original;
    if (acumulado > MAX_TOTAL) throw new ValidationError('El respaldo descomprimido pasa de 1 GB. Súbelo por partes o usa la herramienta local.');

    if (offsetLocal + 30 > zip.length || zip.readUInt32LE(offsetLocal) !== 0x04034b50) continue;
    const iniDatos = offsetLocal + 30 + zip.readUInt16LE(offsetLocal + 26) + zip.readUInt16LE(offsetLocal + 28);
    const datos = zip.subarray(iniDatos, iniDatos + comprimido);
    try {
      const buffer = metodo === 0 ? datos
        : metodo === 8 ? zlib.inflateRawSync(datos, { maxOutputLength: MAX_ENTRADA })
        : null;
      if (buffer) out.push({ nombre, buffer });
    } catch { /* entrada corrupta: se ignora, no se pierde el resto */ }
  }
  return out;
}

/* ── Clasificación de XML ──────────────────────────────────────────────────── */

const attr = (xml: string, nombre: string): string | null => {
  const m = new RegExp(`\\b${nombre}\\s*=\\s*"([^"]*)"`).exec(xml);
  return m ? m[1] : null;
};

const esCfdi = (xml: string) => /<(?:\w+:)?Comprobante\b/.test(xml) && /<(?:\w+:)?TimbreFiscalDigital\b/.test(xml);
const esNomina = (xml: string) => /<nomina12:Nomina\b/.test(xml) || xml.includes('www.sat.gob.mx/nomina12');
const esContabElectronica = (xml: string) =>
  /<(?:\w+:)?(Balanza|Catalogo|Polizas)\b/.test(xml) || xml.includes('www.sat.gob.mx/esquemas/ContabilidadE');

/** RFC del emisor/receptor de un CFDI (para clasificar emitido/recibido). */
function rfcDe(xml: string, cual: 'Emisor' | 'Receptor'): string | null {
  const tag = new RegExp(`<(?:\\w+:)?${cual}\\b[^>]*>`).exec(xml)?.[0] || '';
  return (attr(tag, 'Rfc') || attr(tag, 'rfc') || '').toUpperCase() || null;
}

/** Recorta cada CFDI (<Comprobante>…</Comprobante>) embebido en un binario/texto. */
function cfdisEnBinario(buf: Buffer): string[] {
  if (buf.length > MAX_ESCANEO) return [];
  const s = buf.toString('latin1');                      // 1 byte = 1 char → offsets exactos
  const out: string[] = [];
  const abre = /<(?:[A-Za-z0-9_]+:)?Comprobante[\s>]/g;
  let m: RegExpExecArray | null;
  while ((m = abre.exec(s)) !== null) {
    const cierra = /<\/(?:[A-Za-z0-9_]+:)?Comprobante>/g;
    cierra.lastIndex = abre.lastIndex;
    const c = cierra.exec(s);
    if (!c) break;
    const fin = c.index + c[0].length;
    out.push(buf.subarray(m.index, fin).toString('utf8')); // re-decodifica utf8: conserva acentos
    abre.lastIndex = fin;
    if (out.length > 200_000) break;                       // guarda de seguridad
  }
  return out;
}

/* ── Motor de recuperación ─────────────────────────────────────────────────── */

export interface ReporteRecuperacion {
  archivo: string;
  sha256: string;
  bytes: number;
  archivosEnZip: number;
  xmlEncontrados: number;
  cfdiValidos: number;
  nuevos: number;
  duplicados: number;
  emitidos: number;
  recibidos: number;
  nomina: number;
  contabElectronica: number;
  noCfdi: number;
  porTipo: Record<string, number>;
  errores: number;
}

/**
 * Recupera los CFDI de un .zip de respaldo CPQ y los ingresa a la bóveda de la
 * empresa. `rfcPropietario` (de la empresa, NO escrito a mano) decide emitido vs
 * recibido. Devuelve el reporte de recuperación.
 */
export async function recuperarXmlsDeZip(
  companyId: string, archivoNombre: string, zip: Buffer, userId?: string,
): Promise<ReporteRecuperacion> {
  const cr = await query<any>(`SELECT rfc FROM companies WHERE id = $1`, [companyId]);
  const rfcPropietario = cr.rows[0]?.rfc;
  if (!rfcPropietario) throw new ValidationError('La empresa no tiene RFC configurado; no se puede clasificar emitido/recibido.');
  const rfc = String(rfcPropietario).toUpperCase();
  const sha256 = crypto.createHash('sha256').update(zip).digest('hex');

  const entradas = entradasDelZip(zip);
  const rep: ReporteRecuperacion = {
    archivo: archivoNombre, sha256, bytes: zip.length, archivosEnZip: entradas.length,
    xmlEncontrados: 0, cfdiValidos: 0, nuevos: 0, duplicados: 0, emitidos: 0, recibidos: 0,
    nomina: 0, contabElectronica: 0, noCfdi: 0, porTipo: {}, errores: 0,
  };

  const vistos = new Set<string>();                        // UUIDs de esta corrida (dedup local)

  for (const e of entradas) {
    const esXml = /\.xml$/i.test(e.nombre);
    const candidatos: string[] = esXml ? [e.buffer.toString('utf8')] : cfdisEnBinario(e.buffer);

    for (const xml of candidatos) {
      if (!/<(?:\w+:)?Comprobante\b/.test(xml)) {
        // XML que no es un comprobante: ¿contabilidad electrónica?
        if (esXml && esContabElectronica(xml)) { rep.xmlEncontrados++; rep.contabElectronica++; }
        continue;
      }
      rep.xmlEncontrados++;
      if (esContabElectronica(xml)) { rep.contabElectronica++; continue; }
      if (!esCfdi(xml)) { rep.noCfdi++; continue; }        // Comprobante sin timbre: no se indexa

      const uuid = (attr(/<(?:\w+:)?TimbreFiscalDigital\b[^>]*>/.exec(xml)?.[0] || '', 'UUID') || '').toUpperCase();
      if (!uuid) { rep.noCfdi++; continue; }
      rep.cfdiValidos++;
      const tipo = attr(/<(?:\w+:)?Comprobante\b[^>]*>/.exec(xml)?.[0] || '', 'TipoDeComprobante') || '?';
      rep.porTipo[tipo] = (rep.porTipo[tipo] || 0) + 1;
      if (esNomina(xml)) rep.nomina++;

      const emisor = rfcDe(xml, 'Emisor');
      const direccion = emisor === rfc ? 'emitidos' : 'recibidos';
      if (direccion === 'emitidos') rep.emitidos++; else rep.recibidos++;

      if (vistos.has(uuid)) { rep.duplicados++; continue; }
      vistos.add(uuid);
      try {
        const nuevo = await indexarCfdi(companyId, rfc, direccion, xml);
        if (nuevo) rep.nuevos++; else rep.duplicados++;
      } catch (err: any) {
        rep.errores++;
        logger.warn(`[recuperacion-cpq] no se pudo indexar ${uuid}: ${err?.message || err}`);
      }
    }
  }

  await query(
    `INSERT INTO cpq_recuperacion_corridas
       (company_id, archivo, sha256, bytes, xml_encontrados, cfdi_validos, nuevos, duplicados,
        emitidos, recibidos, nomina, contab_electronica, no_cfdi, resumen, usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [companyId, archivoNombre, sha256, zip.length, rep.xmlEncontrados, rep.cfdiValidos, rep.nuevos,
     rep.duplicados, rep.emitidos, rep.recibidos, rep.nomina, rep.contabElectronica, rep.noCfdi,
     JSON.stringify({ porTipo: rep.porTipo, errores: rep.errores, archivosEnZip: rep.archivosEnZip }), userId || null],
  );
  logger.info(`[recuperacion-cpq] ${archivoNombre}: ${rep.cfdiValidos} CFDI (${rep.nuevos} nuevos) de ${entradas.length} archivo(s)`);
  return rep;
}

/** Últimas corridas de recuperación de la empresa (para la pantalla). */
export async function listarCorridas(companyId: string, limite = 20) {
  const r = await query<any>(
    `SELECT id, archivo, sha256, bytes, xml_encontrados, cfdi_validos, nuevos, duplicados,
            emitidos, recibidos, nomina, contab_electronica, no_cfdi, resumen, created_at
       FROM cpq_recuperacion_corridas WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [companyId, Math.min(100, Math.max(1, limite))]);
  return r.rows;
}
