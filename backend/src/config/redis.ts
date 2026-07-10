/**
 * Redis Configuration
 * For caching, sessions, and temporary data
 */

import { createClient, RedisClientType } from 'redis';
import { config } from './environment';
import logger from '../middleware/logger';

let redisClient: RedisClientType | null = null;

/**
 * Initialize Redis client
 */
export async function initRedis(): Promise<RedisClientType> {
  if (redisClient) {
    return redisClient;
  }

  redisClient = createClient({
    socket: {
      host: config.redis.host,
      port: config.redis.port,
      reconnectStrategy: (retries) => {
        // En demo/dev: no reintentar indefinidamente si Redis no está
        if (retries > 2) {
          return false;
        }
        return Math.min(retries * 100, 500);
      },
    },
    password: config.redis.password,
    database: config.redis.db,
  }) as RedisClientType;

  redisClient.on('connect', () => {
    logger.info('✅ Redis client connected');
  });

  redisClient.on('error', (err) => {
    logger.error('❌ Redis client error', { error: err.message });
  });

  redisClient.on('ready', () => {
    logger.info('✅ Redis client ready');
  });

  redisClient.on('end', () => {
    logger.info('Redis client disconnected');
  });

  // Evita que un evento 'error' sin manejar tumbe el proceso si Redis no existe
  redisClient.on('error', () => { /* ya logueado arriba; modo degradado */ });

  try {
    await redisClient.connect();
    return redisClient;
  } catch (error) {
    logger.warn('⚠️ Redis no disponible — la app continúa en modo degradado (sin caché de tokens)', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    redisClient = null;
    return null as unknown as RedisClientType;
  }
}

/**
 * Get Redis client (assumes initialized)
 */
export function getRedisClient(): RedisClientType {
  if (!redisClient) {
    throw new Error('Redis client not initialized. Call initRedis() first.');
  }
  return redisClient;
}

/**
 * Whether Redis is connected and ready.
 * Permite que la app funcione (modo degradado) cuando Redis no está disponible.
 */
export function isRedisReady(): boolean {
  return !!redisClient && redisClient.isReady;
}

/**
 * Set a key-value pair
 */
export async function set(
  key: string,
  value: any,
  ttl?: number
): Promise<void> {
  if (!isRedisReady()) {
    logger.debug(`Redis no disponible, omitiendo SET: ${key}`);
    return;
  }
  const client = getRedisClient();
  const serialized = JSON.stringify(value);

  try {
    if (ttl) {
      await client.setEx(key, ttl, serialized);
    } else {
      await client.set(key, serialized);
    }
    logger.debug(`Redis SET: ${key}`);
  } catch (error) {
    logger.error('Redis SET error', {
      key,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Get a value by key
 */
export async function get<T = any>(key: string): Promise<T | null> {
  if (!isRedisReady()) {
    return null;
  }
  const client = getRedisClient();

  try {
    const value = await client.get(key);
    if (value === null) {
      return null;
    }
    logger.debug(`Redis GET: ${key}`);
    return JSON.parse(value) as T;
  } catch (error) {
    logger.error('Redis GET error', {
      key,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Delete a key
 */
export async function del(key: string): Promise<number> {
  if (!isRedisReady()) {
    return 0;
  }
  const client = getRedisClient();

  try {
    const result = await client.del(key);
    logger.debug(`Redis DEL: ${key}`);
    return result;
  } catch (error) {
    logger.error('Redis DEL error', {
      key,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Check if key exists
 */
export async function exists(key: string): Promise<boolean> {
  const client = getRedisClient();

  try {
    const result = await client.exists(key);
    return result > 0;
  } catch (error) {
    logger.error('Redis EXISTS error', {
      key,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

/**
 * Clear all keys matching pattern
 */
export async function deletePattern(pattern: string): Promise<number> {
  const client = getRedisClient();

  try {
    const keys = await client.keys(pattern);
    if (keys.length === 0) {
      return 0;
    }

    let deleted = 0;
    for (const key of keys) {
      deleted += await client.del(key);
    }

    logger.debug(`Redis DELETEPATTERN: ${pattern} (${deleted} keys)`);
    return deleted;
  } catch (error) {
    logger.error('Redis DELETEPATTERN error', {
      pattern,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return 0;
  }
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
      redisClient = null;
      logger.info('Redis client closed');
    } catch (error) {
      logger.error('Error closing Redis', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

export default {
  initRedis,
  getRedisClient,
  set,
  get,
  del,
  exists,
  deletePattern,
  closeRedis,
};
