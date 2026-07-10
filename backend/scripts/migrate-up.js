#!/usr/bin/env node
/**
 * migrate-up.js — runner de migraciones idempotente para producción.
 *
 *   · Se ejecuta antes de `node dist/index.js` en Render (start:prod)
 *   · Lee TODOS los .sql en src/database/migrations/ ordenados alfabéticamente
 *   · Aplica cada uno UNA sola vez (registro en tabla schema_migrations)
 *   · Si falla, aborta el arranque del backend con exit 1
 *
 * NO usa ORM. Solo `pg` para portabilidad con Render/Supabase/RDS.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'src', 'database', 'migrations');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[migrate] DATABASE_URL no está definido — abortando');
    process.exit(1);
  }
  const client = new Client({
    connectionString,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  await client.connect();
  console.log('[migrate] conectado a Postgres');

  // Tabla de control
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // El schema base (schema.sql) también debe correr una vez si nunca corrió.
  const baseSchemaPath = path.resolve(__dirname, '..', 'src', 'database', 'schema.sql');
  if (fs.existsSync(baseSchemaPath)) {
    const already = await client.query(
      `SELECT 1 FROM schema_migrations WHERE filename = 'schema.sql'`
    );
    if (already.rows.length === 0) {
      console.log('[migrate] aplicando schema.sql (base)…');
      const sql = fs.readFileSync(baseSchemaPath, 'utf8');
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (filename) VALUES ('schema.sql')`
      );
      console.log('[migrate] schema.sql ✔');
    }
  }

  // Migraciones incrementales
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('[migrate] sin carpeta de migraciones, listo');
    await client.end();
    return;
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const already = await client.query(
      `SELECT 1 FROM schema_migrations WHERE filename = $1`,
      [file]
    );
    if (already.rows.length > 0) {
      console.log(`[migrate] skip ${file} (ya aplicada)`);
      continue;
    }
    console.log(`[migrate] aplicando ${file}…`);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (filename) VALUES ($1)`,
        [file]
      );
      console.log(`[migrate] ${file} ✔`);
    } catch (e) {
      console.error(`[migrate] ${file} FALLÓ:`, e.message);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log('[migrate] OK');
}

main().catch((e) => {
  console.error('[migrate] error fatal:', e.message);
  process.exit(1);
});
