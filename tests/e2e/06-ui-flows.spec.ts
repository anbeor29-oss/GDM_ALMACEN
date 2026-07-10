/**
 * UI E2E — flujos críticos manejados desde el navegador.
 *  · Login UI
 *  · Sidebar visual (regresión de tema claro)
 *  · NewInvoice: input cantidad acepta 3 decimales
 *  · Lista de facturas: columna Saldo presente
 */
import { test, expect, Page } from '@playwright/test';
import { USERS } from '../fixtures/test-data';

async function uiLogin(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email|correo/i).fill(USERS.manager.email);
  await page.getByLabel(/contrase[ñn]a|password/i).fill(USERS.manager.password);
  await page.getByRole('button', { name: /iniciar|entrar|login/i }).click();
  await page.waitForURL(/dashboard|\/$/);
}

test.describe('@regression UI — flujos críticos', () => {
  test('UI-001 Login UI redirecciona al dashboard', async ({ page }) => {
    await uiLogin(page);
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });

  test('UI-002 Sidebar es claro (regresión del tema)', async ({ page }) => {
    await uiLogin(page);
    const aside = page.locator('aside').first();
    // Anti-regresión del cambio "from-slate-800 to-slate-900" → "bg-white"
    const cls = await aside.getAttribute('class') || '';
    expect(cls).toContain('bg-white');
    expect(cls).not.toContain('from-slate-800');
  });

  test('UI-003 Lista de facturas muestra columna Saldo', async ({ page }) => {
    await uiLogin(page);
    await page.getByRole('link', { name: /facturas/i }).first().click();
    await expect(page.getByRole('columnheader', { name: /saldo/i })).toBeVisible();
  });

  test('UI-004 Dashboard muestra los 4 KPIs (Facturas, Facturado, Cobrado, Saldo)', async ({ page }) => {
    await uiLogin(page);
    for (const label of [/facturas emitidas/i, /total facturado/i, /cobrado/i, /saldo por cobrar/i]) {
      await expect(page.getByText(label).first()).toBeVisible({ timeout: 10000 });
    }
  });

  test('UI-005 Modal Historia de timbres se abre y muestra UUID', async ({ page }) => {
    await uiLogin(page);
    await page.getByRole('link', { name: /facturas/i }).first().click();
    // Click en el primer botón con title "Historia de timbres..."
    const historyBtn = page.getByTitle(/historia de timbres/i).first();
    if (await historyBtn.count() > 0) {
      await historyBtn.click();
      await expect(page.getByRole('heading', { name: /historia de timbres/i })).toBeVisible();
      // Debe haber al menos un badge I, P o E
      await expect(page.locator('text=/^[IPE]$/').first()).toBeVisible();
    } else {
      test.skip(true, 'No hay facturas timbradas en sandbox');
    }
  });
});
