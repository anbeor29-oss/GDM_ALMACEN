/**
 * tenant-seeder.ts — crea una segunda empresa + usuario en BD para tests de
 * aislamiento multi-tenant. Idempotente: si ya existen los recicla.
 *
 * Importante: las pruebas NUNCA deben asumir que un usuario tiene acceso a
 * facturas/customers/products de otra companyId. Esta utilidad permite
 * verificar IDOR-cross-tenant en condiciones reales.
 */
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

interface TenantHandle {
  companyId: string;
  userEmail: string;
  userPassword: string;
}

const TENANT_B = {
  rfc: 'TST010101TT2',
  business_name: 'QA TENANT B SA DE CV',
  email: 'qa-tenant-b@test.local',
  password: 'admin123',
};

export async function seedSecondTenant(): Promise<TenantHandle> {
  const c = new Client({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'cfdi_erp',
  });
  await c.connect();

  try {
    // 1) Compañía B
    const existing = await c.query(
      'SELECT id FROM companies WHERE rfc = $1 LIMIT 1',
      [TENANT_B.rfc]
    );
    let companyId: string;
    if (existing.rowCount! > 0) {
      companyId = existing.rows[0].id;
    } else {
      const r = await c.query(
        `INSERT INTO companies (rfc, business_name, fiscal_regime, postal_code, is_active)
         VALUES ($1, $2, '601', '64000', true)
         RETURNING id`,
        [TENANT_B.rfc, TENANT_B.business_name]
      );
      companyId = r.rows[0].id;
    }

    // 2) Usuario admin de la compañía B
    const userExists = await c.query(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      [TENANT_B.email]
    );
    if (userExists.rowCount === 0) {
      const hash = await bcrypt.hash(TENANT_B.password, 10);
      await c.query(
        `INSERT INTO users (email, first_name, last_name, password_hash, role, company_id, is_active)
         VALUES ($1, 'QA', 'Tenant B', $2, 'MANAGER', $3, true)`,
        [TENANT_B.email, hash, companyId]
      );
    }
    return { companyId, userEmail: TENANT_B.email, userPassword: TENANT_B.password };
  } finally {
    await c.end();
  }
}
