/**
 * enderezar-sueldos-de-nomina — arregla los expedientes con el sueldo invertido.
 *
 * QUÉ PASÓ
 * El importador mapeaba `SalarioBaseCotApor` al salario diario, y eso está mal
 * por definición: el salario base de cotización ES el salario ya integrado que
 * se le reporta al IMSS. Los expedientes que entraron con ese mapeo quedaron con
 * un integrado MENOR que el diario, que es imposible — el factor de integración
 * nunca baja de 1.
 *
 * QUÉ HACE
 * Intercambia los dos importes SÓLO en los expedientes donde el integrado es
 * menor que el diario. A los que están bien no los toca: si alguien ya corrigió
 * uno a mano, el script no debe deshacérselo.
 *
 * ES SIMULACRO POR OMISIÓN
 * Sin --aplicar sólo enseña qué cambiaría. Estos dos números mueven las cuotas
 * del IMSS de toda la plantilla.
 *
 * USO (shell de Render):
 *   node scripts/enderezar-sueldos-de-nomina.js
 *   node scripts/enderezar-sueldos-de-nomina.js --aplicar
 */

const { Pool } = require('pg');
const aplicar = process.argv.includes('--aplicar');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /render\.com|amazonaws|neon\.tech/.test(process.env.DATABASE_URL || '')
    ? { rejectUnauthorized: false } : undefined,
});

(async () => {
  const { rows } = await pool.query(
    `SELECT e.id, e.num_empleado, e.salario_diario, e.salario_diario_integrado,
            TRIM(e.nombre || ' ' || e.apellido_pat) AS quien, c.business_name AS empresa
       FROM nomina_empleados e
       JOIN companies c ON c.id = e.company_id
      WHERE e.deleted_at IS NULL
        AND e.salario_diario_integrado > 0
        AND e.salario_diario > e.salario_diario_integrado
      ORDER BY c.business_name, e.num_empleado`
  );

  if (rows.length === 0) {
    console.log('\nNingún expediente tiene el integrado por debajo del diario. Nada que enderezar.\n');
    await pool.end();
    return;
  }

  console.log(`\n${rows.length} expediente(s) con los sueldos invertidos:\n`);
  for (const r of rows) {
    console.log(
      `  ${r.num_empleado.padEnd(6)} ${String(r.quien).slice(0, 30).padEnd(32)} ` +
      `diario ${String(r.salario_diario).padStart(9)} ↔ SDI ${String(r.salario_diario_integrado).padStart(9)}`
    );
  }

  if (!aplicar) {
    console.log('\nSIMULACRO. Vuelve a correrlo con --aplicar para intercambiarlos.\n');
    await pool.end();
    return;
  }

  /* El intercambio en una sola sentencia: leer y escribir por separado dejaría
   * los expedientes a medias si algo falla en medio. */
  const r = await pool.query(
    `UPDATE nomina_empleados
        SET salario_diario = salario_diario_integrado,
            salario_diario_integrado = salario_diario,
            updated_at = NOW()
      WHERE id = ANY($1::uuid[])`,
    [rows.map((x) => x.id)]
  );
  console.log(`\n${r.rowCount} expediente(s) enderezados.`);
  console.log('Vuelve a correr la prenómina: las cuotas del IMSS cambian con el SDI.\n');
  await pool.end();
})().catch((e) => {
  console.error('\nFalló:', e.message, '\n');
  process.exit(1);
});
