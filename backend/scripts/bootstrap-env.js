/**
 * bootstrap-env — deja el despliegue de GDM ALMACÉN listo en el primer arranque.
 *
 * Corre en el startCommand del Blueprint DESPUÉS de las migraciones. Idempotente
 * y NO fatal: crea (o reutiliza) la empresa por RFC y un admin ligado a ella.
 * JS plano (sin ts-node) porque en runtime de Render no hay devDeps.
 *
 * Sólo actúa si BOOTSTRAP_ADMIN_EMAIL y BOOTSTRAP_ADMIN_PASSWORD están definidos
 * (si no, no-op — seguro de tener en el repo). No siembra stock: en este sistema
 * el inventario entra por compras/XML vía applyMovement, no por INSERT directo.
 *
 * Uso: npm run bootstrap:env
 */
const { Pool } = require('pg');
const bcryptjs = require('bcryptjs');

function env(key, fallback = '') {
  const v = process.env[key];
  return v == null || v === '' ? fallback : v;
}

function buildPool() {
  const url = process.env.DATABASE_URL;
  const wantsSsl = process.env.DB_SSL === 'true' || (!!url && /render\.com|oregon-postgres/.test(url));
  if (url) {
    return new Pool({ connectionString: url, ssl: wantsSsl ? { rejectUnauthorized: false } : false });
  }
  return new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'app_user',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'cfdi_erp',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

async function bootstrap(db) {
  const adminEmail = env('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  const adminPassword = env('BOOTSTRAP_ADMIN_PASSWORD');
  if (!adminEmail || !adminPassword) {
    console.log('[bootstrap] BOOTSTRAP_ADMIN_EMAIL/PASSWORD no definidos -> no-op.');
    return;
  }

  const rfc = env('BOOTSTRAP_COMPANY_RFC', 'EKU9003173C9').toUpperCase();
  const companyName = env('BOOTSTRAP_COMPANY_NAME', 'GDM ALMACEN DEMO');
  const regime = env('BOOTSTRAP_COMPANY_REGIME', '601');
  const cp = env('BOOTSTRAP_COMPANY_CP', '20000');
  const state = env('BOOTSTRAP_COMPANY_STATE', '01');
  const companyEmail = env('BOOTSTRAP_COMPANY_EMAIL', adminEmail);
  const firstName = env('BOOTSTRAP_ADMIN_FIRST_NAME', 'Admin');
  const lastName = env('BOOTSTRAP_ADMIN_LAST_NAME', 'General');

  // 1) Empresa (idempotente por RFC) — mismo INSERT que companies.service.
  let companyId;
  const compR = await db.query('SELECT id FROM companies WHERE rfc = $1', [rfc]);
  if (compR.rows.length > 0) {
    companyId = compR.rows[0].id;
    console.log(`[bootstrap] Empresa ${rfc} ya existe -> reutilizada.`);
  } else {
    const ins = await db.query(
      `INSERT INTO companies
         (rfc, business_name, fiscal_regime, postal_code, state, email, phone,
          is_active, verified_with_sat, next_invoice_folio, default_invoice_series, subscription_plan)
       VALUES ($1,$2,$3,$4,$5,$6,$7, true, false, 1, 'F', 'STARTER')
       RETURNING id`,
      [rfc, companyName, regime, cp, state, companyEmail, null]
    );
    companyId = ins.rows[0].id;
    console.log(`[bootstrap] Empresa creada: ${companyName} (${rfc}).`);
  }

  // 2) Admin ligado a la empresa (idempotente por email) — mismo INSERT que auth.service.
  const userR = await db.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
  if (userR.rows.length > 0) {
    console.log(`[bootstrap] Usuario ${adminEmail} ya existe -> no se recrea.`);
  } else {
    const salt = await bcryptjs.genSalt(10);
    const passwordHash = await bcryptjs.hash(adminPassword, salt);
    await db.query(
      `INSERT INTO users
         (email, password_hash, first_name, last_name, phone, role, company_id, is_active, failed_login_attempts)
       VALUES ($1,$2,$3,$4,$5,$6,$7, true, 0)`,
      [adminEmail, passwordHash, firstName, lastName, null, 'ADMIN', companyId]
    );
    console.log(`[bootstrap] Admin creado: ${adminEmail} (rol ADMIN).`);
  }

  console.log('[bootstrap] OK. Entra con BOOTSTRAP_ADMIN_EMAIL y su contraseña.');
}

(async () => {
  const pool = buildPool();
  try {
    await bootstrap(pool);
  } catch (e) {
    console.error('[bootstrap] AVISO (no bloquea el arranque):', (e && e.message) || e);
  } finally {
    await pool.end().catch(() => {});
  }
  process.exit(0);
})();
