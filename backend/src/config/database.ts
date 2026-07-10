/**
 * PostgreSQL Database Configuration
 * Manages connection pool and queries
 */

import { Pool, PoolClient, types } from 'pg';
import { config } from './environment';
import logger from '../middleware/logger';

// PostgreSQL devuelve NUMERIC/DECIMAL (OID 1700) como string por defecto.
// El código de negocio espera números (usa .toFixed, sumas, etc.),
// así que parseamos numeric a float de forma global.
types.setTypeParser(1700, (val: string | null) => (val === null ? null : parseFloat(val)) as unknown as string);

// Create connection pool.
// Preferimos DATABASE_URL (Render/Heroku/etc.) si está definido; si no,
// caemos a los campos discretos del .env local.
export const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
      min: config.db.poolMin,
      max: config.db.poolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : new Pool({
      host: config.db.host,
      port: config.db.port,
      database: config.db.name,
      user: config.db.user,
      password: config.db.password,
      ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
      min: config.db.poolMin,
      max: config.db.poolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

// Connection event handlers
pool.on('connect', () => {
  logger.debug('Database pool connection established');
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
});

pool.on('remove', () => {
  logger.debug('Database pool client removed');
});

/**
 * Execute a query with automatic connection handling
 */
export async function query<T = any>(
  text: string,
  values?: any[]
): Promise<{ rows: T[]; rowCount: number }> {
  const start = Date.now();

  try {
    const result = await pool.query(text, values);
    const duration = Date.now() - start;

    logger.debug(`Query executed (${duration}ms): ${text.substring(0, 50)}`);

    return {
      rows: result.rows,
      rowCount: result.rowCount || 0,
    };
  } catch (error) {
    logger.error('Database query error', {
      query: text.substring(0, 100),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Execute a transaction
 */
export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    logger.debug('Transaction committed successfully');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Transaction rolled back', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Execute query within a transaction
 */
export async function transactionQuery<T = any>(
  client: PoolClient,
  text: string,
  values?: any[]
): Promise<{ rows: T[]; rowCount: number }> {
  try {
    const result = await client.query(text, values);
    return {
      rows: result.rows,
      rowCount: result.rowCount || 0,
    };
  } catch (error) {
    logger.error('Transaction query error', {
      query: text.substring(0, 100),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Check database connection
 */
export async function checkConnection(): Promise<boolean> {
  try {
    const result = await query('SELECT NOW()');
    logger.info('✅ Database connection successful');
    return result.rows.length > 0;
  } catch (error) {
    logger.error('❌ Database connection failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

/**
 * Close database pool
 */
export async function closePool(): Promise<void> {
  await pool.end();
  logger.info('Database pool closed');
}

export default {
  pool,
  query,
  transaction,
  transactionQuery,
  checkConnection,
  closePool,
};
