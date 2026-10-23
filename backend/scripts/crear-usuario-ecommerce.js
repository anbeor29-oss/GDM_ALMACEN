/*
 * crear-usuario-ecommerce.js — crea (o resetea) la cuenta ADMINISTRADORA de la
 * tienda en línea (Comercio Electrónico) de una empresa.
 *
 * QUÉ HACE
 *   · Da de alta UN usuario con grupo de trabajo ECOMMERCE. Ese grupo ve ÚNICAMENTE
 *     el módulo «Comercio Electrónico»: al entrar cae directo en la tienda y NO ve
 *     el resto de NEXO (facturación, nómina, contabilidad, XML, tablero…). El super
 *     admin de la plataforma sigue viendo todo; esto sólo acota a ESTE usuario.
 *   · El usuario vive en una EMPRESA EXISTENTE —la que ya tiene el catálogo y las
 *     existencias— para aprovechar la misma base de datos: la tienda vende esos
 *     productos. No se crea una empresa aparte ni se copian productos.
 *   · Rol USER (no ADMIN): manda en SU TIENDA (todo el módulo de e-commerce), pero
 *     NO administra la empresa —no toca usuarios de NEXO, contrato ni ajustes—. Así
 *     un encargado de la tienda no puede, por accidente, mover la cuenta del contador.
 *   · Deja habilitado el módulo 'ecommerce' en la empresa SIN quitarle los demás
 *     (si la empresa no tenía restricción, se queda «todos»; si tenía una lista, se
 *     le agrega 'ecommerce').
 *
 * DÓNDE SE CORRE: en el **Web Shell de Render** del servicio backend (ahí vive
 * DATABASE_URL). Es idempotente: si la cuenta ya existe, actualiza su
 * contraseña/rol/grupo/empresa —sirve para RESETEAR la clave—.
 *
 * Variables (Render → Environment del backend, o inline al correr):
 *   EC_COMPANY_RFC     RFC de la empresa de la tienda   (o EC_COMPANY_ID con el UUID)
 *                      Si hay una sola empresa, se toma esa y no hace falta.
 *   EC_ADMIN_EMAIL     correo/usuario del admin de la tienda  (def: tienda@<rfc>.local)
 *   EC_ADMIN_PASSWORD  contraseña   (OBLIGATORIA, mínimo 8)
 *   EC_ADMIN_NAME      nombre para mostrar   (def: «Administrador de la tienda»)
 *
 * Ejemplo:
 *   EC_COMPANY_RFC=GHC1707275Y0 EC_ADMIN_EMAIL=tienda@grupohcgm.com \
 *   EC_ADMIN_PASSWORD='MiClaveFuerte2026' node scripts/crear-usuario-ecommerce.js
 */
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL (córrelo en el Web Shell de Render del backend).');
  const pool = new Pool({
    connectionString: url,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  // 1. Resolver la empresa (la que ya tiene el catálogo que venderá la tienda).
  let companyId = process.env.EC_COMPANY_ID || null;
  let rfc = (process.env.EC_COMPANY_RFC || '').trim().toUpperCase();
  let nombreEmpresa = '';
  if (!companyId) {
    if (rfc) {
      const c = await pool.query('SELECT id, business_name FROM companies WHERE UPPER(rfc) = $1 LIMIT 1', [rfc]);
      if (!c.rows.length) throw new Error(`No hay empresa con RFC ${rfc}.`);
      companyId = c.rows[0].id; nombreEmpresa = c.rows[0].business_name;
    } else {
      const c = await pool.query('SELECT id, rfc, business_name FROM companies ORDER BY created_at LIMIT 10');
      if (c.rows.length === 1) {
        companyId = c.rows[0].id; rfc = c.rows[0].rfc; nombreEmpresa = c.rows[0].business_name;
      } else {
        throw new Error(
          'Hay varias empresas; indica EC_COMPANY_RFC o EC_COMPANY_ID. Encontradas: ' +
          c.rows.map((r) => `${r.business_name} [${r.rfc}]`).join(' · '));
      }
    }
  } else {
    const c = await pool.query('SELECT rfc, business_name FROM companies WHERE id = $1 LIMIT 1', [companyId]);
    if (!c.rows.length) throw new Error(`No hay empresa con id ${companyId}.`);
    rfc = c.rows[0].rfc; nombreEmpresa = c.rows[0].business_name;
  }
  console.log(`Empresa de la tienda: ${nombreEmpresa} (${rfc})`);

  // 2. Contraseña (obligatoria, sin default inseguro).
  const pass = process.env.EC_ADMIN_PASSWORD || '';
  if (pass.length < 8) throw new Error('Define EC_ADMIN_PASSWORD (mínimo 8 caracteres).');
  const slug = (rfc || 'empresa').toLowerCase();
  const email = (process.env.EC_ADMIN_EMAIL || `tienda@${slug}.local`).toLowerCase();
  const nombre = process.env.EC_ADMIN_NAME || 'Administrador de la tienda';

  // 3. Habilitar 'ecommerce' en la empresa SIN quitarle los demás módulos.
  //    null = sin restricción (todos los módulos, ya incluye ecommerce) → no se toca.
  //    lista = se le agrega 'ecommerce' deduplicado.
  await pool.query(
    `UPDATE companies
        SET modulos_habilitados = CASE
              WHEN modulos_habilitados IS NULL OR array_length(modulos_habilitados, 1) IS NULL
                THEN modulos_habilitados
              ELSE (SELECT array_agg(DISTINCT m)
                      FROM unnest(modulos_habilitados || ARRAY['ecommerce']) AS m)
            END
      WHERE id = $1`, [companyId]);

  // 4. Crear/actualizar la cuenta de la tienda (grupo ECOMMERCE, rol USER).
  const hash = await bcrypt.hash(pass, 10);
  const existe = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
  let accion;
  if (existe.rows.length) {
    await pool.query(
      `UPDATE users SET password_hash = $1, role = 'USER', work_group = 'ECOMMERCE',
                        company_id = $2, is_active = true, password_change_required = false
        WHERE id = $3`,
      [hash, companyId, existe.rows[0].id]);
    accion = 'actualizado (contraseña reseteada)';
  } else {
    await pool.query(
      `INSERT INTO users (email, first_name, last_name, password_hash, role, work_group,
                          company_id, is_active, password_change_required)
       VALUES ($1, $2, '', $3, 'USER', 'ECOMMERCE', $4, true, false)`,
      [email, nombre, hash, companyId]);
    accion = 'creado';
  }

  console.log('\n== Cuenta de Comercio Electrónico ==');
  console.log(`  Usuario:    ${email}`);
  console.log(`  Grupo/Rol:  ECOMMERCE / USER  (ve SÓLO la tienda)`);
  console.log(`  Empresa:    ${nombreEmpresa} (${rfc})`);
  console.log(`  Estado:     ${accion}`);
  console.log('\nAl iniciar sesión entra directo a «Comercio Electrónico»; no verá el resto de NEXO.');
  console.log('La contraseña NO se imprime: es la que pusiste en EC_ADMIN_PASSWORD.');
  await pool.end();
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
