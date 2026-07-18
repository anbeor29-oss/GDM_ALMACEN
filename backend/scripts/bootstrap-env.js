/**
 * bootstrap-env — deja un despliegue NUEVO listo para usar en el primer arranque.
 *
 * Pensado para el Blueprint GDM_ALMACEN de Render: se ejecuta DESPUÉS de las
 * migraciones y ANTES de arrancar el server. Idempotente y NO fatal: si algo ya
 * existe lo reutiliza, y si falla NO tumba el boot (sale 0 siempre).
 *
 * JS plano (sin ts-node) porque en runtime de Render NO hay devDeps.
 *
 * Qué hace — SÓLO si BOOTSTRAP_ADMIN_EMAIL y BOOTSTRAP_ADMIN_PASSWORD existen:
 *   1) Crea (o reutiliza) la empresa por RFC.
 *   2) Crea (o reutiliza) un usuario ADMIN con grupo ADMIN_ALL ligado a ella.
 *   3) Siembra productos/clientes de ejemplo (salvo BOOTSTRAP_SEED_EXAMPLES=false).
 *
 * Si faltan las credenciales de admin, no hace NADA (no-op) — así es seguro que
 * exista en el repo sin afectar a producción, que no define estas variables.
 *
 * Uso: lo invoca el startCommand del Blueprint; también manual:
 *   npm run bootstrap:env
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
    return new Pool({
      connectionString: url,
      ssl: wantsSsl ? { rejectUnauthorized: false } : false,
    });
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

  // Sin credenciales de admin → no hay nada que hacer. Protege a producción.
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
  const doSeed = env('BOOTSTRAP_SEED_EXAMPLES', 'true') !== 'false';

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

  // 2) Admin ADMIN_ALL (idempotente por email) — mismo INSERT que auth.service.
  //    work_group NO se fija -> queda en su default de BD = 'ADMIN_ALL'.
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
    console.log(`[bootstrap] Admin creado: ${adminEmail} (rol ADMIN, grupo ADMIN_ALL).`);
  }

  // 3) Datos de ejemplo (idempotentes)
  if (doSeed) {
    const { seedExamples } = require('./example-data');
    const { products, customers } = await seedExamples(db, companyId);
    console.log(`[bootstrap] Ejemplos: +${products} productos, +${customers} clientes.`);
  }

  // 3) SUPER_ADMIN de plataforma (crea usuarios y gestiona empresas).
  //    company_id = NULL (no pertenece a una empresa). Misma contraseña que el ADMIN.
  const superEmail = env('BOOTSTRAP_SUPERADMIN_EMAIL', 'superadmin@gdmalmacen.mx').toLowerCase();
  const superR = await db.query('SELECT id FROM users WHERE email = $1', [superEmail]);
  if (superR.rows.length > 0) {
    console.log(`[bootstrap] SUPER_ADMIN ${superEmail} ya existe -> no se recrea.`);
  } else {
    const salt = await bcryptjs.genSalt(10);
    const passwordHash = await bcryptjs.hash(adminPassword, salt);
    await db.query(
      `INSERT INTO users
         (email, password_hash, first_name, last_name, phone, role, company_id, is_active, failed_login_attempts)
       VALUES ($1,$2,'Super','Admin',NULL,'SUPER_ADMIN',NULL, true, 0)`,
      [superEmail, passwordHash]
    );
    console.log(`[bootstrap] SUPER_ADMIN creado: ${superEmail}.`);
  }

  console.log('[bootstrap] OK. Admin de empresa + SUPER_ADMIN listos (misma contraseña).');
}

(async () => {
  const pool = buildPool();
  try {
    await bootstrap(pool);
  } catch (e) {
    // NO fatal: registramos y seguimos, para no impedir el arranque del server.
    console.error('[bootstrap] AVISO (no bloquea el arranque):', (e && e.message) || e);
  } finally {
    await pool.end().catch(() => {});
  }
  process.exit(0);
})();
