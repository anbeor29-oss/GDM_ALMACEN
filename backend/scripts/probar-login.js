#!/usr/bin/env node
/**
 * PROBAR LOGIN — dice en qué punto exacto falla el acceso.
 *
 * POR QUÉ EXISTE
 * "No me deja entrar" son al menos cuatro fallas distintas —contraseña que no
 * corresponde al hash, cuenta bloqueada por intentos fallidos, ruta equivocada,
 * o entra bien pero con el rol que no es— y desde la pantalla de login las
 * cuatro se ven igual. Este script las separa: primero compara contra el hash
 * guardado, después hace el POST de verdad al backend, y al final imprime el
 * rol que viene en la respuesta.
 *
 *   node scripts/probar-login.js admin@gdmalmacen.mx 'LaContraseña'
 *
 * En el Shell de Render corre tal cual: DATABASE_URL y PORT ya están.
 */
const { Pool } = require('pg');
const bcryptjs = require('bcryptjs');

const correo = (process.argv[2] || '').trim();
const pass = process.argv[3];

/* El backend escucha en localhost dentro del propio contenedor: así se prueba
 * el mismo proceso que atiende al navegador, sin meter CORS ni la red de por
 * medio. Si se corre fuera de Render, se le puede pasar la URL completa. */
const BASE = process.env.PROBAR_URL || `http://127.0.0.1:${process.env.PORT || 3001}`;

async function main() {
  if (!correo || !pass) {
    throw new Error("Úsalo así: node scripts/probar-login.js correo@dominio.mx 'LaContraseña'");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '')
      ? false : { rejectUnauthorized: false },
  });

  // ── 1. ¿Existe el usuario, y con qué correo EXACTO? ──────────────────────
  //
  // El login busca con `email = $1`, comparación exacta: si en la base quedó
  // con una mayúscula o un espacio al final, teclear el correo "bien" no lo
  // encuentra y el mensaje que sale es el de contraseña incorrecta.
  const r = await pool.query(
    `SELECT id, email, role, is_active, locked_until, failed_login_attempts,
            password_hash, deleted_at
       FROM users WHERE LOWER(TRIM(email)) = LOWER($1)`, [correo]);

  if (r.rows.length === 0) {
    console.log(`\n  NO EXISTE ningún usuario con el correo ${correo}.`);
    const otros = await pool.query('SELECT email, role FROM users ORDER BY email');
    console.log('  Los que hay en ESTA base:');
    for (const u of otros.rows) console.log(`    · ${u.email}  (${u.role})`);
    await pool.end();
    return;
  }

  const u = r.rows[0];
  console.log(`\n  1) Usuario encontrado`);
  console.log(`     correo guardado: "${u.email}"${u.email !== correo ? '   <-- NO es igual al que tecleaste' : ''}`);
  console.log(`     rol: ${u.role} · activo: ${u.is_active} · borrado: ${u.deleted_at ? 'SÍ' : 'no'}`);
  console.log(`     intentos fallidos: ${u.failed_login_attempts} · bloqueado hasta: ${u.locked_until || 'no'}`);

  // ── 2. ¿La contraseña corresponde al hash guardado? ──────────────────────
  const coincide = await bcryptjs.compare(pass, u.password_hash);
  console.log(`\n  2) La contraseña ${coincide ? 'SÍ' : 'NO'} corresponde al hash guardado`);
  console.log(`     (hash tipo ${String(u.password_hash).slice(0, 4)}, ${String(u.password_hash).length} caracteres)`);

  await pool.end();

  // ── 3. El login de verdad, contra el backend que atiende al navegador ────
  console.log(`\n  3) POST ${BASE}/api/v1/auth/login`);
  try {
    const resp = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: correo, password: pass }),
    });
    const txt = await resp.text();
    console.log(`     status ${resp.status}`);
    let j = null;
    try { j = JSON.parse(txt); } catch { console.log(`     cuerpo: ${txt.slice(0, 200)}`); }
    if (j && j.user) {
      console.log(`     ENTRA. rol=${j.user.role} · grupo=${j.user.workGroup} · empresa=${j.user.companyId}`);
      console.log(`     cambio de contraseña forzado: ${j.user.passwordChangeRequired}`);
    } else if (j) {
      console.log(`     mensaje: ${j.message}`);
    }
  } catch (e) {
    console.log(`     no se pudo conectar: ${e.message}`);
    console.log(`     (si corres esto fuera de Render, pasa PROBAR_URL con la URL pública)`);
  }
  console.log('');
}

main().catch(e => { console.error('\n  ' + e.message + '\n'); process.exitCode = 1; });
