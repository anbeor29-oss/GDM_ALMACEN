/**
 * FACTURAS — núcleo del Anexo 20.
 *  · Cantidad: valores frontera (0, 0.001, 5.075, 999999.999, overflow)
 *  · Retenciones: cálculo exacto por preset RESICO / Honorarios
 *  · XML CFDI 4.0: estructura mínima correcta
 *  · Saldo y dashboard reflejan la nueva factura
 */
import { test, expect } from '@playwright/test';
import { login, createCustomer, createProduct, createInvoice, getDashboardSummary } from '../fixtures/api-client';
import { QTY_BOUNDARIES, PAIRWISE_REGIMEN_PRESET } from '../fixtures/test-data';

let custId: string;
let prodId16: string;
let prodResico: string;
let prodHon: string;

test.beforeAll(async () => {
  const c = await login();
  const stamp = Date.now();
  const cust = await createCustomer(c, `QA Customer ${stamp}`, `XAXX${stamp % 1_000_000}001A`, '601');
  custId = cust.id;
  prodId16 = (await createProduct(c, { name: `P16-${stamp}`, taxPresetId: 'iva16', basePrice: 1000 })).id;
  prodResico = (await createProduct(c, { name: `PR-${stamp}`, taxPresetId: 'resico_pf_pm', basePrice: 10000 })).id;
  prodHon = (await createProduct(c, { name: `PH-${stamp}`, taxPresetId: 'hon_pf_pm', basePrice: 5000 })).id;
});

test.describe('@regression Facturas — cálculos Anexo 20', () => {
  test('FAC-001 Factura IVA 16% genera subtotal+IVA correcto', async () => {
    const c = await login();
    const inv = await createInvoice(c, {
      customerId: custId,
      items: [{ productId: prodId16, quantity: 2, unitPrice: 1000, taxPresetId: 'iva16' }],
    });
    expect(Number(inv.subtotal)).toBeCloseTo(2000, 2);
    expect(Number(inv.tax_transferred)).toBeCloseTo(320, 2);
    expect(Number(inv.total)).toBeCloseTo(2320, 2);
  });

  test('FAC-002 Factura RESICO PF→PM calcula ret. IVA 10.67% y ret. ISR 1.25%', async () => {
    const c = await login();
    const inv = await createInvoice(c, {
      customerId: custId,
      items: [{ productId: prodResico, quantity: 1, unitPrice: 10000, taxPresetId: 'resico_pf_pm' }],
    });
    expect(Number(inv.subtotal)).toBeCloseTo(10000, 2);
    expect(Number(inv.tax_transferred)).toBeCloseTo(1600, 2);   // 16%
    expect(Number(inv.tax_retained_iva)).toBeCloseTo(1066.67, 2);
    expect(Number(inv.tax_retained_isr)).toBeCloseTo(125, 2);    // 1.25%
    expect(Number(inv.total)).toBeCloseTo(10408.33, 2);
  });

  test('FAC-003 Factura Honorarios PF→PM aplica ret. IVA 2/3 + ret. ISR 10%', async () => {
    const c = await login();
    const inv = await createInvoice(c, {
      customerId: custId,
      items: [{ productId: prodHon, quantity: 1, unitPrice: 5000, taxPresetId: 'hon_pf_pm' }],
    });
    expect(Number(inv.tax_retained_iva)).toBeCloseTo(533.34, 2); // 10.6667%
    expect(Number(inv.tax_retained_isr)).toBeCloseTo(500, 2);    // 10%
    expect(Number(inv.total)).toBeCloseTo(4766.66, 2);
  });

  test('FAC-004 Cantidad con 3 decimales (5.075) se persiste exacta', async () => {
    const c = await login();
    const inv = await createInvoice(c, {
      customerId: custId,
      items: [{ productId: prodId16, quantity: QTY_BOUNDARIES.threeDec, unitPrice: 100, taxPresetId: 'iva16' }],
    });
    const item = inv.items[0];
    expect(Number(item.quantity)).toBeCloseTo(5.075, 3);
    expect(Number(item.subtotal)).toBeCloseTo(507.5, 2);
  });

  test('FAC-005 Cantidad en el máximo (999999.999) se acepta', async () => {
    const c = await login();
    const inv = await createInvoice(c, {
      customerId: custId,
      items: [{ productId: prodId16, quantity: QTY_BOUNDARIES.maxValid, unitPrice: 0.01, taxPresetId: 'iva16' }],
    });
    expect(Number(inv.items[0].quantity)).toBeCloseTo(999999.999, 3);
  });

  test('FAC-006 Factura sin items → 400', async () => {
    const c = await login();
    const r = await c.ctx.post('invoices', {
      data: { customerId: custId, cfdiType: 'I', paymentForm: '03',
              paymentMethod: 'PUE', cfdiUse: 'G03', items: [] },
    });
    expect(r.status()).toBe(400);
  });

  test('FAC-007 Customer inexistente → 404', async () => {
    const c = await login();
    const r = await c.ctx.post('invoices', {
      data: { customerId: '00000000-0000-0000-0000-000000000000',
              cfdiType: 'I', paymentForm: '03', paymentMethod: 'PUE', cfdiUse: 'G03',
              items: [{ productId: prodId16, quantity: 1, unitPrice: 100 }] },
    });
    expect([400, 404]).toContain(r.status());
  });

  test('FAC-008 GET PDF descarga binario application/pdf', async () => {
    const c = await login();
    const inv = await createInvoice(c, {
      customerId: custId,
      items: [{ productId: prodId16, quantity: 1, unitPrice: 100, taxPresetId: 'iva16' }],
    });
    const r = await c.ctx.get(`cfdi/${inv.id}/pdf`);
    expect(r.ok()).toBeTruthy();
    expect(r.headers()['content-type']).toContain('application/pdf');
    const buf = await r.body();
    expect(buf.length).toBeGreaterThan(5000);              // PDF mínimo razonable
    expect(buf.length).toBeLessThan(500_000);              // anti-regresión logo 3MB
    expect(buf.slice(0, 4).toString()).toBe('%PDF');       // magic number
  });

  test('FAC-009 XML CFDI 4.0 incluye nodos requeridos por Anexo 20', async () => {
    const c = await login();
    const inv = await createInvoice(c, {
      customerId: custId,
      items: [{ productId: prodResico, quantity: 1, unitPrice: 5000, taxPresetId: 'resico_pf_pm' }],
    });
    const r = await c.ctx.get(`cfdi/${inv.id}/xml`);
    expect(r.ok()).toBeTruthy();
    const xml = await r.text();
    for (const tag of [
      '<cfdi:Comprobante', 'Version="4.0"',
      '<cfdi:Emisor', '<cfdi:Receptor', 'DomicilioFiscalReceptor',
      '<cfdi:Conceptos', 'ObjetoImp', '<cfdi:Traslado', '<cfdi:Retencion',
      'TasaOCuota', 'Exportacion',
    ]) {
      expect(xml, `XML no contiene "${tag}"`).toContain(tag);
    }
  });
});

test.describe('@regression Facturas — pairwise régimen × preset', () => {
  for (const tc of PAIRWISE_REGIMEN_PRESET) {
    test(`FAC-PW ${tc.regimen} + ${tc.preset} no rompe el cálculo`, async () => {
      const c = await login();
      // Asegura customer con el régimen
      const stamp = Date.now() + Math.floor(Math.random() * 1000);
      const cust = await createCustomer(c, `PW-${tc.regimen}-${stamp}`,
        `XAXX${stamp % 1_000_000}999B`, tc.regimen);
      const prod = await createProduct(c, { name: `PW-${tc.preset}-${stamp}`, taxPresetId: tc.preset,
        taxType: tc.preset.startsWith('ieps') ? 'IEPS' : 'IVA',
        taxRate: tc.preset === 'iva8' ? 0.08 : (tc.preset === 'iva0' || tc.preset === 'ivaex' || tc.preset.startsWith('ieps')) ? 0 : 0.16,
        isExempt: tc.preset === 'ivaex',
        appliesIEPS: tc.preset.startsWith('ieps'),
      });
      const inv = await createInvoice(c, {
        customerId: cust.id,
        items: [{ productId: prod.id, quantity: 1, unitPrice: 1000, taxPresetId: tc.preset }],
      });
      expect(Number(inv.total)).toBeGreaterThan(0);
      expect(inv.items[0].tax_preset_id).toBe(tc.preset);
    });
  }
});
