/**
 * SMOKE TESTS — gate de despliegue. Si esto falla, no se promueve a UAT/Prod.
 * Cobertura: levantamiento de servicios + login + lectura básica de catálogos.
 */
import { test, expect } from '@playwright/test';
import { login } from '../fixtures/api-client';

test.describe('@smoke Salud del sistema', () => {
  test('SMK-001 Health endpoint del backend responde 200', async ({ request }) => {
    const r = await request.get('http://localhost:3000/health');
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('OK');
  });

  test('SMK-002 Frontend Vite sirve el index', async ({ page }) => {
    const resp = await page.goto('/');
    expect(resp?.status()).toBeLessThan(400);
    await expect(page).toHaveTitle(/CFDI|ERP|Vite|Facturaci/i);
  });

  test('SMK-003 Login válido con manager@demo.com', async () => {
    const c = await login();
    expect(c.token.length).toBeGreaterThan(100);
    expect(c.companyId).toBeTruthy();
  });

  test('SMK-004 GET /invoices regresa pagination + balance', async () => {
    const c = await login();
    const r = await c.ctx.get('invoices?limit=3');
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.data.invoices.length).toBeGreaterThan(0);
    // Contrato: cada invoice trae balance/paid_total/credited_total enriquecidos
    const first = body.data.invoices[0];
    expect(first).toHaveProperty('balance');
    expect(first).toHaveProperty('paid_total');
    expect(first).toHaveProperty('credited_total');
  });

  test('SMK-005 Dashboard summary expone los 6 KPIs', async () => {
    const c = await login();
    const r = await c.ctx.get('invoices/dashboard/summary');
    expect(r.ok()).toBeTruthy();
    const d = (await r.json()).data;
    for (const k of ['facturas', 'total_facturado', 'total_cobrado',
                     'total_acreditado', 'saldo_por_cobrar', 'facturas_con_saldo']) {
      expect(d, `KPI '${k}' ausente`).toHaveProperty(k);
    }
  });
});
