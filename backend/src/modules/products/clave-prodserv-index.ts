/**
 * Índice en memoria del catálogo c_ClaveProdServ del SAT.
 *
 * Se carga UNA VEZ al arrancar (lazy) desde src/data/c_ClaveProdServ.json.gz.
 *   • 52,513 claves del SAT (~2.4 MB descomprimido / 522 KB gzip)
 *   • Búsqueda lineal con early break — tiempos típicos < 30 ms.
 *
 * Estructura del archivo: JSON array de [clave, descripción].
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

interface Entry {
  catalog_key: string;
  description: string;
  // versión normalizada en MAYÚSCULAS sin acentos para matching rápido
  _norm: string;
}

let cache: Entry[] | null = null;
let loadError: Error | null = null;

// Buscar el archivo en dist/data (prod compilado) y en src/data (dev con ts-node).
// __dirname es dist/modules/products (prod) o src/modules/products (dev).
const CANDIDATE_PATHS = [
  path.join(__dirname, '..', '..', 'data', 'c_ClaveProdServ.json.gz'),               // dist/data o src/data
  path.join(__dirname, '..', '..', '..', 'src', 'data', 'c_ClaveProdServ.json.gz'),  // fallback src/data si estamos en dist/
];
const DATA_FILE = CANDIDATE_PATHS.find((p) => fs.existsSync(p)) || CANDIDATE_PATHS[0];

function norm(s: string): string {
  return (s || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function load(): Entry[] {
  if (cache) return cache;
  if (loadError) throw loadError;

  try {
    if (!fs.existsSync(DATA_FILE)) {
      throw new Error(
        `No existe ${DATA_FILE}. Ejecuta: npx ts-node scripts/build-clave-prodserv-gz.ts`
      );
    }
    const gz = fs.readFileSync(DATA_FILE);
    const json = zlib.gunzipSync(gz).toString('utf8');
    const raw = JSON.parse(json) as Array<[string, string]>;
    cache = raw.map(([k, d]) => ({
      catalog_key: k,
      description: d,
      _norm: norm(k + ' ' + d),
    }));
    return cache;
  } catch (e: any) {
    loadError = e;
    throw e;
  }
}

/**
 * Búsqueda con prioridad:
 *   1) clave_sat empieza con q  (sub-ms)
 *   2) clave_sat contiene q
 *   3) descripción contiene cada palabra de q (AND lógico)
 */
export function searchClaveProdServ(q: string, limit = 30): Entry[] {
  const entries = load();
  if (!q || q.length < 2) return [];

  const qNorm = norm(q);
  const words = qNorm.split(/\s+/).filter((w) => w.length > 0);

  const startsWith: Entry[] = [];
  const includesKey: Entry[] = [];
  const matchesDesc: Entry[] = [];

  for (const e of entries) {
    if (e.catalog_key.startsWith(qNorm)) {
      startsWith.push(e);
      if (startsWith.length + includesKey.length + matchesDesc.length >= limit * 3) break;
      continue;
    }
    if (e.catalog_key.includes(qNorm)) {
      includesKey.push(e);
      continue;
    }
    // todas las palabras presentes en la descripción
    let ok = words.length > 0;
    for (const w of words) {
      if (!e._norm.includes(w)) { ok = false; break; }
    }
    if (ok) matchesDesc.push(e);
  }

  return [...startsWith, ...includesKey, ...matchesDesc]
    .slice(0, limit)
    .map(({ catalog_key, description }) => ({
      catalog_key,
      description,
      _norm: '',
    }));
}

/** Devuelve total de claves cargadas (útil para diagnóstico/health). */
export function getClaveProdServCount(): number {
  try {
    return load().length;
  } catch {
    return 0;
  }
}

/**
 * Pre-carga al arrancar el server. Si el archivo no existe, deja una traza
 * en stderr pero NO tumba el server (el endpoint caerá en BD como fallback).
 */
export function warmup(): void {
  try {
    const n = load().length;
    // eslint-disable-next-line no-console
    console.log(`[c_ClaveProdServ] ${n.toLocaleString()} claves cargadas en memoria`);
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn(`[c_ClaveProdServ] no se pudo cargar: ${e.message}`);
  }
}
