/**
 * Script: Run Database Migrations
 * Usage: npm run migrate
 *
 * Ejecuta el esquema completo (schema.sql) contra PostgreSQL.
 * Idempotente: usa CREATE TABLE IF NOT EXISTS.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { query, closePool } from '../src/config/database';
import logger from '../src/middleware/logger';

async function migrate() {
  try {
    logger.info('Running database migrations...');

    const schemaPath = join(__dirname, '..', 'src', 'database', 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    logger.info(`Executing schema from ${schemaPath}`);
    await query(schema);

    logger.info('✅ Migrations completed successfully!');
    logger.info('');
    logger.info('Tables created/verified:');
    logger.info('  ✓ companies');
    logger.info('  ✓ users');
    logger.info('  ✓ user_sessions');
    logger.info('  ✓ customers');
    logger.info('  ✓ products');
    logger.info('  ✓ invoices');
    logger.info('  ✓ invoice_items');
    logger.info('  ✓ sat_catalogs');
    logger.info('  ✓ cfdi_validations');
    logger.info('  ✓ pac_stamps');

    await closePool();
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    await closePool();
    process.exit(1);
  }
}

migrate();
