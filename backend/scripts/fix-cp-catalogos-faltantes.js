#!/usr/bin/env node
/**
 * fix-cp-catalogos-faltantes.js — repone la fila que se perdió en cada
 * catálogo SAT del Complemento Carta Porte.
 *
 * Origen del daño: apply-cp-seed.js partía el seed por ';\n' y descartaba
 * toda sentencia que empezara con '--'. Como el comentario que encabeza cada
 * catálogo queda pegado al primer INSERT de su bloque, ese INSERT se iba con
 * el comentario. Resultado: 34 catálogos sin su primera clave.
 *
 * Las bajas duelen porque son justo las claves de uso diario:
 *   sat_cp_documento_aduanero  '01' Pedimento
 *   sat_cp_figura_transporte   '01' Operador
 *   sat_cp_cve_transporte      '01' Autotransporte
 *   sat_cp_tipo_estacion       '01' Origen Nacional
 *   sat_cp_tipo_materia        '01' Materia prima
 *   sat_cp_tipo_permiso        'TPAF01', sat_cp_sub_tipo_rem 'CTR001', …
 *
 * El parser ya está corregido, pero apply-cp-seed se salta el trabajo cuando
 * catalog_versions tiene fila — las bases ya sembradas no se repararían solas.
 * Este script extrae del mismo .gz únicamente las sentencias que el parser
 * viejo tiraba y las aplica. Es idempotente: los INSERT del seed traen
 * ON CONFLICT DO UPDATE, así que correrlo de más no hace daño.
 *
 * Se ejecuta en el arranque de producción (start:prod) junto a fix-cp-swap.
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const { Client } = require('pg');

const SEED_GZ = path.resolve(
  __dirname, '..', 'src', 'database', 'seeds', '2026-07-18_carta_porte_catalogs.sql.gz',
);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('[cp-fix] DATABASE_URL vacío — abortando'); process.exit(1); }
  if (!fs.existsSync(SEED_GZ)) {
    console.log('[cp-fix] no está el seed — nada que reponer, skip');
    return;
  }

  const client = new Client({
    connectionString: url,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  // Si los catálogos no existen todavía, apply-cp-seed corre después con el
  // parser ya corregido y no hay nada que reparar.
  const t = await client.query(`SELECT to_regclass('sat_cp_documento_aduanero') AS t`);
  if (!t.rows[0].t) {
    console.log('[cp-fix] catálogos aún no creados — skip');
    await client.end();
    return;
  }

  const sql = zlib.gunzipSync(fs.readFileSync(SEED_GZ)).toString('utf8');

  // Reproducimos el corte del parser viejo y nos quedamos justo con lo que
  // descartaba: bloques que empiezan en comentario pero traen un INSERT.
  const perdidas = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => /^--/.test(s) && /INSERT INTO/.test(s))
    .map(s => s.replace(/^(?:[ \t]*--[^\n]*\n|[ \t]*\n)+/, '').trim());

  if (!perdidas.length) {
    console.log('[cp-fix] el seed no tiene filas pegadas a comentario — nada que hacer');
    await client.end();
    return;
  }

  let repuestas = 0;
  await client.query('BEGIN');
  try {
    for (const stmt of perdidas) {
      const r = await client.query(stmt);
      repuestas += r.rowCount ?? 0;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
    throw e;
  }

  console.log(`[cp-fix] ${perdidas.length} claves revisadas · ${repuestas} filas escritas`);

  // Comprobación de las tres que más se usan.
  const check = await client.query(`
    SELECT 'documento_aduanero 01' AS clave, count(*) FROM sat_cp_documento_aduanero WHERE clave='01'
    UNION ALL SELECT 'figura_transporte 01', count(*) FROM sat_cp_figura_transporte  WHERE clave='01'
    UNION ALL SELECT 'cve_transporte 01',    count(*) FROM sat_cp_cve_transporte     WHERE clave='01'
  `);
  for (const row of check.rows) {
    console.log(`[cp-fix]   ${row.clave}: ${row.count === '1' ? 'ok' : 'FALTA'}`);
  }

  await client.end();
}

main().catch(e => { console.error('[cp-fix] falló:', e.message); process.exit(1); });
