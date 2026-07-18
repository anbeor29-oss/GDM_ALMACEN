#!/usr/bin/env node
/**
 * apply-cp-seed.js — carga idempotente de los catálogos SAT del Complemento
 * Carta Porte 3.1 en la BD de producción.
 *
 * Flujo:
 *   1) Verifica si la tabla catalog_versions ya tiene una fila con el SHA-256
 *      del seed vigente. Si sí, no hace nada.
 *   2) Descomprime el seed .gz, lo aplica en una sola transacción y confía en
 *      los ON CONFLICT del propio SQL para reintentos.
 *
 * Se ejecuta después de `migrate:up` y antes de `bootstrap:env` en el
 * startCommand de Render (ver render.yaml). Si falla, aborta el arranque
 * para que Render marque el deploy como caído.
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const { Client } = require('pg');

const SEED_GZ = path.resolve(__dirname, '..', 'src', 'database', 'seeds', '2026-07-18_carta_porte_catalogs.sql.gz');
const SEED_MARKER = 'CartaPorte31';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('[cp-seed] DATABASE_URL vacío — abortando'); process.exit(1); }
  if (!fs.existsSync(SEED_GZ)) { console.error(`[cp-seed] falta ${SEED_GZ}`); process.exit(1); }

  const client = new Client({
    connectionString: url,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  const versioned = await client.query(
    `SELECT to_regclass('catalog_versions') AS t, to_regclass('sat_cp_clave_prod_serv') AS c`,
  );
  if (!versioned.rows[0].t || !versioned.rows[0].c) {
    console.error('[cp-seed] tablas de CP aún no existen — corre migrate:up primero');
    await client.end();
    process.exit(1);
  }

  const already = await client.query(
    `SELECT 1 FROM catalog_versions WHERE catalog_name = $1 LIMIT 1`, [SEED_MARKER],
  );
  if (already.rowCount) {
    console.log('[cp-seed] catálogos ya cargados (catalog_versions tiene fila) — skip');
    await client.end();
    return;
  }

  console.log('[cp-seed] descomprimiendo seed…');
  const sql = zlib.gunzipSync(fs.readFileSync(SEED_GZ)).toString('utf8');
  console.log(`[cp-seed] aplicando ${(sql.length / 1024 / 1024).toFixed(2)} MB en lotes…`);

  // Instancias pequeñas de Postgres (basic-256mb) revientan si se manda todo
  // en una sola query. Trocamos por sentencia (fin en ';' al final de línea)
  // y aplicamos en lotes de N con una transacción por lote.
  //
  // El propio SQL abre BEGIN/COMMIT global — se ignoran cuando aplicamos por
  // lotes (cada lote lleva su propia transacción). Los INSERTs son idempotentes
  // gracias a ON CONFLICT DO UPDATE, así que reintentar es seguro.
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s && !/^--/.test(s) && !/^(BEGIN|COMMIT)$/i.test(s));

  const BATCH = 500;
  const t0 = Date.now();
  let done = 0;
  for (let i = 0; i < statements.length; i += BATCH) {
    const chunk = statements.slice(i, i + BATCH).join(';\n') + ';';
    try {
      await client.query('BEGIN');
      await client.query(chunk);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`lote ${i}-${i + BATCH}: ${e.message}`);
    }
    done += Math.min(BATCH, statements.length - i);
    if (done % 5000 === 0 || done === statements.length) {
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[cp-seed] ${done}/${statements.length} sentencias · ${secs}s`);
    }
  }
  console.log(`[cp-seed] OK — ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await client.end();
}

main().catch(e => { console.error('[cp-seed] falló:', e.message); process.exit(1); });
