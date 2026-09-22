/**
 * Extrae los CFDI de un .zip de respaldo CPQ EN EL NAVEGADOR.
 *
 * Por qué en el navegador: un respaldo trae el .bak del ADD (decenas de MB) con
 * miles de CFDI en texto UTF-8. Subir el .zip entero y procesarlo en el servidor
 * arriesga memoria y tiempos largos; aquí se descomprime con fflate, se recortan
 * los <Comprobante>…</Comprobante> y sólo se suben los XML (en lotes chicos).
 *
 * Mismo criterio que el motor del backend: XML sueltos + embebidos en binarios,
 * dedup por UUID, y sólo CFDI con timbre.
 */
import { unzipSync } from 'fflate';

const utf8 = new TextDecoder('utf-8');
const latin1 = new TextDecoder('iso-8859-1');   // 1 byte = 1 char: offsets exactos

const attr = (xml: string, n: string): string | null => {
  const m = new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`).exec(xml);
  return m ? m[1] : null;
};

/** Recorta cada CFDI embebido en un binario/texto (con su declaración <?xml si está pegada). */
function cfdisEnBytes(u8: Uint8Array): string[] {
  const s = latin1.decode(u8);
  const out: string[] = [];
  const abre = /<(?:[A-Za-z0-9_]+:)?Comprobante[\s>]/g;
  let m: RegExpExecArray | null;
  while ((m = abre.exec(s)) !== null) {
    const cierra = /<\/(?:[A-Za-z0-9_]+:)?Comprobante>/g;
    cierra.lastIndex = abre.lastIndex;
    const c = cierra.exec(s);
    if (!c) break;
    const fin = c.index + c[0].length;
    let ini = m.index;
    const pre = s.lastIndexOf('<?xml', m.index);
    if (pre >= 0 && m.index - pre < 120) ini = pre;
    out.push(utf8.decode(u8.subarray(ini, fin)));
    abre.lastIndex = fin;
    if (out.length > 300_000) break;
  }
  return out;
}

export interface ExtraccionCpq {
  xmls: string[];        // CFDI con timbre, deduplicados por UUID
  archivos: number;      // archivos dentro del .zip
  sinTimbre: number;     // comprobantes sin UUID (no se suben)
}

/** Descomprime el .zip y devuelve los CFDI (con timbre, únicos) listos para subir. */
export function extraerCfdisDeZip(buf: ArrayBuffer): ExtraccionCpq {
  const files = unzipSync(new Uint8Array(buf));
  const xmls: string[] = [];
  const vistos = new Set<string>();
  let archivos = 0, sinTimbre = 0;

  for (const nombre of Object.keys(files)) {
    if (nombre.endsWith('/')) continue;
    archivos++;
    const u8 = files[nombre];
    const candidatos = /\.xml$/i.test(nombre) ? [utf8.decode(u8)] : cfdisEnBytes(u8);
    for (const xml of candidatos) {
      if (!/<(?:\w+:)?Comprobante\b/.test(xml)) continue;
      const timbre = /<(?:\w+:)?TimbreFiscalDigital\b[^>]*>/.exec(xml)?.[0] || '';
      const uuid = (attr(timbre, 'UUID') || '').toUpperCase();
      if (!uuid) { sinTimbre++; continue; }
      if (vistos.has(uuid)) continue;
      vistos.add(uuid);
      xmls.push(xml);
    }
  }
  return { xmls, archivos, sinTimbre };
}
