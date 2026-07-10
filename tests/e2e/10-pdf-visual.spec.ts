/**
 * PDF visual + structural regression.
 *
 *  Capa 1 (siempre activa): extrae texto con pdf-parse y valida que estén
 *    los bloques requeridos (NO regresar al empalme "Y DOS MIL", "MX**Nibición**",
 *    logo de 3 MB, falta del Timbre Fiscal, etc.). Rápido y robusto.
 *
 *  Capa 2 (opt-in con PDF_PIXEL=1): convierte el PDF a PNG y compara contra
 *    baseline con pixelmatch. Útil pero frágil — corre en gate semanal.
 */
import { test, expect } from '@playwright/test';
// @ts-ignore — pdf-parse no trae tipos oficiales
import pdfParse from 'pdf-parse';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { login } from '../fixtures/api-client';
import { InvoiceBuilder } from '../fixtures/invoice-builder';

const BASELINE_DIR = path.join(__dirname, '..', 'fixtures', 'pdf-baselines');
const ARTIFACTS_DIR = path.join(__dirname, '..', 'pdf-artifacts');

async function fetchPdfBuf(c: any, url: string): Promise<Buffer> {
  const r = await c.ctx.get(url);
  if (!r.ok()) throw new Error(`PDF endpoint ${url} → ${r.status()}`);
  return await r.body();
}

test.describe('@regression PDF — extracción textual', () => {
  test('PDF-001 Factura RESICO contiene los bloques obligatorios', async () => {
    const c = await login();
    const ib = new InvoiceBuilder(c);
    await ib.withResico(10000);
    const inv = await ib.build();
    const buf = await fetchPdfBuf(c, `cfdi/${inv.id}/pdf`);
    const { text } = await pdfParse(buf);

    // Datos del emisor (mock)
    expect(text).toMatch(/ACME|FACTURA/i);
    // Receptor existe
    expect(text).toMatch(/RFC[:\s]/i);
    // Totales — Anexo 20 retenciones
    expect(text).toMatch(/IVA trasladado|IVA 16/i);
    expect(text).toMatch(/Ret\.?\s*IVA/i);
    expect(text).toMatch(/Ret\.?\s*ISR/i);
    expect(text).toMatch(/\$\s*10[,.]?408\.33|10408\.33/);
    // Bloque oficial SAT simulado
    expect(text).toMatch(/TIMBRE FISCAL DIGITAL/i);
    expect(text).toMatch(/Sello digital del CFDI/i);
    expect(text).toMatch(/Cadena original/i);
    // Anti-regresión: importe en letra sin la "Y" sobrante
    expect(text).not.toMatch(/^Y\s+(DOS|TRES|MIL)/m);
    // Anti-regresión: no debe aparecer texto montado conocido
    expect(text).not.toContain('Nibición');
    expect(text).not.toContain('exhibición—');
  });

  test('PDF-002 PDF de Factura pesa menos de 100 KB (anti-regresión logo 3MB)', async () => {
    const c = await login();
    const inv = await new InvoiceBuilder(c).withIva16(100).build();
    const buf = await fetchPdfBuf(c, `cfdi/${inv.id}/pdf`);
    expect(buf.length).toBeLessThan(100_000);
    expect(buf.length).toBeGreaterThan(4_000);
  });

  test('PDF-003 NC contiene "TOTAL NC" en una sola línea y el total', async () => {
    const c = await login();
    const inv = await new InvoiceBuilder(c).withIva16(8000).stamped().build();
    const ncR = await c.ctx.post('credit-notes', {
      data: { customerId: inv.customer_id, invoiceId: inv.id, tipoRelacion: '01',
              discountPercent: 50, applyToInvoice: true },
    });
    expect(ncR.ok()).toBeTruthy();
    const ncId = (await ncR.json()).data.id;
    const buf = await fetchPdfBuf(c, `credit-notes/${ncId}/pdf`);
    const { text } = await pdfParse(buf);
    expect(text).toMatch(/TOTAL NC/);
    expect(text).toMatch(/\$\s*4[,.]?640\.00|4640\.00/);  // 50% de 9280 = 4640
    // Régimen del receptor NO debe terminar con un número suelto
    expect(text).not.toMatch(/Personas Morales\s*\n\s*19/);
  });

  test('PDF-004 Pago tiene "FORMA PAGO: 03 — Transferencia" (no "3 —")', async () => {
    const c = await login();
    const inv = await new InvoiceBuilder(c).withIva16(1000).stamped().build();
    const payR = await c.ctx.post('payments', {
      data: { invoiceId: inv.id, paymentAmount: 100, paymentForm: '3',  // <-- sin padding
              paymentMethod: 'PUE' },
    });
    if (!payR.ok()) test.skip(true, 'sin endpoint de pagos en este entorno');
    const payId = (await payR.json()).data.payment.id;
    const buf = await fetchPdfBuf(c, `payments/${payId}/pdf`);
    const { text } = await pdfParse(buf);
    expect(text).toMatch(/03\s*—\s*(Transferencia|Efectivo|Cheque)/);
  });
});

test.describe('@regression-visual PDF — pixel diff (opt-in PDF_PIXEL=1)', () => {
  test.skip(!process.env.PDF_PIXEL, 'pixel-diff deshabilitado (export PDF_PIXEL=1)');

  test('PDF-V01 Snapshot Factura RESICO ≈ baseline', async () => {
    if (!fs.existsSync(BASELINE_DIR)) fs.mkdirSync(BASELINE_DIR, { recursive: true });
    if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

    const c = await login();
    const inv = await new InvoiceBuilder(c).withResico(10000).build();
    const buf = await fetchPdfBuf(c, `cfdi/${inv.id}/pdf`);

    // Lazy-load para no penalizar la suite cuando PDF_PIXEL no está activo
    const { pdfToPng } = await import('pdf-to-png-converter');
    const { default: pixelmatch } = await import('pixelmatch');
    const { PNG } = await import('pngjs');

    const pages = await pdfToPng(buf, { outputFolder: ARTIFACTS_DIR, pagesToProcess: [1] });
    const actualPath = pages[0].path;
    const baselinePath = path.join(BASELINE_DIR, 'factura-resico.page1.png');

    if (!fs.existsSync(baselinePath)) {
      fs.copyFileSync(actualPath, baselinePath);
      test.info().annotations.push({ type: 'baseline', description: 'baseline creado' });
      return;
    }
    const img1 = PNG.sync.read(fs.readFileSync(baselinePath));
    const img2 = PNG.sync.read(fs.readFileSync(actualPath));
    expect(img2.width).toBe(img1.width);
    expect(img2.height).toBe(img1.height);
    const diff = new PNG({ width: img1.width, height: img1.height });
    const mismatched = pixelmatch(img1.data, img2.data, diff.data,
      img1.width, img1.height, { threshold: 0.1 });
    const ratio = mismatched / (img1.width * img1.height);
    // Tolera hasta 1% de pixels diferentes (anti-aliasing entre runs)
    expect(ratio, `${(ratio * 100).toFixed(2)}% pixels diferentes`).toBeLessThan(0.01);
  });
});
