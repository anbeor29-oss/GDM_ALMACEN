/**
 * PERFORMANCE — SLA mínimos para el stack actual.
 *  · Login < 800 ms
 *  · Listado de facturas < 600 ms
 *  · Dashboard summary < 400 ms (SQL agregado)
 *  · PDF de factura < 1500 ms y < 100 KB
 *
 * Si se requiere k6/jmeter, este suite es la entrada (smoke perf); para load
 * usar el script tests/k6/load.js (referencia en docs/estrategia.md).
 */
import { test, expect } from '@playwright/test';
import { USERS, API_URL } from '../fixtures/test-data';
import { login } from '../fixtures/api-client';

const SLA = {
  login: 800,
  list: 600,
  dashboard: 400,
  pdf: 1500,
  pdfMaxBytes: 100_000,
};

test.describe('@performance Latencia y tamaños', () => {
  test('PERF-001 Login < 800 ms', async ({ request }) => {
    const t0 = Date.now();
    const r = await request.post(`${API_URL}/auth/login`, { data: USERS.manager });
    const ms = Date.now() - t0;
    expect(r.ok()).toBeTruthy();
    expect(ms, `login tardó ${ms}ms`).toBeLessThan(SLA.login);
  });

  test('PERF-002 GET /invoices (10 filas) < 600 ms', async () => {
    const c = await login();
    const t0 = Date.now();
    const r = await c.ctx.get('invoices?limit=10');
    const ms = Date.now() - t0;
    expect(r.ok()).toBeTruthy();
    expect(ms).toBeLessThan(SLA.list);
  });

  test('PERF-003 Dashboard summary < 400 ms', async () => {
    const c = await login();
    const t0 = Date.now();
    const r = await c.ctx.get('invoices/dashboard/summary');
    const ms = Date.now() - t0;
    expect(r.ok()).toBeTruthy();
    expect(ms).toBeLessThan(SLA.dashboard);
  });

  test('PERF-004 PDF de factura < 1500 ms y < 100 KB', async () => {
    const c = await login();
    const list = (await (await c.ctx.get('invoices?limit=1')).json()).data.invoices;
    if (!list.length) test.skip(true, 'sin facturas');
    const t0 = Date.now();
    const r = await c.ctx.get(`cfdi/${list[0].id}/pdf`);
    const ms = Date.now() - t0;
    expect(r.ok()).toBeTruthy();
    const buf = await r.body();
    expect(ms, `PDF tardó ${ms}ms`).toBeLessThan(SLA.pdf);
    expect(buf.length, `PDF ${buf.length} bytes`).toBeLessThan(SLA.pdfMaxBytes);
  });
});
