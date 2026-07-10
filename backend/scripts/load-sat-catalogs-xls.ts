/**
 * Carga catálogos SAT desde el .xls oficial (formato fila-3-header).
 *
 * Fuente: D:\Obsidian\ANBEOR\raw\cfdi-v4-catalogos-20260408.xls
 * NOTA: Este .xls NO contiene c_ClaveProdServ (el SAT la publica aparte
 *       porque tiene > 1M filas). Para esa hoja se usa otro script.
 *
 * Uso:
 *   npx ts-node -r dotenv/config scripts/load-sat-catalogs-xls.ts [ruta.xls]
 */

import * as path from 'path';
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { query, closePool } from '../src/config/database';
import logger from '../src/middleware/logger';

const DEFAULT_XLS = 'D:\\Obsidian\\ANBEOR\\raw\\cfdi-v4-catalogos-20260408.xls';

// Configuración por hoja: nombre, columna clave, columna descripción (índices 0-based).
// Las hojas del SAT tienen 3 filas de meta y la fila 3 es el header real.
const SHEETS: Array<{
  sheet: string;
  catalog: string;
  headerRow: number;       // fila (0-based) con los nombres de columna reales
  keyCol: number;          // índice de la columna que es el catalog_key
  descCol: number;         // índice de la columna que es la descripción
  extraDescCol?: number;   // opcional: concatenar otra columna para más contexto
}> = [
  // c_ClaveUnidad: [c_ClaveUnidad | Nombre | Descripción | Nota | ...]
  { sheet: 'c_ClaveUnidad',     catalog: 'c_ClaveUnidad',     headerRow: 3, keyCol: 0, descCol: 1, extraDescCol: 2 },
  // c_Impuesto: [c_Impuesto | Descripción | Retención | Traslado | ...]
  { sheet: 'c_Impuesto',        catalog: 'c_Impuesto',        headerRow: 3, keyCol: 0, descCol: 1 },
  // c_TasaOCuota: [Rango o Fijo | c_TasaOCuota | (vacío) | Impuesto | Factor | ...]
  { sheet: 'c_TasaOCuota',      catalog: 'c_TasaOCuota',      headerRow: 3, keyCol: 1, descCol: 3, extraDescCol: 0 },
  // c_FormaPago
  { sheet: 'c_FormaPago',       catalog: 'c_FormaPago',       headerRow: 3, keyCol: 0, descCol: 1 },
  // c_MetodoPago
  { sheet: 'c_MetodoPago',      catalog: 'c_MetodoPago',      headerRow: 3, keyCol: 0, descCol: 1 },
  // c_TipoDeComprobante
  { sheet: 'c_TipoDeComprobante', catalog: 'c_TipoDeComprobante', headerRow: 3, keyCol: 0, descCol: 1 },
  // c_TipoRelacion
  { sheet: 'c_TipoRelacion',    catalog: 'c_TipoRelacion',    headerRow: 3, keyCol: 0, descCol: 1 },
  // c_TipoFactor
  { sheet: 'c_TipoFactor',      catalog: 'c_TipoFactor',      headerRow: 3, keyCol: 0, descCol: 0 },
  // c_ObjetoImp
  { sheet: 'c_ObjetoImp',       catalog: 'c_ObjetoImp',       headerRow: 3, keyCol: 0, descCol: 1 },
  // c_Exportacion
  { sheet: 'c_Exportacion',     catalog: 'c_Exportacion',     headerRow: 3, keyCol: 0, descCol: 1 },
  // c_Moneda
  { sheet: 'c_Moneda',          catalog: 'c_Moneda',          headerRow: 3, keyCol: 0, descCol: 1 },
  // c_Periodicidad
  { sheet: 'c_Periodicidad',    catalog: 'c_Periodicidad',    headerRow: 3, keyCol: 0, descCol: 1 },
  // c_UsoCFDI (refrescar)
  { sheet: 'c_UsoCFDI',         catalog: 'c_UsoCFDI',         headerRow: 3, keyCol: 0, descCol: 1 },
  // c_Pais
  { sheet: 'c_Pais',            catalog: 'c_Pais',            headerRow: 3, keyCol: 0, descCol: 1 },
];

function trim(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  return String(v).replace(/\s+/g, ' ').trim();
}

async function loadSheet(
  wb: XLSX.WorkBook,
  cfg: typeof SHEETS[number]
): Promise<{ name: string; inserted: number; skipped: number }> {
  if (!wb.SheetNames.includes(cfg.sheet)) {
    return { name: cfg.sheet, inserted: 0, skipped: -1 };
  }
  const aoa: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[cfg.sheet], {
    header: 1,
    defval: null,
    blankrows: false,
  });

  let inserted = 0;
  let skipped = 0;
  const BATCH = 500;
  let buf: Array<{ k: string; d: string }> = [];
  const seen = new Set<string>();   // evita duplicados dentro del mismo INSERT (ON CONFLICT no acepta dos veces la misma fila)

  const flush = async () => {
    if (buf.length === 0) return;
    const values: any[] = [];
    const placeholders: string[] = [];
    let i = 1;
    for (const e of buf) {
      placeholders.push(`($${i++}, $${i++}, $${i++}, true)`);
      values.push(cfg.catalog, e.k, e.d);
    }
    const sql = `INSERT INTO sat_catalogs (catalog_name, catalog_key, description, is_active)
                 VALUES ${placeholders.join(',')}
                 ON CONFLICT (catalog_name, catalog_key) DO UPDATE
                   SET description = EXCLUDED.description, is_active = true`;
    await query(sql, values);
    buf = [];
  };

  // Empezamos en la fila siguiente al header
  for (let r = cfg.headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row) continue;
    const key = trim(row[cfg.keyCol]);
    let desc = trim(row[cfg.descCol]);
    if (cfg.extraDescCol !== undefined && row[cfg.extraDescCol]) {
      const extra = trim(row[cfg.extraDescCol]);
      if (extra && extra !== desc) desc = (desc ? desc + ' — ' : '') + extra;
    }
    if (!key) { skipped++; continue; }
    if (/^total$/i.test(key)) { skipped++; continue; }
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    buf.push({ k: key, d: desc });
    inserted++;
    if (buf.length >= BATCH) await flush();
  }
  await flush();
  return { name: cfg.sheet, inserted, skipped };
}

async function main() {
  const xlsPath = process.argv[2] || DEFAULT_XLS;
  if (!fs.existsSync(xlsPath)) {
    logger.error(`No existe el archivo: ${xlsPath}`);
    process.exit(1);
  }
  const sizeMB = Math.round(fs.statSync(xlsPath).size / 1024 / 1024);
  logger.info(`Leyendo ${path.basename(xlsPath)} (${sizeMB} MB)…`);

  const wb = XLSX.readFile(xlsPath, {
    cellDates: false, cellNF: false, cellText: false, cellStyles: false,
  });
  logger.info(`Hojas detectadas: ${wb.SheetNames.length}`);

  for (const cfg of SHEETS) {
    process.stdout.write(`  ${cfg.sheet.padEnd(28, ' ')} → `);
    const t0 = Date.now();
    const r = await loadSheet(wb, cfg);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.skipped === -1) {
      console.log('hoja no encontrada');
    } else {
      console.log(`${r.inserted} entradas (skip ${r.skipped}) en ${dt}s`);
    }
  }

  const counts = await query<{ catalog_name: string; count: string }>(
    `SELECT catalog_name, COUNT(*) FROM sat_catalogs GROUP BY catalog_name ORDER BY catalog_name`
  );
  logger.info('\nTotales en sat_catalogs:');
  for (const r of counts.rows) logger.info(`   ${r.catalog_name.padEnd(24)} = ${r.count}`);

  await closePool();
  process.exit(0);
}

main().catch(async (e) => {
  logger.error('Error: ' + (e?.message || e));
  await closePool();
  process.exit(1);
});
