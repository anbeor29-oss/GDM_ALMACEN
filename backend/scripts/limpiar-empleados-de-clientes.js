/**
 * limpiar-empleados-de-clientes — deshace lo que metió el bug del lector de XML.
 *
 * QUÉ PASÓ
 * El lector preseleccionaba "receptor → cliente" para cualquier XML. En un
 * recibo de nómina el receptor es el TRABAJADOR, así que al cargar los recibos
 * de la plantilla se dio de alta a los empleados en el catálogo de clientes.
 * El bug ya está cerrado; esto limpia lo que alcanzó a entrar.
 *
 * NO ADIVINA QUIÉN ES EMPLEADO
 * Un RFC de persona física en el catálogo de clientes puede ser un cliente de
 * verdad. Aquí sólo se señala a quien tiene PRUEBA de serlo:
 *
 *   · aparece como receptor de un CFDI de nómina que emitió esta empresa
 *     (tabla nomina_imports), o
 *   · su RFC se pasa a mano como argumento.
 *
 * NO BORRA A QUIEN TENGA MOVIMIENTOS
 * Si a ese "cliente" se le facturó algo, se le hizo una nota de crédito o se le
 * registró un pago, no se toca: borrarlo dejaría comprobantes apuntando al
 * vacío. Se reporta para que alguien lo mire.
 *
 * ES SIMULACRO POR OMISIÓN
 * Sin --aplicar sólo dice qué haría. Borrar registros de una base de producción
 * no debe ser el comportamiento por omisión de nada.
 *
 * USO (shell de Render):
 *   node scripts/limpiar-empleados-de-clientes.js
 *   node scripts/limpiar-empleados-de-clientes.js --aplicar
 *   node scripts/limpiar-empleados-de-clientes.js EASM681010PY3 --aplicar
 */

const { Pool } = require('pg');

const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const rfcsAMano = args
  .filter((a) => !a.startsWith('--'))
  .map((a) => a.toUpperCase().trim())
  .filter(Boolean);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /render\.com|amazonaws|neon\.tech/.test(process.env.DATABASE_URL || '')
    ? { rejectUnauthorized: false }
    : undefined,
});

(async () => {
  /* Candidatos: clientes cuyo RFC es receptor de un recibo de nómina de la
   * MISMA empresa. La condición del company_id importa — el mismo RFC puede ser
   * empleado de una empresa y cliente de otra dentro de la plataforma. */
  const { rows: candidatos } = await pool.query(
    `SELECT c.id, c.company_id, c.rfc, c.business_name, c.party_type,
            co.business_name AS empresa,
            (SELECT COUNT(*) FROM nomina_imports n
              WHERE n.company_id = c.company_id AND UPPER(n.rfc_receptor) = UPPER(c.rfc)) AS recibos,
            (SELECT COUNT(*) FROM invoices i      WHERE i.customer_id = c.id) AS facturas,
            (SELECT COUNT(*) FROM credit_notes cn WHERE cn.customer_id = c.id) AS notas,
            (SELECT COUNT(*) FROM payments p      WHERE p.customer_id = c.id) AS pagos
       FROM customers c
       JOIN companies co ON co.id = c.company_id
      WHERE c.deleted_at IS NULL
        AND (
          EXISTS (SELECT 1 FROM nomina_imports n
                   WHERE n.company_id = c.company_id
                     AND UPPER(n.rfc_receptor) = UPPER(c.rfc))
          OR ($1::text[] IS NOT NULL AND UPPER(c.rfc) = ANY($1::text[]))
        )
      ORDER BY co.business_name, c.business_name`,
    [rfcsAMano.length ? rfcsAMano : null]
  );

  if (candidatos.length === 0) {
    console.log('\nNo hay ningún cliente que sea receptor de un recibo de nómina.');
    console.log('Si sabes el RFC, pásalo como argumento:');
    console.log('  node scripts/limpiar-empleados-de-clientes.js EASM681010PY3\n');
    await pool.end();
    return;
  }

  const conMovimientos = [];
  const limpios = [];
  for (const c of candidatos) {
    const mov = Number(c.facturas) + Number(c.notas) + Number(c.pagos);
    (mov > 0 ? conMovimientos : limpios).push({ ...c, mov });
  }

  console.log(`\n${candidatos.length} coincidencia(s):\n`);
  for (const c of limpios) {
    console.log(
      `  · ${c.business_name}  [${c.rfc}]  ${c.empresa}` +
      (Number(c.recibos) > 0 ? `  — ${c.recibos} recibo(s) de nómina a su nombre` : '  — señalado a mano')
    );
  }
  for (const c of conMovimientos) {
    console.log(
      `  ! ${c.business_name}  [${c.rfc}]  ${c.empresa}\n` +
      `      NO se toca: tiene ${c.facturas} factura(s), ${c.notas} nota(s) y ${c.pagos} pago(s).\n` +
      `      Si de verdad es un empleado, esos comprobantes hay que revisarlos antes.`
    );
  }

  if (!aplicar) {
    console.log(
      `\nSIMULACRO. Se borrarían ${limpios.length} de ${candidatos.length}.\n` +
      'Vuelve a correrlo con --aplicar para hacerlo de verdad.\n'
    );
    await pool.end();
    return;
  }

  if (limpios.length === 0) {
    console.log('\nNo hay nada que borrar sin riesgo.\n');
    await pool.end();
    return;
  }

  /* Borrado suave: la fila queda con deleted_at y desaparece de las pantallas.
   * Un DELETE de verdad rompería cualquier referencia que se nos haya pasado. */
  const r = await pool.query(
    `UPDATE customers SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [limpios.map((c) => c.id)]
  );
  console.log(`\n${r.rowCount} cliente(s) retirados del catálogo.`);
  console.log('Quedan marcados como borrados, no se eliminaron físicamente.\n');

  await pool.end();
})().catch((e) => {
  console.error('\nFalló:', e.message, '\n');
  process.exit(1);
});
