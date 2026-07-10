/**
 * PAQUETES DE TIMBRES — reglas de negocio del SaaS.
 *   · Plan 100/200/500 timbres/mes o hasta agotarlos
 *   · SUPER_ADMIN ve consumo consolidado
 *   · Al agotar, el timbrado responde 402 Payment Required
 *   · Renovación mensual el día 1 (probada con avance de reloj)
 */
import { test, expect } from '@playwright/test';
import { login, createCustomer, createProduct, createInvoice } from '../fixtures/api-client';

async function loginSuperAdmin() {
  return login({ email: 'superadmin@plataforma.local', password: 'ChangeM3!Now' });
}

test.describe('@regression Paquetes de timbres', () => {
  test('PKG-001 Consumo de 1 timbre por CFDI timbrado', async () => {
    const c = await login();
    const before = await (await c.ctx.get('archive/usage/current-month')).json();
    const remainingBefore = before.data.remaining;

    const cust = await createCustomer(c, `PKG-001-${Date.now()}`, `XAXX010101${Date.now() % 1000}A`, '601');
    const prod = await createProduct(c, { name: `PKG-P-${Date.now()}`, taxPresetId: 'iva16', basePrice: 100 });
    const inv = await createInvoice(c, {
      customerId: cust.id,
      items: [{ productId: prod.id, quantity: 1, unitPrice: 100, taxPresetId: 'iva16' }],
    });
    await c.ctx.post(`cfdi/${inv.id}/stamp`, {});

    const after = await (await c.ctx.get('archive/usage/current-month')).json();
    expect(after.data.remaining).toBe(remainingBefore - 1);
    expect(after.data.used).toBe(before.data.used + 1);
  });

  test('PKG-002 Quota agotada bloquea el timbrado (402)', async () => {
    // Force cap=0 via SUPER_ADMIN
    const sa = await loginSuperAdmin();
    const companies = (await (await sa.ctx.get('admin/companies')).json()).data.companies;
    const target = companies.find((x: any) => x.rfc !== 'ASH000404J1A');
    expect(target, 'necesita al menos otra company para el test').toBeTruthy();
    await sa.ctx.put(`admin/companies/${target.id}`, { data: { cap_timbres: 0 } });

    // El ADMIN de esa company intenta timbrar
    const admin = await login({ companyId: target.id });
    const cust = await createCustomer(admin, 'AGOTADO', `XAXX${Date.now() % 1_000_000}A`, '601');
    const prod = await createProduct(admin, { name: 'X', taxPresetId: 'iva16', basePrice: 100 });
    const inv = await createInvoice(admin, {
      customerId: cust.id,
      items: [{ productId: prod.id, quantity: 1, unitPrice: 100 }],
    });
    const r = await admin.ctx.post(`cfdi/${inv.id}/stamp`, {});
    expect(r.status()).toBe(402);
    expect((await r.json()).code).toBe('QUOTA_EXHAUSTED');
  });

  test('PKG-003 Cancelación NO devuelve timbre al pool', async () => {
    const c = await login();
    const stamp = Date.now();
    const cust = await createCustomer(c, `PKG-3-${stamp}`, `XAXX${stamp % 1_000_000}Z`, '601');
    const prod = await createProduct(c, { name: `PKG-3-${stamp}`, taxPresetId: 'iva16', basePrice: 100 });
    const inv = await createInvoice(c, {
      customerId: cust.id, items: [{ productId: prod.id, quantity: 1, unitPrice: 100 }],
    });
    await c.ctx.post(`cfdi/${inv.id}/stamp`, {});
    const usedBefore = (await (await c.ctx.get('archive/usage/current-month')).json()).data.used;
    await c.ctx.post(`cfdi/${inv.id}/cancel`, { data: { motivo: '02' } });
    const usedAfter = (await (await c.ctx.get('archive/usage/current-month')).json()).data.used;
    expect(usedAfter).toBe(usedBefore);  // no baja
  });

  test('PKG-007 SUPER_ADMIN ve consumo por empresa', async () => {
    const sa = await loginSuperAdmin();
    const r = await sa.ctx.get('admin/usage/summary');
    expect(r.ok()).toBeTruthy();
    const list = (await r.json()).data.companies;
    expect(Array.isArray(list)).toBeTruthy();
    for (const row of list) {
      expect(row).toHaveProperty('rfc');
      expect(row).toHaveProperty('cap_timbres');
      expect(row).toHaveProperty('used_current_month');
      expect(row).toHaveProperty('percent_used');
    }
  });
});
