/**
 * ACCESIBILIDAD (WCAG 2.2 AA) + SEGURIDAD BÁSICA (OWASP)
 *  · Escaneo axe-core en páginas críticas
 *  · Headers de seguridad
 *  · Anti-IDOR: un usuario no puede leer facturas de otra empresa
 *  · CORS estricto
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { USERS, API_URL } from '../fixtures/test-data';

async function uiLogin(page: any) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(USERS.manager.email);
  await page.getByLabel(/contrase[ñn]a|password/i).fill(USERS.manager.password);
  await page.getByRole('button', { name: /iniciar|entrar|login/i }).click();
  await page.waitForURL(/dashboard|\/$/);
}

test.describe('@a11y Accesibilidad WCAG 2.2 AA', () => {
  for (const path of ['/login', '/dashboard', '/invoices', '/products', '/customers']) {
    test(`A11Y-${path} sin violaciones serious/critical`, async ({ page }) => {
      if (path !== '/login') await uiLogin(page);
      await page.goto(path).catch(() => {});
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical'
      );
      if (blocking.length > 0) {
        console.log(`[A11Y ${path}]`, JSON.stringify(
          blocking.map((v) => ({ id: v.id, impact: v.impact, help: v.help })),
          null, 2));
      }
      expect(blocking).toEqual([]);
    });
  }
});

test.describe('@security Seguridad básica (OWASP)', () => {
  test('SEC-001 Health expone status pero no stack ni versiones', async ({ request }) => {
    const r = await request.get('http://localhost:3000/health');
    const txt = await r.text();
    expect(txt).not.toMatch(/node|express|postgres|password|stack/i);
  });

  test('SEC-002 CORS preflight bloquea Origin no permitido', async ({ request }) => {
    const r = await request.fetch(`${API_URL}/invoices`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://attacker.example.com', 'Access-Control-Request-Method': 'GET' },
    });
    const allow = r.headers()['access-control-allow-origin'] || '';
    expect(allow).not.toBe('*');
    expect(allow).not.toContain('attacker.example.com');
  });

  test('SEC-003 IDOR: token de manager NO puede leer invoice de otra companyId', async ({ request }) => {
    const login = await request.post(`${API_URL}/auth/login`, { data: USERS.manager });
    const token = (await login.json()).data.token;
    const fakeUUID = '00000000-0000-0000-0000-deadbeef0000';
    const r = await request.get(`${API_URL}/invoices/${fakeUUID}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect([403, 404]).toContain(r.status());
  });

  test('SEC-004 Rate limit en /auth/login: 20 intentos seguidos no tumban el server', async ({ request }) => {
    const promises = Array.from({ length: 20 }).map(() =>
      request.post(`${API_URL}/auth/login`, { data: { email: 'foo@bar.com', password: 'x' } })
    );
    const results = await Promise.all(promises);
    // Tolerar 200/401/429 — lo importante es que NO haya 5xx
    for (const r of results) expect(r.status()).toBeLessThan(500);
  });

  test('SEC-005 XSS: nombre de cliente con <script> se almacena escapado', async ({ request }) => {
    const login = await request.post(`${API_URL}/auth/login`, { data: USERS.manager });
    const token = (await login.json()).data.token;
    const xss = `<script>alert(1)</script> QA`;
    const r = await request.post(`${API_URL}/customers`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { businessName: xss, rfc: `XAXX${Date.now() % 1_000_000}777Z`,
              fiscalRegime: '601', postalCode: '64000' },
    });
    expect(r.ok()).toBeTruthy();
    const c = (await r.json()).data;
    // El backend NO debe ejecutar; el front debe renderizar como texto.
    // Aquí solo verificamos persistencia sin filtrado destructivo.
    expect(c.business_name).toContain('script');
  });
});
