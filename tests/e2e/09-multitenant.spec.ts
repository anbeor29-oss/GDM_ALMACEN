/**
 * MULTI-TENANT — aislamiento cross-company (OWASP A01: Broken Access Control).
 *
 *  Manager A NO debe poder leer / mutar recursos de Tenant B aunque conozca
 *  los UUIDs. Esto valida el filtro WHERE company_id = $1 a nivel servicio.
 */
import { test, expect } from '@playwright/test';
import { seedSecondTenant } from '../fixtures/tenant-seeder';
import { login, createCustomer, createProduct, createInvoice } from '../fixtures/api-client';
import { USERS, API_URL } from '../fixtures/test-data';

let tenantB: { userEmail: string; userPassword: string; companyId: string };
let resourceFromB: { invoiceId: string; customerId: string; productId: string };

test.beforeAll(async () => {
  tenantB = await seedSecondTenant();
  // Crea recursos en Tenant B desde su propio login.
  // RFC genérico extranjero válido SAT: XAXX010101000 (XAXX + 6 dígitos + 3 chars).
  const cB = await login(tenantB.userEmail, tenantB.userPassword);
  const rfcB = `XAXX${String(Date.now() % 1_000_000).padStart(6, '0')}TB1`;
  const cust = await createCustomer(cB, `TENANT-B-${Date.now()}`, rfcB, '601');
  const prod = await createProduct(cB, { name: `TB-PROD-${Date.now()}`, taxPresetId: 'iva16' });
  const inv = await createInvoice(cB, {
    customerId: cust.id,
    items: [{ productId: prod.id, quantity: 1, unitPrice: 500, taxPresetId: 'iva16' }],
  });
  resourceFromB = { invoiceId: inv.id, customerId: cust.id, productId: prod.id };
});

test.describe('@security @multitenant Aislamiento cross-tenant', () => {
  test('MT-001 Manager A NO ve facturas de Tenant B en /invoices', async () => {
    const cA = await login(USERS.manager.email, USERS.manager.password);
    const list = (await (await cA.ctx.get('invoices?limit=200')).json()).data.invoices;
    const leak = list.find((i: any) => i.id === resourceFromB.invoiceId);
    expect(leak, 'Tenant B leak detectado en GET /invoices').toBeUndefined();
  });

  test('MT-002 GET directo /invoices/{idDeB} desde Manager A → 403/404', async () => {
    const cA = await login();
    const r = await cA.ctx.get(`invoices/${resourceFromB.invoiceId}`);
    expect([403, 404]).toContain(r.status());
  });

  test('MT-003 GET /invoices/{idDeB}/balance desde Manager A → 403/404', async () => {
    const cA = await login();
    const r = await cA.ctx.get(`invoices/${resourceFromB.invoiceId}/balance`);
    expect([403, 404]).toContain(r.status());
  });

  test('MT-004 Manager A NO puede generar PDF de la factura de B', async () => {
    const cA = await login();
    const r = await cA.ctx.get(`cfdi/${resourceFromB.invoiceId}/pdf`);
    expect([403, 404]).toContain(r.status());
  });

  test('MT-005 Manager A NO puede crear NC referenciando factura de B', async () => {
    const cA = await login();
    const r = await cA.ctx.post('credit-notes', {
      data: { customerId: resourceFromB.customerId, invoiceId: resourceFromB.invoiceId,
              tipoRelacion: '01', amount: 100 },
    });
    expect([400, 403, 404]).toContain(r.status());
  });

  test('MT-006 Dashboard del Manager A NO incluye totales de B', async () => {
    const cB = await login(tenantB.userEmail, tenantB.userPassword);
    const cA = await login();
    const dB = (await (await cB.ctx.get('invoices/dashboard/summary')).json()).data;
    const dA = (await (await cA.ctx.get('invoices/dashboard/summary')).json()).data;
    // Una empresa no debe ver el facturado de la otra
    // (los totales pueden coincidir por casualidad si ambas tienen $0,
    // pero el conteo de facturas debe ser independiente).
    expect(Number(dA.facturas)).not.toBe(Number(dB.facturas));
  });
});
