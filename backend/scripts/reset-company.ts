/**
 * Reset operacional de una empresa: borra facturas, pagos, notas de crédito,
 * clientes y productos, conservando la empresa y sus usuarios.
 *
 * Uso:
 *   npm run reset:company -- EKU9003173C9
 *
 * O directo:
 *   ts-node -r dotenv/config scripts/reset-company.ts EKU9003173C9
 *
 * El script:
 *   1. Confirma que la empresa existe.
 *   2. Muestra un resumen del inventario que se va a borrar.
 *   3. Pide confirmación explícita antes de ejecutar (--yes salta el prompt).
 *   4. Borra en el orden correcto para respetar FKs.
 *   5. Deja la empresa "en cero" listándose las cuentas afectadas.
 *
 * NO toca:
 *   - companies (registro maestro)
 *   - users (login sigue funcionando)
 *   - stamp_packages / plan (SUPER_ADMIN)
 *   - sat_catalogs / clave_prod_serv (catálogos SAT globales)
 */

import { Pool } from 'pg';
import readline from 'readline';

const args = process.argv.slice(2);
const rfc = args.find((a) => !a.startsWith('--'))?.toUpperCase();
const forceYes = args.includes('--yes');

if (!rfc) {
  console.error('❌ Uso: npm run reset:company -- <RFC>');
  console.error('   ej. npm run reset:company -- EKU9003173C9');
  process.exit(1);
}

// Conexión: preferimos DATABASE_URL (Render) sobre DB_* discretas (local).
function buildPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (url) {
    return new Pool({
      connectionString: url,
      // Render Postgres requiere SSL. Sin rejectUnauthorized el cert self-signed pasa.
      ssl: url.includes('render.com') || url.includes('.oregon-postgres') ? { rejectUnauthorized: false } : undefined,
    });
  }
  return new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'app_user',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'cfdi_erp',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
}

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

async function main() {
  const pool = buildPool();
  const client = await pool.connect();
  try {
    // 1) Verificar empresa
    const compR = await client.query<{ id: string; business_name: string; rfc: string }>(
      `SELECT id, business_name, rfc FROM companies WHERE rfc = $1`,
      [rfc]
    );
    if (compR.rows.length === 0) {
      console.error(`❌ No existe empresa con RFC ${rfc}`);
      process.exit(1);
    }
    const company = compR.rows[0];
    console.log(`\n📋 Empresa: ${company.business_name} (${company.rfc})`);
    console.log(`   ID: ${company.id}`);

    // 2) Inventario a borrar
    const stats = await client.query<any>(
      `SELECT
         (SELECT COUNT(*)::int FROM invoices WHERE company_id = $1)      AS invoices,
         (SELECT COUNT(*)::int FROM invoice_items ii
            JOIN invoices i ON i.id = ii.invoice_id
           WHERE i.company_id = $1)                                       AS invoice_items,
         (SELECT COUNT(*)::int FROM payments WHERE company_id = $1)      AS payments,
         (SELECT COUNT(*)::int FROM credit_notes WHERE company_id = $1)  AS credit_notes,
         (SELECT COUNT(*)::int FROM customers WHERE company_id = $1)     AS customers,
         (SELECT COUNT(*)::int FROM products WHERE company_id = $1)      AS products,
         (SELECT COUNT(*)::int FROM users WHERE company_id = $1)         AS users`,
      [company.id]
    );
    const s = stats.rows[0];
    console.log('\n📊 Inventario actual:');
    console.log(`   ${s.invoices}\tfacturas`);
    console.log(`   ${s.invoice_items}\titems`);
    console.log(`   ${s.payments}\tpagos`);
    console.log(`   ${s.credit_notes}\tnotas de crédito`);
    console.log(`   ${s.customers}\tclientes`);
    console.log(`   ${s.products}\tproductos`);
    console.log(`\n   ✅ Se conservarán: empresa (1) + usuarios (${s.users}).\n`);

    // 3) Confirmar
    if (!forceYes) {
      const ans = (await ask(
        `⚠  Esta acción es IRREVERSIBLE. Escribe el RFC "${company.rfc}" para confirmar: `
      )).trim().toUpperCase();
      if (ans !== company.rfc) {
        console.log('Abortado.');
        process.exit(0);
      }
    }

    // 4) Borrar en orden correcto (FKs)
    console.log('\n🧹 Borrando…');
    await client.query('BEGIN');
    try {
      // Historial de timbres (referencia facturas) — best-effort si la tabla existe
      await client.query(`DELETE FROM pac_stamps WHERE company_id = $1`, [company.id]).catch(() => {});
      // XML imports también apunta a empresa
      await client.query(`DELETE FROM xml_imports WHERE company_id = $1`, [company.id]).catch(() => {});
      // Complementos de pago y NC (hijos de invoice via FK)
      await client.query(`DELETE FROM payments WHERE company_id = $1`, [company.id]);
      await client.query(`DELETE FROM credit_notes WHERE company_id = $1`, [company.id]);
      // Items → invoices
      await client.query(
        `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id = $1)`,
        [company.id]
      );
      await client.query(`DELETE FROM invoices WHERE company_id = $1`, [company.id]);
      // Suppliers (si existe) — apunta a empresa
      await client.query(`DELETE FROM suppliers WHERE company_id = $1`, [company.id]).catch(() => {});
      // Catálogos operativos
      await client.query(`DELETE FROM customers WHERE company_id = $1`, [company.id]);
      await client.query(`DELETE FROM products WHERE company_id = $1`, [company.id]);
      // Contadores de folio en la empresa vuelven a 0
      await client.query(
        `UPDATE companies
            SET next_invoice_folio = 1,
                updated_at = NOW()
          WHERE id = $1`,
        [company.id]
      ).catch(() => {}); // por si la columna se llama diferente
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }

    // 5) Verificar
    const after = await client.query<any>(
      `SELECT
         (SELECT COUNT(*)::int FROM invoices WHERE company_id = $1) AS invoices,
         (SELECT COUNT(*)::int FROM payments WHERE company_id = $1) AS payments,
         (SELECT COUNT(*)::int FROM credit_notes WHERE company_id = $1) AS credit_notes,
         (SELECT COUNT(*)::int FROM customers WHERE company_id = $1) AS customers,
         (SELECT COUNT(*)::int FROM products WHERE company_id = $1) AS products`,
      [company.id]
    );
    console.log(`\n✅ Reset OK. Empresa ahora tiene: ${JSON.stringify(after.rows[0])}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
