/**
 * pg-resilience.ts — pre-flight check del stack con retry exponencial.
 *
 * Postgres portable (modo dev) se cae cada vez que el equipo entra en suspensión.
 * Esta utilidad lo detecta y, en Windows, lo arranca automáticamente vía pg_ctl
 * antes de iniciar la suite. Si después de N intentos sigue caído, falla con
 * un mensaje accionable (cómo arrancarlo a mano) en vez de dejar que la
 * suite truene con timeouts crípticos.
 */
import { Client } from 'pg';
import { spawnSync } from 'node:child_process';
import * as net from 'node:net';

export interface PreflightConfig {
  pgHost: string;
  pgPort: number;
  pgUser: string;
  pgPassword: string;
  pgDatabase: string;
  pgCtlPath?: string;        // ruta a pg_ctl.exe — habilita auto-start en Windows
  pgDataDir?: string;        // requerido si pgCtlPath está seteado
  pgLogPath?: string;
  backendHealthUrl: string;
  frontendUrl: string;
  maxAttempts: number;
  backoffStartMs: number;
  backoffMaxMs: number;
}

const DEFAULT_CFG: PreflightConfig = {
  pgHost:           process.env.PGHOST     || 'localhost',
  pgPort: Number(   process.env.PGPORT     || 5432),
  pgUser:           process.env.PGUSER     || 'postgres',
  pgPassword:       process.env.PGPASSWORD || 'postgres',
  pgDatabase:       process.env.PGDATABASE || 'cfdi_erp',
  pgCtlPath:        process.env.PG_CTL_PATH || 'C:/pgportable/pgsql/bin/pg_ctl.exe',
  pgDataDir:        process.env.PG_DATA_DIR || 'C:/pgportable/data',
  pgLogPath:        process.env.PG_LOG_PATH || 'C:/pgportable/log.txt',
  backendHealthUrl: process.env.BE_HEALTH  || 'http://localhost:3000/health',
  frontendUrl:      process.env.FE_URL     || 'http://localhost:5173',
  maxAttempts: Number(process.env.PREFLIGHT_RETRIES || 8),
  backoffStartMs: 250,
  backoffMaxMs:   2000,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Backoff exponencial con jitter — evita thundering-herd en CI compartido. */
function backoff(attempt: number, cfg: PreflightConfig): number {
  const exp = Math.min(cfg.backoffMaxMs, cfg.backoffStartMs * Math.pow(2, attempt));
  const jitter = Math.random() * 0.3 * exp;
  return Math.floor(exp + jitter);
}

/** Prueba TCP a host:port — el chequeo más barato. */
function tcpPing(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new net.Socket();
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeoutMs);
    s.once('connect',  () => done(true));
    s.once('timeout',  () => done(false));
    s.once('error',    () => done(false));
    s.connect(port, host);
  });
}

/** Conecta y ejecuta `SELECT 1` — verifica BD operativa, no solo el puerto. */
async function pgPing(cfg: PreflightConfig): Promise<boolean> {
  const c = new Client({
    host: cfg.pgHost, port: cfg.pgPort,
    user: cfg.pgUser, password: cfg.pgPassword,
    database: cfg.pgDatabase,
    connectionTimeoutMillis: 2000,
    statement_timeout: 2000,
  });
  try {
    await c.connect();
    await c.query('SELECT 1');
    await c.end();
    return true;
  } catch { try { await c.end(); } catch { /* nada */ } return false; }
}

/** Auto-arranca Postgres portable en Windows si está disponible pg_ctl. */
function tryStartPostgres(cfg: PreflightConfig): boolean {
  if (!cfg.pgCtlPath || !cfg.pgDataDir) return false;
  try {
    const r = spawnSync(cfg.pgCtlPath,
      ['-D', cfg.pgDataDir, '-l', cfg.pgLogPath || 'pg.log', 'start'],
      { timeout: 10_000, encoding: 'utf8' });
    if (r.status === 0) {
      console.log('[preflight] pg_ctl start → OK');
      return true;
    }
    console.warn('[preflight] pg_ctl start falló:', r.stderr?.slice(0, 200));
    return false;
  } catch (e) {
    console.warn('[preflight] no se pudo invocar pg_ctl:', (e as Error).message);
    return false;
  }
}

async function httpOk(url: string): Promise<boolean> {
  try {
    // node 18+ trae fetch nativo
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}

export interface PreflightReport {
  pgUp: boolean;
  beUp: boolean;
  feUp: boolean;
  attempts: number;
  durationMs: number;
}

/**
 * Verifica que el stack (PG + Backend + Frontend) esté operativo.
 * Lanza si tras `maxAttempts` no logra confirmar. La función es **idempotente**:
 * se puede llamar al inicio de cualquier suite sin efectos secundarios extra.
 */
export async function runPreflight(
  override: Partial<PreflightConfig> = {}
): Promise<PreflightReport> {
  const cfg: PreflightConfig = { ...DEFAULT_CFG, ...override };
  const t0 = Date.now();

  // 1) PG primero — sin BD no hay nada que probar.
  let pgUp = false;
  let attempts = 0;
  for (; attempts < cfg.maxAttempts; attempts++) {
    const tcp = await tcpPing(cfg.pgHost, cfg.pgPort);
    if (tcp && await pgPing(cfg)) { pgUp = true; break; }

    // Intentamos arrancar PG la primera vez que falla
    if (attempts === 0) tryStartPostgres(cfg);
    const delay = backoff(attempts, cfg);
    console.log(`[preflight] PG no responde, reintento ${attempts + 1}/${cfg.maxAttempts} en ${delay}ms`);
    await sleep(delay);
  }
  if (!pgUp) {
    throw new Error(
      [
        '─────────────────────────────────────────────',
        ' PRE-FLIGHT FAILED — Postgres no responde.',
        '─────────────────────────────────────────────',
        ` host:${cfg.pgHost}  port:${cfg.pgPort}  db:${cfg.pgDatabase}`,
        ' Verifica manualmente:',
        `  "${cfg.pgCtlPath}" -D "${cfg.pgDataDir}" status`,
        '  PGPASSWORD=postgres psql -h localhost -U postgres -d cfdi_erp -c "SELECT 1"',
      ].join('\n')
    );
  }

  // 2) Backend
  let beUp = false;
  for (let i = 0; i < cfg.maxAttempts; i++) {
    if (await httpOk(cfg.backendHealthUrl)) { beUp = true; break; }
    await sleep(backoff(i, cfg));
  }
  if (!beUp) {
    throw new Error(
      `PRE-FLIGHT FAILED — Backend no responde en ${cfg.backendHealthUrl}\n` +
      'Levanta con:  cd backend && npm run dev'
    );
  }

  // 3) Frontend (solo informativo — los tests API no lo requieren)
  let feUp = false;
  for (let i = 0; i < 3; i++) {
    if (await httpOk(cfg.frontendUrl)) { feUp = true; break; }
    await sleep(500);
  }
  if (!feUp) {
    console.warn(`[preflight] ⚠ Frontend no responde en ${cfg.frontendUrl} — tests UI se skipearán.`);
  }

  const durationMs = Date.now() - t0;
  console.log(`[preflight] ✅ Stack OK en ${durationMs}ms (PG OK tras ${attempts} reintento(s))`);
  return { pgUp, beUp, feUp, attempts, durationMs };
}
