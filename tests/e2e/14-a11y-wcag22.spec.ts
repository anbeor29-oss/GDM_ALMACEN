/**
 * WCAG 2.2 AA — auditoría automatizada de las pantallas críticas.
 * Requiere: pnpm add -D @axe-core/playwright
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PAGES = [
  { name: 'Login',           path: '/login',            authed: false },
  { name: 'Dashboard',       path: '/dashboard',        authed: true },
  { name: 'Facturas',        path: '/invoices',         authed: true },
  { name: 'Nueva factura',   path: '/invoices/new',     authed: true },
  { name: 'Clientes',        path: '/customers',        authed: true },
  { name: 'Productos',       path: '/products',         authed: true },
  { name: 'Notas de crédito',path: '/credit-notes',     authed: true },
  { name: 'Reportes',        path: '/reports',          authed: true },
  { name: 'Importar XML',    path: '/import-xml',       authed: true },
  { name: 'Proveedores',     path: '/suppliers',        authed: true },
];

async function loginUI(page: any) {
  await page.goto('/login');
  await page.fill('input[type=email]',    'admin.demo@gdmfac.mx');
  await page.fill('input[type=password]', 'Cap4citAcion!');
  await page.click('button[type=submit]');
  await page.waitForURL(/dashboard|change-password/);
}

for (const p of PAGES) {
  test(`A11Y ${p.name} — 0 violaciones WCAG 2.2 AA`, async ({ page }) => {
    if (p.authed) await loginUI(page);
    await page.goto(p.path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    // Report bonito en el error si falla
    const summary = results.violations.map((v) =>
      `${v.id} (${v.impact}) — ${v.nodes.length} nodos — ${v.help}`
    ).join('\n');
    expect(results.violations, `Violaciones:\n${summary}`).toEqual([]);
  });
}
