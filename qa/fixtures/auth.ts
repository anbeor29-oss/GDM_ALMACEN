import { Page, APIRequestContext, expect } from '@playwright/test';

// Origen del API. En dev el proxy de Vite cubre /api, pero para llamadas directas
// (login por API, health) usamos API_BASE explícito.
export const API_BASE = process.env.API_BASE || process.env.BASE_URL || 'http://localhost:3000';

/**
 * Login por UI contra el formulario REAL de /login (frontend/src/pages/Login.tsx).
 * No hay data-testid, así que se localiza por tipo de input y por el texto del botón.
 * El token queda en sessionStorage (frontend/src/utils/authStorage.ts), por lo que
 * las navegaciones posteriores EN ESTE mismo `page` ya van autenticadas.
 */
export async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page, 'debió salir de /login tras autenticar').not.toHaveURL(/\/login$/, { timeout: 15_000 });
}

/** Login por API: devuelve el JWT para pruebas a nivel de endpoint (RBAC, contratos, etc.). */
export async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  const res = await request.post(`${API_BASE}/api/v1/auth/login`, { data: { email, password } });
  expect(res.ok(), `login API falló con status ${res.status()}`).toBeTruthy();
  const body = await res.json();
  const token = body?.data?.token;
  expect(token, 'la respuesta de /auth/login no trae data.token').toBeTruthy();
  return token as string;
}

export const CREDS = {
  admin: {
    email: process.env.TEST_ADMIN_EMAIL || '',
    password: process.env.TEST_ADMIN_PASSWORD || '',
  },
  limited: {
    email: process.env.TEST_LIMITED_EMAIL || '',
    password: process.env.TEST_LIMITED_PASSWORD || '',
    home: process.env.TEST_LIMITED_HOME || '/pos',
  },
};
