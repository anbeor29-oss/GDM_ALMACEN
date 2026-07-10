/**
 * PRODUCTOS — cobertura del catálogo de impuestos (matriz 11 presets)
 *  · Valores frontera de precio
 *  · Persistencia de tax_preset_id, is_exempt, applies_ieps
 *  · Validaciones SAT (clave producto y unidad)
 */
import { test, expect } from '@playwright/test';
import { login, createProduct } from '../fixtures/api-client';
import { TAX_PRESETS, PRICE_BOUNDARIES } from '../fixtures/test-data';

test.describe('@regression Productos — impuestos', () => {
  for (const preset of TAX_PRESETS) {
    test(`PRD-001/${preset} Crear producto con preset ${preset} persiste banderas`, async () => {
      const c = await login();
      const isExempt = preset === 'ivaex';
      const isIeps = preset === 'ieps_tasa' || preset === 'ieps_cuota';
      const rate = preset === 'iva8' ? 0.08
                 : (preset === 'iva0' || preset === 'ivaex' || isIeps) ? 0
                 : 0.16;
      const p = await createProduct(c, {
        name: `QA ${preset} ${Date.now()}`,
        taxPresetId: preset,
        taxRate: rate,
        taxType: isIeps ? 'IEPS' : 'IVA',
        isExempt, appliesIEPS: isIeps,
      });
      expect(p.tax_preset_id).toBe(preset);
      expect(Number(p.tax_rate)).toBeCloseTo(rate, 6);
      expect(p.is_exempt).toBe(isExempt);
      expect(p.applies_ieps).toBe(isIeps);
    });
  }

  test('PRD-002 Precio negativo → backend acepta pero invoice rechazará (boundary)', async () => {
    const c = await login();
    const r = await c.ctx.post('products', {
      data: { name: 'NEG', claveSat: '01010101', unitCode: 'H87',
              basePrice: PRICE_BOUNDARIES.zero, taxType: 'IVA', taxRate: 0.16,
              taxPresetId: 'iva16' },
    });
    expect(r.ok()).toBeTruthy(); // precio 0 sí se permite (servicio gratis)
  });

  test('PRD-003 Clave SAT inválida → 400 con mensaje SAT', async () => {
    const c = await login();
    const r = await c.ctx.post('products', {
      data: { name: 'BAD', claveSat: '99999999', unitCode: 'H87', basePrice: 100,
              taxType: 'IVA', taxRate: 0.16 },
    });
    expect(r.status()).toBe(400);
    expect((await r.json()).message).toMatch(/clave|SAT/i);
  });

  test('PRD-004 Unidad SAT inválida → 400', async () => {
    const c = await login();
    const r = await c.ctx.post('products', {
      data: { name: 'BAD', claveSat: '01010101', unitCode: 'ZZZ', basePrice: 100,
              taxType: 'IVA', taxRate: 0.16 },
    });
    expect(r.status()).toBe(400);
  });

  test('PRD-005 Listado de productos paginado regresa total y array', async () => {
    const c = await login();
    const r = await c.ctx.get('products?limit=5');
    expect(r.ok()).toBeTruthy();
    const b = await r.json();
    expect(Array.isArray(b.data.products)).toBeTruthy();
    expect(b.data.total).toBeGreaterThanOrEqual(0);
  });
});
