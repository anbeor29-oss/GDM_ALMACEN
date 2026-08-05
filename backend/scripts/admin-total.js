#!/usr/bin/env node
/**
 * ADMINISTRADOR DE TODO — deja un correo como SUPER_ADMIN con acceso a todas
 * las empresas del sistema.
 *
 * POR QUÉ EXISTE
 * El bootstrap crea el admin con rol **ADMIN**, que sólo ve SU empresa. El
 * panel de PLATAFORMA —Empresas, Accesos por empresa, planes de timbrado— pide
 * SUPER_ADMIN, así que el usuario que crea el primer arranque no puede
 * administrar el sistema completo. Corregirlo a mano son cinco UPDATE contra
 * tablas distintas, y el que se olvida siempre es `user_companies`: sin esa
 * fila el selector de empresa aparece vacío y el usuario no puede entrar a
 * ninguna, aunque su rol diga SUPER_ADMIN.
 *
 * QUÉ HACE
 *   1. Crea el usuario si no existe (pide contraseña en ese caso).
 *   2. Rol SUPER_ADMIN, grupo ADMIN_ALL, activo, sin bloqueo ni intentos
 *      fallidos pendientes.
 *   3. Lo asocia a TODAS las empresas, con la suya actual como predeterminada.
 *   4. Cambia la contraseña sólo si se le pasa una.
 *
 * Es idempotente: correrlo dos veces deja lo mismo.
 *
 * CÓMO SE USA
 *   node scripts/admin-total.js                          # el de BOOTSTRAP_ADMIN_EMAIL
 *   node scripts/admin-total.js correo@dominio.mx
 *   node scripts/admin-total.js correo@dominio.mx 'NuevaPass1!'
 *
 * En el Shell de Render se corre tal cual: DATABASE_URL ya está en el entorno.
 *
 * JS PLANO A PROPÓSITO: el runtime de Render no instala devDependencies, así
 * que no hay ts-node. Sólo `pg` y `bcryptjs`, que sí son de producción.
 */
const { Pool } = require('pg');
const bcryptjs = require('bcryptjs');

const correo = (process.argv[2] || process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
const passNueva = process.argv[3] || null;

/** Columnas que existen de verdad en `users`.
 *
 * `work_group` y `password_change_required` las agregan migraciones
 * posteriores al esquema base. Este script corre tanto en Render como en una
 * base local que puede ir atrasada, así que se consulta en vez de suponer: un
 * UPDATE a una columna inexistente aborta la transacción entera y dejaría al
 * usuario a medio arreglar. */
async function columnasDeUsers(db) {
  const r = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`
  );
  return new Set(r.rows.map(f => f.column_name));
}

async function main(db) {
  if (!correo) {
    throw new Error('Falta el correo. Úsalo así: node scripts/admin-total.js correo@dominio.mx');
  }

  const cols = await columnasDeUsers(db);
  const tiene = c => cols.has(c);

  // ── 1. El usuario ────────────────────────────────────────────────────────
  let u = (await db.query(
    'SELECT id, email, role, company_id FROM users WHERE LOWER(email) = $1', [correo]
  )).rows[0];

  if (!u) {
    if (!passNueva) {
      throw new Error(
        `El usuario ${correo} no existe. Para crearlo, pasa también la contraseña:\n` +
        `  node scripts/admin-total.js ${correo} 'UnaPass1!'`
      );
    }
    // Se cuelga de la primera empresa que haya; abajo se le asocian todas.
    const primera = (await db.query('SELECT id FROM companies ORDER BY created_at LIMIT 1')).rows[0];
    if (!primera) throw new Error('No hay ninguna empresa en la base. Corre primero el bootstrap.');

    const hash = await bcryptjs.hash(passNueva, 10);
    u = (await db.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, company_id,
                          is_active, failed_login_attempts)
       VALUES ($1, $2, 'Admin', 'General', 'SUPER_ADMIN', $3, true, 0)
       RETURNING id, email, role, company_id`,
      [correo, hash, primera.id]
    )).rows[0];
    console.log(`  usuario creado: ${correo}`);
  }

  // ── 2. Rol y estado ──────────────────────────────────────────────────────
  //
  // El correo se normaliza a minúsculas y sin espacios. NO es cosmético: el
  // login busca con `email = $1`, comparación literal. Si la fila quedó como
  // "Admin@..." o con un espacio al final, teclear el correo bien no encuentra
  // a nadie y la pantalla responde "credenciales incorrectas" — mientras este
  // script, que busca con LOWER(), sí lo encuentra y reporta que todo salió
  // bien. Las dos cosas ciertas a la vez, y el usuario sin poder entrar.
  const sets = [
    'email = LOWER(TRIM(email))',
    `role = 'SUPER_ADMIN'`, 'is_active = true', 'failed_login_attempts = 0',
  ];
  if (tiene('locked_until'))              sets.push('locked_until = NULL');
  if (tiene('deleted_at'))                sets.push('deleted_at = NULL');
  if (tiene('work_group'))                sets.push(`work_group = 'ADMIN_ALL'`);
  if (tiene('password_change_required'))  sets.push('password_change_required = false');

  const params = [u.id];
  if (passNueva) {
    sets.push(`password_hash = $${params.length + 1}`);
    params.push(await bcryptjs.hash(passNueva, 10));
  }
  await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, params);

  // ── 3. Acceso a TODAS las empresas ───────────────────────────────────────
  //
  // Sin estas filas el selector sale vacío y no se puede entrar a ninguna
  // empresa, por más SUPER_ADMIN que diga el rol.
  const empresas = (await db.query(
    'SELECT id, rfc, business_name FROM companies ORDER BY business_name'
  )).rows;

  const hayPuente = (await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'user_companies'`
  )).rowCount > 0;

  if (hayPuente) {
    for (const e of empresas) {
      await db.query(
        `INSERT INTO user_companies (user_id, company_id, work_group, is_default)
         VALUES ($1, $2, 'ADMIN_ALL', false)
         ON CONFLICT (user_id, company_id)
           DO UPDATE SET work_group = 'ADMIN_ALL'`,
        [u.id, e.id]
      );
    }
    // La predeterminada es la que ya traía; si no traía ninguna, la primera.
    // Se limpia antes porque el índice parcial sólo admite un true por usuario.
    const preferida = u.company_id || (empresas[0] && empresas[0].id);
    if (preferida) {
      await db.query('UPDATE user_companies SET is_default = false WHERE user_id = $1', [u.id]);
      await db.query(
        'UPDATE user_companies SET is_default = true WHERE user_id = $1 AND company_id = $2',
        [u.id, preferida]
      );
    }
  } else {
    console.log('  AVISO: no existe user_companies — falta la migración 2026-08-04c.');
  }

  // ── 4. Cómo quedó ────────────────────────────────────────────────────────
  //
  // Se relee de la base en vez de imprimir lo que se tecleó: lo que importa es
  // con qué correo quedó guardado, que es contra lo que el login va a comparar.
  const final = (await db.query('SELECT email FROM users WHERE id = $1', [u.id])).rows[0];
  console.log(`\n  ENTRA CON ESTE CORREO, tal cual: "${final.email}"`);
  console.log(`  rol: SUPER_ADMIN · grupo: ADMIN_ALL · activo, sin bloqueo`);
  console.log(`  contraseña: ${passNueva ? 'CAMBIADA' : 'sin tocar'}`);
  console.log(`  empresas con acceso: ${hayPuente ? empresas.length : 'n/d'}`);
  for (const e of empresas) console.log(`    · ${e.rfc}  ${e.business_name}`);
  console.log('\n  Cierra sesión y vuelve a entrar: el rol viaja en el token y');
  console.log('  el que tengas abierto sigue diciendo ADMIN hasta que caduque.\n');
}

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('Falta DATABASE_URL.');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Render exige TLS y presenta un certificado que la cadena local no valida.
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
      ? false
      : { rejectUnauthorized: false },
  });
  try {
    await main(pool);
  } catch (e) {
    console.error('\n  ' + e.message + '\n');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
