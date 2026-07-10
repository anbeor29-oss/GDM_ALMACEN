/**
 * Environment Configuration
 * Validates and exports environment variables
 */

interface EnvironmentConfig {
  nodeEnv: string;
  appName: string;
  appPort: number;
  apiVersion: string;
  logLevel: string;
  db: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    ssl: boolean;
    poolMin: number;
    poolMax: number;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
    ttl: number;
  };
  jwt: {
    secret: string;
    refreshSecret: string;
    expiration: string;
    refreshExpiration: string;
  };
  encryption: {
    key: string;
  };
  cors: {
    origin: string[];
    credentials: boolean;
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  frontendUrl: string;
  features: {
    pacIntegration: boolean;
    multiRfc: boolean;
    inventory: boolean;
    advancedReports: boolean;
  };
}

function validateEnv(): void {
  // Aceptamos DOS formas de configurar la BD:
  //   1) DATABASE_URL (Render, Heroku, Supabase, etc.)
  //   2) DB_HOST + DB_PORT + DB_NAME + DB_USER + DB_PASSWORD (self-hosted)
  const hasUrl = !!process.env.DATABASE_URL;
  const dbRequired = hasUrl ? [] : ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const required = [...dbRequired, 'JWT_SECRET', 'JWT_REFRESH_SECRET'];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * Parsea DATABASE_URL en sus componentes.
 * Formato: postgresql://user:password@host:port/dbname
 */
function parseDatabaseUrl(url: string) {
  const parsed = new URL(url);
  return {
    host:     parsed.hostname,
    port:     parseInt(parsed.port || '5432', 10),
    name:     parsed.pathname.replace(/^\//, ''),
    user:     decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  };
}

function parseArray(str: string): string[] {
  return str.split(',').map(s => s.trim());
}

function parseBoolean(str?: string): boolean {
  return str?.toLowerCase() === 'true';
}

function getConfig(): EnvironmentConfig {
  validateEnv();

  // Si viene DATABASE_URL, la desglosamos; si no, tomamos las vars sueltas.
  const dbFromUrl = process.env.DATABASE_URL
    ? parseDatabaseUrl(process.env.DATABASE_URL)
    : null;

  // Render inyecta $PORT que el proceso debe usar (no APP_PORT).
  const runtimePort = parseInt(
    process.env.PORT || process.env.APP_PORT || '3001',
    10
  );

  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    appName: process.env.APP_NAME || 'ERP CFDI Mexico Backend',
    appPort: runtimePort,
    apiVersion: process.env.API_VERSION || 'v1',
    logLevel: process.env.LOG_LEVEL || 'debug',

    db: {
      host: dbFromUrl?.host ?? process.env.DB_HOST!,
      port: dbFromUrl?.port ?? parseInt(process.env.DB_PORT || '5432', 10),
      name: dbFromUrl?.name ?? process.env.DB_NAME!,
      user: dbFromUrl?.user ?? process.env.DB_USER!,
      password: dbFromUrl?.password ?? process.env.DB_PASSWORD!,
      ssl: parseBoolean(process.env.DB_SSL),
      poolMin: parseInt(process.env.DB_POOL_MIN || '2', 10),
      poolMax: parseInt(process.env.DB_POOL_MAX || '10', 10),
    },

    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      ttl: parseInt(process.env.REDIS_TTL || '3600', 10),
    },

    jwt: {
      secret: process.env.JWT_SECRET!,
      refreshSecret: process.env.JWT_REFRESH_SECRET!,
      expiration: process.env.JWT_EXPIRATION || '1h',
      refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
    },

    encryption: {
      key: process.env.ENCRYPTION_KEY || 'default_encryption_key_change_in_prod',
    },

    cors: {
      origin: parseArray(process.env.CORS_ORIGIN || 'http://localhost:3000'),
      credentials: parseBoolean(process.env.CORS_CREDENTIALS),
    },

    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    },

    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

    features: {
      pacIntegration: parseBoolean(process.env.FEATURE_PAC_INTEGRATION),
      multiRfc: parseBoolean(process.env.FEATURE_MULTI_RFC),
      inventory: parseBoolean(process.env.FEATURE_INVENTORY),
      advancedReports: parseBoolean(process.env.FEATURE_ADVANCED_REPORTS),
    },
  };
}

export const config = getConfig();

export default config;
