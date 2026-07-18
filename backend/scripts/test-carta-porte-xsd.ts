/**
 * test-carta-porte-xsd — valida un XML timbrado contra catCartaPorte.xsd
 * usando xmllint-wasm (libxml2 compilado a WebAssembly, sin dependencias
 * nativas).
 *
 * Uso:
 *   npx ts-node scripts/test-carta-porte-xsd.ts <ruta-al-xml>
 *
 * Si no se pasa argumento, toma el XML timbrado más reciente en BD.
 *
 * Sale con exit 0 si el XML valida contra el XSD, exit 1 si hay errores.
 */

import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';
import { pool } from '../src/config/database';

const XSD_DIR = 'E:/Obsidian/ANBEOR/raw/carta_porte_31';
const XSD_PATH = `${XSD_DIR}/CartaPorte31.xsd`;

async function main() {
  const arg = process.argv[2];
  let xml: string;
  if (arg) {
    xml = fs.readFileSync(arg, 'utf-8');
    console.log(`[xsd] leyendo XML de ${arg}`);
  } else {
    const r = await pool.query(
      `SELECT xml_content FROM invoices
       WHERE xml_content IS NOT NULL AND xml_content ILIKE '%cartaporte31:CartaPorte%'
       ORDER BY updated_at DESC LIMIT 1`,
    );
    if (!r.rowCount) {
      console.error('[xsd] no hay XMLs con Carta Porte en BD; timbra uno primero');
      process.exit(1);
    }
    xml = r.rows[0].xml_content;
    console.log('[xsd] usando el último XML timbrado con CP de la BD');
  }

  // Extraemos solo el nodo cartaporte31 para validar contra su XSD sin arrastrar
  // el CFDI completo (que necesitaría cfdv40.xsd + su cadena de imports).
  const m = xml.match(/<cartaporte31:CartaPorte[\s\S]*?<\/cartaporte31:CartaPorte>/);
  if (!m) {
    console.error('[xsd] no encontré el nodo cartaporte31:CartaPorte en el XML');
    process.exit(1);
  }
  const cpNode = m[0].replace(
    '<cartaporte31:CartaPorte',
    `<cartaporte31:CartaPorte xmlns:cartaporte31="http://www.sat.gob.mx/CartaPorte31"`,
  );

  // Import dinámico porque xmllint-wasm es ESM
  const { validateXML } = await import('xmllint-wasm');
  // Los schemaLocation absolutos del SAT no se resuelven en WASM; se
  // reescriben a los nombres locales que damos en `preload`.
  // Los schemaLocation absolutos se reescriben a los nombres locales del
  // preload. Los catálogos gigantes (catCFDI 6MB, catComExt 1MB) se
  // reemplazan por stubs de tipos abiertos: revientan el WASM y el bloque 7
  // ya valida enumeraciones semánticamente contra la BD.
  const rewrite = (s: string) => s
    .replace(/schemaLocation="http:\/\/www\.sat\.gob\.mx\/sitio_internet\/cfd\/catalogos\/catCFDI\.xsd"/g, 'schemaLocation="catCFDI.xsd"')
    .replace(/schemaLocation="http:\/\/www\.sat\.gob\.mx\/sitio_internet\/cfd\/tipoDatos\/tdCFDI\/tdCFDI\.xsd"/g, 'schemaLocation="tdCFDI.xsd"')
    .replace(/schemaLocation="http:\/\/www\.sat\.gob\.mx\/sitio_internet\/cfd\/catalogos\/ComExt\/catComExt\.xsd"/g, 'schemaLocation="catComExt.xsd"')
    .replace(/schemaLocation="http:\/\/www\.sat\.gob\.mx\/sitio_internet\/cfd\/catalogos\/CartaPorte\/catCartaPorte\.xsd"/g, 'schemaLocation="catCartaPorte.xsd"');

  const xsd = rewrite(fs.readFileSync(XSD_PATH, 'utf-8'));
  const overrides: Record<string, string> = {
    'catCFDI.xsd':        fs.readFileSync(path.join(XSD_DIR, 'catCFDI-stub.xsd'), 'utf-8'),
    'catComExt.xsd':      fs.readFileSync(path.join(XSD_DIR, 'catComExt-stub.xsd'), 'utf-8'),
    // El archivo local `catCartaPorte.xsd` está incompleto (20 tipos). El
    // real del SAT trae 30 tipos y ese es el que usamos aquí.
    'catCartaPorte.xsd':  rewrite(fs.readFileSync(path.join(XSD_DIR, 'catCartaPorte-real.xsd'), 'utf-8')),
  };
  const preload = ['catCFDI.xsd', 'tdCFDI.xsd', 'catComExt.xsd', 'catCartaPorte.xsd'].map(
    name => ({
      fileName: name,
      contents: overrides[name] || rewrite(fs.readFileSync(path.join(XSD_DIR, name), 'utf-8')),
    }),
  );

  const result = await validateXML({
    xml: [{ fileName: 'cp.xml', contents: cpNode }],
    schema: [xsd],
    preload,
  });

  if (result.valid) {
    console.log('[xsd] ✓ VÁLIDO — el XML cumple con catCartaPorte.xsd');
    await pool.end();
    process.exit(0);
  }
  console.error('[xsd] ✗ INVÁLIDO — errores:');
  for (const err of result.errors) {
    console.error(`  · ${err.rawMessage || err.message}`);
  }
  await pool.end();
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
