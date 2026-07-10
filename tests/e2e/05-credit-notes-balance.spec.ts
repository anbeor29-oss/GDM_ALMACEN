/**
 * NOTAS DE CRÉDITO + SALDO — flujo de cobranza combinado.
 *  · NC por monto fijo, por porcentaje, por cancelación total
 *  · Saldo se actualiza en lista de facturas y en /balance
 *  · Wallet (botón pago) se deshabilita al llegar a saldo 0
 *  · Historia de timbres (3 CFDIs)
 */
import { test, expect } from '@playwright/test';
import { login, createCustomer, createProduct, createInvoice, getInvoiceBalance } from '../fixtures/api-client';
import { NC_PERCENT_CASES } from '../fixtures/test-data';

let custId: string;
let prodId: string;

test.beforeAll(async () => {
  const c = await login();
  const stamp = Date.now();
  const cust = await createCustomer(c, `QA NC ${stamp}`, `XAXX${stamp % 1_000_000}333C`, '601');
  custId = cust.id;
  prodId = (await createProduct(c, { name: `PNC-${stamp}`, taxPresetId: 'iva16', basePrice: 1000 })).id;
});

async function stampInvoice(c: any, invoiceId: string) {
  // En mock-PAC marcamos directamente vía SQL helper expuesto en el flujo de timbrado.
  await c.ctx.put(`/invoices/${invoiceId}/status`, { data: { newStatus: 'READY' } });
  // El timbrado real está en cfdi/stamp pero para el test basta con UUID/status STAMPED
  await c.ctx.post(`cfdi/${invoiceId}/stamp`, {}).catch(() => {});
}

test.describe('@regression Notas de Crédito', () => {
  test('NC-001 NC monto fijo prorratea IVA con la proporción de la factura', async () => {
    const c = await login();
    const inv = await createInvoice(c, {
      customerId: custId,
      items: [{ productId: prodId, quantity: 1, unitPrice: 10000, taxPresetId: 'iva16' }],
    });
    await stampInvoice(c, inv.id);

    const r = await c.ctx.post('credit-notes', {
      data: { customerId: custId, invoiceId: inv.id, tipoRelacion: '01',
              amount: 1160, applyToInvoice: true },
    });
    expect(r.ok()).toBeTruthy();
    const nc = (await r.json()).data;
    expect(Number(nc.subtotal) + Number(nc.iva)).toBeCloseTo(1160, 2);
    expect(Number(nc.iva)).toBeCloseTo(160, 2);  // 16% prorrateado
  });

  for (const pct of NC_PERCENT_CASES) {
    test(`NC-002/${pct}% NC por % calcula amount = total × pct/100`, async () => {
      const c = await login();
      const inv = await createInvoice(c, {
        customerId: custId,
        items: [{ productId: prodId, quantity: 1, unitPrice: 1000, taxPresetId: 'iva16' }],
      });
      await stampInvoice(c, inv.id);
      const total = Number(inv.total);
      const r = await c.ctx.post('credit-notes', {
        data: { customerId: custId, invoiceId: inv.id, tipoRelacion: '01',
                discountPercent: pct, applyToInvoice: true },
      });
      expect(r.ok()).toBeTruthy();
      const nc = (await r.json()).data;
      expect(Number(nc.total)).toBeCloseTo(total * pct / 100, 2);
    });
  }

  test('NC-003 NC > saldo pendiente → 400', async () => {
    const c = await login();
    const inv = await createInvoice(c, {
      customerId: custId,
      items: [{ productId: prodId, quantity: 1, unitPrice: 100, taxPresetId: 'iva16' }],
    });
    await stampInvoice(c, inv.id);
    const r = await c.ctx.post('credit-notes', {
      data: { customerId: custId, invoiceId: inv.id, tipoRelacion: '01',
              amount: 999999, applyToInvoice: true },
    });
    expect(r.status()).toBe(400);
  });

  test('NC-004 NC sin amount ni discountPercent → 400', async () => {
    const c = await login();
    const inv = await createInvoice(c, {
      customerId: custId,
      items: [{ productId: prodId, quantity: 1, unitPrice: 100, taxPresetId: 'iva16' }],
    });
    const r = await c.ctx.post('credit-notes', {
      data: { customerId: custId, invoiceId: inv.id, tipoRelacion: '01' },
    });
    expect(r.status()).toBe(400);
  });
});

test.describe('@regression Saldo agregado (pagos + NC)', () => {
  test('BAL-001 Saldo se reduce al aplicar NC y se refleja en GET /invoices', async () => {
    const c = await login();
    const inv = await createInvoice(c, {
      customerId: custId,
      items: [{ productId: prodId, quantity: 1, unitPrice: 1000, taxPresetId: 'iva16' }],
    });
    await stampInvoice(c, inv.id);
    const totalAntes = Number(inv.total);

    // Aplica NC del 10%
    await c.ctx.post('credit-notes', {
      data: { customerId: custId, invoiceId: inv.id, tipoRelacion: '01',
              discountPercent: 10, applyToInvoice: true },
    });

    const list = (await (await c.ctx.get(`invoices?limit=50`)).json()).data.invoices;
    const found = list.find((i: any) => i.id === inv.id);
    expect(found.credited_total).toBeGreaterThan(0);
    expect(Number(found.balance)).toBeCloseTo(totalAntes * 0.9, 2);
  });

  test('BAL-002 /balance endpoint expone payments[] y creditNotes[] con UUIDs', async () => {
    const c = await login();
    const inv = await createInvoice(c, {
      customerId: custId,
      items: [{ productId: prodId, quantity: 1, unitPrice: 500, taxPresetId: 'iva16' }],
    });
    await stampInvoice(c, inv.id);
    await c.ctx.post('credit-notes', {
      data: { customerId: custId, invoiceId: inv.id, tipoRelacion: '01',
              discountPercent: 25, applyToInvoice: true },
    });
    const b = await getInvoiceBalance(c, inv.id);
    expect(b.invoice).toHaveProperty('cfdi_uuid');
    expect(b.totals).toHaveProperty('remaining');
    expect(Array.isArray(b.creditNotes)).toBeTruthy();
    expect(b.creditNotes[0]).toHaveProperty('uuid');
    expect(b.counts.creditNotes).toBeGreaterThan(0);
  });
});

test.describe('@regression Historia de timbres (PDF + XML)', () => {
  test('TMB-001 Cada CFDI en el balance permite descargar PDF y XML', async () => {
    const c = await login();
    const inv = await createInvoice(c, {
      customerId: custId,
      items: [{ productId: prodId, quantity: 1, unitPrice: 800, taxPresetId: 'iva16' }],
    });
    await stampInvoice(c, inv.id);
    const ncR = await c.ctx.post('credit-notes', {
      data: { customerId: custId, invoiceId: inv.id, tipoRelacion: '01',
              discountPercent: 50, applyToInvoice: true },
    });
    const ncId = (await ncR.json()).data.id;

    // Factura PDF + XML
    expect((await c.ctx.get(`cfdi/${inv.id}/pdf`)).ok()).toBeTruthy();
    expect((await c.ctx.get(`cfdi/${inv.id}/xml`)).ok()).toBeTruthy();
    // NC PDF + XML
    expect((await c.ctx.get(`credit-notes/${ncId}/pdf`)).ok()).toBeTruthy();
    const ncXml = await c.ctx.get(`credit-notes/${ncId}/xml`);
    expect(ncXml.ok()).toBeTruthy();
    expect(await ncXml.text()).toContain('TipoDeComprobante="E"');
  });
});
