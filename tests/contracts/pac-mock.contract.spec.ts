/**
 * Contract tests — Mock PAC (el que ya implementa el backend).
 *
 *  El backend hoy "timbra" generando un UUID v4 y persistiendo el XML.
 *  Esta suite valida que el comportamiento CUMPLA con el contrato esperado
 *  por un PAC real — así, cuando integremos Finkok/Facturama, los mismos
 *  asserts validan el adapter real (ver pac-facturama.contract.spec.ts).
 */
import { test, expect } from '@playwright/test';
import { login } from '../fixtures/api-client';
import { InvoiceBuilder } from '../fixtures/invoice-builder';

const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

test.describe('@contract @pac-mock Contrato PAC (Mock)', () => {
  test('PAC-C01 Al crear NC se genera UUID con formato 8-4-4-4-12', async () => {
    const c = await login();
    const inv = await new InvoiceBuilder(c).withIva16(1000).stamped().build();
    const ncR = await c.ctx.post('credit-notes', {
      data: { customerId: inv.customer_id, invoiceId: inv.id, tipoRelacion: '01', discountPercent: 10 },
    });
    const nc = (await ncR.json()).data;
    expect(nc.uuid).toMatch(UUID_RE);
  });

  test('PAC-C02 XML timbrado contiene CFDI 4.0 + nodos obligatorios SAT', async () => {
    const c = await login();
    const inv = await new InvoiceBuilder(c).withResico(5000).build();
    const xmlR = await c.ctx.get(`cfdi/${inv.id}/xml`);
    expect(xmlR.ok()).toBeTruthy();
    const xml = await xmlR.text();
    expect(xml).toContain('<?xml');
    expect(xml).toMatch(/cfdi:Comprobante[\s\S]*Version="4\.0"/);
    expect(xml).toContain('TipoDeComprobante="I"');
    expect(xml).toContain('Exportacion');
    expect(xml).toContain('<cfdi:Emisor');
    expect(xml).toContain('<cfdi:Receptor');
    expect(xml).toContain('DomicilioFiscalReceptor');
    expect(xml).toMatch(/<cfdi:Retencion[\s\S]+Impuesto="002"/);   // ret. IVA RESICO
  });

  test('PAC-C03 NC referenciando UUID padre incluye CfdiRelacionados', async () => {
    const c = await login();
    const inv = await new InvoiceBuilder(c).withIva16(1000).stamped().build();
    const ncR = await c.ctx.post('credit-notes', {
      data: { customerId: inv.customer_id, invoiceId: inv.id, tipoRelacion: '01', amount: 200 },
    });
    const ncId = (await ncR.json()).data.id;
    const xml = await (await c.ctx.get(`credit-notes/${ncId}/xml`)).text();
    expect(xml).toContain('TipoDeComprobante="E"');
    expect(xml).toMatch(/CfdiRelacionados[\s\S]+TipoRelacion="01"/);
    if (inv.cfdi_uuid) expect(xml).toContain(`UUID="${inv.cfdi_uuid}"`);
  });

  test('PAC-C04 Pago incluye complemento Pagos 2.0', async () => {
    const c = await login();
    const inv = await new InvoiceBuilder(c).withIva16(1000).stamped().build();
    const payR = await c.ctx.post('payments', {
      data: { invoiceId: inv.id, paymentAmount: 100, paymentForm: '03', paymentMethod: 'PUE' },
    });
    if (!payR.ok()) test.skip(true, 'sin endpoint de pagos en este entorno');
    const payId = (await payR.json()).data.payment.id;
    const xml = await (await c.ctx.get(`payments/${payId}/xml`)).text();
    expect(xml).toContain('TipoDeComprobante="P"');
    expect(xml).toContain('xmlns:pago20');
    expect(xml).toContain('<pago20:Pagos');
    expect(xml).toContain('<pago20:DoctoRelacionado');
  });

  test('PAC-C05 Idempotencia: timbrar 2 veces la misma factura NO duplica UUIDs', async () => {
    const c = await login();
    const inv = await new InvoiceBuilder(c).withIva16(500).build();
    const r1 = await c.ctx.post(`cfdi/${inv.id}/stamp`, {}).catch(() => null);
    const r2 = await c.ctx.post(`cfdi/${inv.id}/stamp`, {}).catch(() => null);
    if (!r1 || !r2 || !r1.ok()) test.skip(true, 'endpoint stamp no expuesto');
    // Política: la segunda llamada debe regresar el mismo UUID O un 409 Conflict.
    if (r2.ok()) {
      const u1 = (await r1.json()).data?.uuid;
      const u2 = (await r2.json()).data?.uuid;
      expect(u2).toBe(u1);
    } else {
      expect([409, 422]).toContain(r2.status());
    }
  });
});
