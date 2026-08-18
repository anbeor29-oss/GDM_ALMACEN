/**
 * vaciar-nomina-de-usuario — deja la nómina de una empresa como recién nacida.
 *
 * PARA QUÉ
 * Estamos en desarrollo y las primeras cargas dejan expedientes a medias: un
 * nombre mal partido, un salario que no era, dos altas del mismo. Corregirlos a
 * mano toma más que volver a cargarlos con el importador ya arreglado.
 *
 * QUÉ BORRA, EXACTAMENTE
 * Todo lo que cuelga de la nómina de las empresas del usuario indicado:
 * expedientes, créditos con sus abonos, catálogos de puestos y departamentos y
 * los periodos que no estén cerrados.
 *
 * QUÉ NO TOCA
 *   · Los parámetros patronales (registro patronal, prima de riesgo, factores):
 *     se capturan una vez y volver a pedirlos sería trabajo repetido sin razón.
 *   · Los periodos CERRADOS: representan nómina que ya se pagó.
 *   · Los recibos de nómina importados (nomina_imports): son los XML que el SAT
 *     ya timbró y no son "datos de prueba" — de hecho son de donde se vuelve a
 *     cargar la plantilla.
 *   · NADA de facturación, clientes, inventario ni tesorería.
 *
 * ES SIMULACRO POR OMISIÓN
 * Sin --aplicar sólo cuenta lo que borraría. Y va todo en una transacción: o se
 * borra completo o no se borra nada, porque una nómina a medio vaciar es peor
 * que una nómina sucia.
 *
 * USO (shell de Render):
 *   node scripts/vaciar-nomina-de-usuario.js dany@123.com
 *   node scripts/vaciar-nomina-de-usuario.js dany@123.com --aplicar
 */

const { Pool } = require('pg');

const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const correo = args.find((a) => !a.startsWith('--'));

if (!correo) {
  console.error('\nFalta el correo del usuario.');
  console.error('  node scripts/vaciar-nomina-de-usuario.js dany@123.com [--aplicar]\n');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /render\.com|amazonaws|neon\.tech/.test(process.env.DATABASE_URL || '')
    ? { rejectUnauthorized: false }
    : undefined,
});

(async () => {
  const { rows: usuarios } = await pool.query(
    `SELECT id, email, company_id FROM users WHERE LOWER(TRIM(email)) = LOWER($1)`,
    [correo.trim()]
  );
  if (usuarios.length === 0) {
    console.error(`\nNo hay ningún usuario con el correo ${correo}.\n`);
    const { rows } = await pool.query(
      `SELECT email FROM users WHERE deleted_at IS NULL ORDER BY email LIMIT 20`
    );
    console.error('Usuarios en la base:');
    for (const u of rows) console.error(`  · ${u.email}`);
    console.error('');
    process.exit(1);
  }

  /* Un usuario puede alcanzar varias empresas (tabla user_companies de la
   * migración multiempresa). Se juntan todas para no dejar la mitad. */
  let empresas = usuarios.map((u) => u.company_id).filter(Boolean);
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT company_id FROM user_companies WHERE user_id = ANY($1::uuid[])`,
      [usuarios.map((u) => u.id)]
    );
    empresas = empresas.concat(rows.map((r) => r.company_id));
  } catch { /* la tabla puede no existir en una base que no corrió esa migración */ }

  empresas = [...new Set(empresas.filter(Boolean))];
  if (empresas.length === 0) {
    console.error(`\n${correo} no tiene ninguna empresa asignada. No hay nada que vaciar.\n`);
    process.exit(1);
  }

  const { rows: nombres } = await pool.query(
    `SELECT id, rfc, business_name FROM companies WHERE id = ANY($1::uuid[])`,
    [empresas]
  );
  console.log(`\nUsuario: ${correo}`);
  console.log('Empresas alcanzadas:');
  for (const c of nombres) console.log(`  · ${c.business_name} [${c.rfc}]`);

  const contar = async (sql, etiqueta) => {
    const { rows } = await pool.query(sql, [empresas]);
    const n = Number(rows[0].n);
    console.log(`  ${String(n).padStart(5)}  ${etiqueta}`);
    return n;
  };

  console.log('\nSe borraría:');
  await contar(
    `SELECT COUNT(*) n FROM nomina_empleados WHERE company_id = ANY($1::uuid[])`,
    'expedientes de trabajadores');
  await contar(
    `SELECT COUNT(*) n FROM nomina_creditos WHERE company_id = ANY($1::uuid[])`,
    'créditos (préstamos y FONACOT), con sus abonos');
  await contar(
    `SELECT COUNT(*) n FROM nomina_puestos WHERE company_id = ANY($1::uuid[])`,
    'puestos del catálogo');
  await contar(
    `SELECT COUNT(*) n FROM nomina_departamentos WHERE company_id = ANY($1::uuid[])`,
    'departamentos del catálogo');
  await contar(
    `SELECT COUNT(*) n FROM nomina_periodos WHERE company_id = ANY($1::uuid[]) AND estatus <> 'CERRADO'`,
    'periodos no cerrados');

  const cerrados = await contar(
    `SELECT COUNT(*) n FROM nomina_periodos WHERE company_id = ANY($1::uuid[]) AND estatus = 'CERRADO'`,
    'periodos CERRADOS — estos NO se tocan');

  console.log('\nNo se toca: parámetros patronales, recibos de nómina importados,');
  console.log('facturación, clientes, inventario ni tesorería.');

  if (!aplicar) {
    console.log('\nSIMULACRO. Vuelve a correrlo con --aplicar para hacerlo de verdad.\n');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    /* Los abonos y los créditos caen por ON DELETE CASCADE al borrar el
     * expediente, pero se borran explícitamente para poder contarlos y para no
     * depender de que la cascada siga ahí mañana. */
    await client.query(
      `DELETE FROM nomina_credito_abonos WHERE credito_id IN
         (SELECT id FROM nomina_creditos WHERE company_id = ANY($1::uuid[]))`, [empresas]);
    await client.query(`DELETE FROM nomina_creditos    WHERE company_id = ANY($1::uuid[])`, [empresas]);
    await client.query(`DELETE FROM nomina_empleados   WHERE company_id = ANY($1::uuid[])`, [empresas]);
    await client.query(`DELETE FROM nomina_puestos     WHERE company_id = ANY($1::uuid[])`, [empresas]);
    await client.query(`DELETE FROM nomina_departamentos WHERE company_id = ANY($1::uuid[])`, [empresas]);
    await client.query(
      `DELETE FROM nomina_periodos WHERE company_id = ANY($1::uuid[]) AND estatus <> 'CERRADO'`,
      [empresas]);
    await client.query('COMMIT');
    console.log('\nListo: la nómina quedó vacía.');
    if (cerrados > 0) {
      console.log(`Se respetaron ${cerrados} periodo(s) cerrados.`);
    }
    console.log('Vuelve a cargar la plantilla desde los recibos con el importador.\n');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => {
  console.error('\nFalló y no se borró nada:', e.message, '\n');
  process.exit(1);
});
