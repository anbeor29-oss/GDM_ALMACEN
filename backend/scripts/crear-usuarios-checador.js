/*
 * crear-usuarios-checador.js — crea (o resetea) las DOS cuentas universales del
 * checador para una empresa:
 *
 *   · Admin del kiosko → grupo RECURSOS_HUMANOS, rol MANAGER: enrola rostros y ve
 *                        el registro. Lo usan 1 o pocas personas.
 *   · Checador         → grupo CHECADOR, rol USER: SÓLO checa (kiosko/campo). No
 *                        ve nómina, ni enrola, ni administra.
 *
 * La CARA identifica a cada trabajador (1:N en el servidor); estas cuentas sólo
 * abren la app en el equipo.
 *
 * DÓNDE SE CORRE: en el **Web Shell de Render** del servicio backend (ahí vive
 * DATABASE_URL). Es idempotente: si las cuentas ya existen, actualiza su
 * contraseña/rol/grupo —sirve para resetear la clave—.
 *
 * Variables (Render → Environment del backend, o inline al correr):
 *   CHECADOR_COMPANY_RFC     RFC de la empresa   (o CHECADOR_COMPANY_ID con el UUID)
 *   CHECADOR_ADMIN_EMAIL     correo del admin del kiosko  (def: kiosko-admin@<rfc>.local)
 *   CHECADOR_ADMIN_PASSWORD  contraseña del admin   (OBLIGATORIA, mínimo 8)
 *   CHECADOR_USER_EMAIL      correo del checador     (def: checador@<rfc>.local)
 *   CHECADOR_USER_PASSWORD   contraseña del checador (OBLIGATORIA, mínimo 8)
 *
 * Ejemplo:
 *   CHECADOR_COMPANY_RFC=AABA020418BW2 \
 *   CHECADOR_ADMIN_PASSWORD='...' CHECADOR_USER_PASSWORD='...' \
 *   node scripts/crear-usuarios-checador.js
 */
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

async function upsertUsuario(pool, { email, password, nombre, role, workGroup, companyId }) {
  const hash = await bcrypt.hash(password, 10);
  const existe = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
  if (existe.rows.length) {
    await pool.query(
      `UPDATE users SET password_hash = $1, role = $2, work_group = $3, company_id = $4,
                        is_active = true, password_change_required = false
        WHERE id = $5`,
      [hash, role, workGroup, companyId, existe.rows[0].id]);
    return { email, workGroup, role, accion: 'actualizado (contraseña reseteada)' };
  }
  await pool.query(
    `INSERT INTO users (email, first_name, last_name, password_hash, role, work_group,
                        company_id, is_active, password_change_required)
     VALUES ($1, $2, '', $3, $4, $5, $6, true, false)`,
    [email.toLowerCase(), nombre, hash, role, workGroup, companyId]);
  return { email, workGroup, role, accion: 'creado' };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL (córrelo en el Web Shell de Render del backend).');
  const pool = new Pool({
    connectionString: url,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  // 1. Resolver la empresa.
  let companyId = process.env.CHECADOR_COMPANY_ID || null;
  let rfc = (process.env.CHECADOR_COMPANY_RFC || '').trim().toUpperCase();
  if (!companyId) {
    if (rfc) {
      const c = await pool.query('SELECT id, business_name FROM companies WHERE UPPER(rfc) = $1 LIMIT 1', [rfc]);
      if (!c.rows.length) throw new Error(`No hay empresa con RFC ${rfc}.`);
      companyId = c.rows[0].id;
      console.log(`Empresa: ${c.rows[0].business_name} (${rfc})`);
    } else {
      const c = await pool.query('SELECT id, rfc, business_name FROM companies ORDER BY created_at LIMIT 5');
      if (c.rows.length === 1) {
        companyId = c.rows[0].id; rfc = c.rows[0].rfc;
        console.log(`Empresa (única): ${c.rows[0].business_name} (${rfc})`);
      } else {
        throw new Error(
          'Hay varias empresas; indica CHECADOR_COMPANY_RFC o CHECADOR_COMPANY_ID. Encontradas: ' +
          c.rows.map((r) => `${r.business_name} [${r.rfc}]`).join(' · '));
      }
    }
  }

  // 2. Contraseñas (obligatorias, sin default inseguro).
  const adminPass = process.env.CHECADOR_ADMIN_PASSWORD || '';
  const userPass = process.env.CHECADOR_USER_PASSWORD || '';
  if (adminPass.length < 8 || userPass.length < 8) {
    throw new Error('Define CHECADOR_ADMIN_PASSWORD y CHECADOR_USER_PASSWORD (mínimo 8 caracteres).');
  }
  const slug = (rfc || 'empresa').toLowerCase();
  const adminEmail = (process.env.CHECADOR_ADMIN_EMAIL || `kiosko-admin@${slug}.local`).toLowerCase();
  const userEmail = (process.env.CHECADOR_USER_EMAIL || `checador@${slug}.local`).toLowerCase();

  // 3. Crear/actualizar las dos cuentas.
  const r1 = await upsertUsuario(pool, {
    email: adminEmail, password: adminPass, nombre: 'Admin del kiosko',
    role: 'MANAGER', workGroup: 'RECURSOS_HUMANOS', companyId });
  const r2 = await upsertUsuario(pool, {
    email: userEmail, password: userPass, nombre: 'Checador',
    role: 'USER', workGroup: 'CHECADOR', companyId });

  console.log('\n== Cuentas del checador ==');
  for (const r of [r1, r2]) {
    console.log(`  ${r.email}  ·  ${r.workGroup}/${r.role}  ·  ${r.accion}`);
  }
  console.log('\nEn la tableta/celular inicia sesión con la cuenta "checador" (solo checa) o');
  console.log('con "kiosko-admin" para enrolar. La cara identifica a cada trabajador.');
  await pool.end();
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
