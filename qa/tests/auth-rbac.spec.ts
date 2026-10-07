import { test, expect } from '@playwright/test';
import { uiLogin, apiLogin, CREDS, API_BASE } from '../fixtures/auth';

/**
 * AUTENTICACIÓN (negativos) + RBAC (gateo por grupo de trabajo).
 * El gateo real vive en el backend (requireModule); el frontend solo esconde el
 * menú. Estas pruebas verifican AMBAS capas.
 */
test.describe('Autenticación — negativos', () => {
  test('AUT-01 credenciales inválidas: no entra y muestra error', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill('noexiste@ejemplo.com');
    await page.locator('input[type="password"]').fill('claveIncorrecta123');
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page).toHaveURL(/\/login$/);
    // Login.tsx pinta el error en un bloque con clases red-*
    await expect(page.locator('[class*="red-"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('AUT-02 login API con password vacío es rechazado', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/v1/auth/login`, {
      data: { email: 'x@x.com', password: '' },
    });
    expect([400, 401, 422]).toContain(res.status());
  });

  test('AUT-03 endpoint protegido sin token responde 401', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v1/auth/me`);
    expect(res.status()).toBe(401);
  });

  test('AUT-04 ruta privada sin sesión redirige a /login', async ({ page }) => {
    await page.goto('/contabilidad/balanza');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('RBAC — gateo por grupo de trabajo', () => {
  test('RBAC-01 un grupo acotado no alcanza un módulo ajeno (rebota, no pantalla vacía)', async ({ page }) => {
    test.skip(!CREDS.limited.email, 'Configura TEST_LIMITED_* (recomendado: cuenta PUNTO_VENTA)');
    await uiLogin(page, CREDS.limited.email, CREDS.limited.password);
    await page.goto('/nomina');                       // módulo que PUNTO_VENTA no tiene
    await expect(page).not.toHaveURL(/\/nomina$/);      // debe rebotar a su "home"
  });

  test('RBAC-02 el backend niega el módulo con 403 aunque se llame directo', async ({ request }) => {
    test.skip(!CREDS.limited.email, 'Configura TEST_LIMITED_*');
    const token = await apiLogin(request, CREDS.limited.email, CREDS.limited.password);
    // /nomina/* está montado tras requireModule('nomina'): 403 antes de rutear
    const res = await request.get(`${API_BASE}/api/v1/nomina/empleados`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('RBAC-03 el admin SÍ alcanza el mismo módulo', async ({ request }) => {
    test.skip(!CREDS.admin.email, 'Configura TEST_ADMIN_*');
    const token = await apiLogin(request, CREDS.admin.email, CREDS.admin.password);
    const res = await request.get(`${API_BASE}/api/v1/accounting/estado`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // 200 (tiene datos) o 404/otra lógica de negocio, pero NUNCA 403 para ADMIN_ALL
    expect(res.status()).not.toBe(403);
  });
});
