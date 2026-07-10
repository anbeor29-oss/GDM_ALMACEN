/**
 * Convierte la hoja c_ClaveProdServ del .xls del SAT a un JSON gzip
 * y lo guarda en src/data/c_ClaveProdServ.json.gz.
 *
 * El archivo resultante (~250 KB para ~52k claves) se carga en memoria al
 * arrancar el server y sirve búsquedas O(n) directas (n pequeño + early break).
 *
 * Uso:
 *   npx ts-node scripts/build-clave-prodserv-gz.ts [ruta-al-xls]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as XLSX from 'xlsx';

const DEFAULT_IN = process.env.TEMP + '\\catCFDI.xls';
const OUT_DIR = path.join(__dirname, '..', 'src', 'data');
const OUT_FILE = path.join(OUT_DIR, 'c_ClaveProdServ.json.gz');

function trim(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  return String(v).replace(/\s+/g, ' ').trim();
}

async function main() {
  const inPath = process.argv[2] || DEFAULT_IN;
  if (!fs.existsSync(inPath)) {
    console.error(`No existe: ${inPath}`);
    process.exit(1);
  }
  const sizeMB = Math.round(fs.statSync(inPath).size / 1024 / 1024);
  console.log(`Leyendo ${path.basename(inPath)} (${sizeMB} MB)…`);

  const t0 = Date.now();
  const wb = XLSX.readFile(inPath, {
    cellDates: false, cellNF: false, cellText: false, cellStyles: false,
    sheets: ['c_ClaveProdServ'],
  });
  console.log(`  hojas cargadas en ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const sheet = wb.Sheets['c_ClaveProdServ'];
  if (!sheet) {
    console.error('La hoja c_ClaveProdServ no existe.');
    process.exit(1);
  }

  console.log('Convirtiendo a JSON…');
  const t1 = Date.now();
  const aoa: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1, defval: null, blankrows: false,
  });
  // Estructura típica del SAT: filas 0-2 son meta, fila 3 = header, fila 4+ = datos
  // header: [c_ClaveProdServ, Descripción, ...]
  const out: Array<[string, string]> = [];
  let skipped = 0;
  for (let r = 4; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row) continue;
    const key = trim(row[0]);
    const desc = trim(row[1]);
    if (!key) { skipped++; continue; }
    if (!/^\d+$/.test(key)) { skipped++; continue; }
    out.push([key, desc]);
  }
  console.log(`  ${out.length} entradas (descartadas ${skipped}) en ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const json = JSON.stringify(out);
  const gz = zlib.gzipSync(json, { level: 9 });
  fs.writeFileSync(OUT_FILE, gz);

  console.log('\nResultado:');
  console.log(`  JSON sin comprimir: ${(json.length / 1024).toFixed(0)} KB`);
  console.log(`  JSON gzip:         ${(gz.length / 1024).toFixed(0)} KB`);
  console.log(`  Guardado en: ${OUT_FILE}`);
  console.log('\nMuestras:');
  for (const ex of [out[0], out[Math.floor(out.length / 2)], out[out.length - 1]]) {
    if (ex) console.log(`  [${ex[0]}] ${ex[1].slice(0, 80)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
