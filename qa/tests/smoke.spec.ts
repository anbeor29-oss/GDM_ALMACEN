import { test, expect } from '@playwright/test';
import { uiLogin, apiLogin, CREDS, API_BASE } from '../fixtures/auth';

/**
 * SMOKE — ¿el sistema está vivo y deja entrar? Debe correr en < 30 s y ser
 * el primer gate de cualquier despliegue. No toca datos.
 */
test.describe('Smoke', () => {
  test('SMK-01 /health responde OK y anuncia el commit desplegado', async ({ request }) => {
    const res = await request.get(`${API_BASE}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('OK');
    expect(body).toHaveProperty('commit'); // 7 chars del commit, o 'local'
  });

  test('SMK-02 la pantalla de login carga con sus controles', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'GDM NEXO' })).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();
  });

  test('SMK-03 login válido entra al sistema (UI)', async ({ page }) => {
    test.skip(!CREDS.admin.email, 'Configura TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD en .env');
    await uiLogin(page, CREDS.admin.email, CREDS.admin.password);
    await expect(page).not.toHaveURL(/\/login$/);
  });

  test('SMK-04 login por API devuelve un token utilizable', async ({ request }) => {
    test.skip(!CREDS.admin.email, 'Configura TEST_ADMIN_* en .env');
    const token = await apiLogin(request, CREDS.admin.email, CREDS.admin.password);
    expect(token.length).toBeGreaterThan(20);
    // el token abre /auth/me
    const me = await request.get(`${API_BASE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.ok()).toBeTruthy();
  });
});
