/**
 * AUTH — clases de equivalencia + casos negativos + seguridad básica.
 */
import { test, expect } from '@playwright/test';
import { USERS, API_URL } from '../fixtures/test-data';

test.describe('@regression Autenticación', () => {
  test('AUT-001 Login con credenciales válidas devuelve token JWT', async ({ request }) => {
    const r = await request.post(`${API_URL}/auth/login`, { data: USERS.manager });
    expect(r.ok()).toBeTruthy();
    const b = await r.json();
    expect(b.data.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/); // JWT 3 partes
    expect(b.data.user.role).toBe('MANAGER');
  });

  test('AUT-002 Login con password incorrecto → 401', async ({ request }) => {
    const r = await request.post(`${API_URL}/auth/login`, {
      data: { email: USERS.manager.email, password: 'wrong-pass' },
    });
    expect(r.status()).toBe(401);
  });

  test('AUT-003 Login con email inexistente → 401 (no 404 — anti-enum)', async ({ request }) => {
    const r = await request.post(`${API_URL}/auth/login`, { data: USERS.invalid });
    expect(r.status()).toBe(401);
  });

  test('AUT-004 Login con body vacío → 400', async ({ request }) => {
    const r = await request.post(`${API_URL}/auth/login`, { data: {} });
    expect([400, 401, 422]).toContain(r.status());
  });

  test('@security AUT-005 SQL injection en email no rompe ni expone error', async ({ request }) => {
    const r = await request.post(`${API_URL}/auth/login`, {
      data: { email: "admin'--", password: 'x' },
    });
    expect([400, 401, 422]).toContain(r.status());
    const txt = await r.text();
    expect(txt).not.toMatch(/syntax|postgres|pg-pool|stack/i);
  });

  test('@security AUT-006 Acceso a endpoint protegido sin token → 401', async ({ request }) => {
    const r = await request.get(`${API_URL}/invoices`);
    expect(r.status()).toBe(401);
  });

  test('@security AUT-007 Token manipulado → 401', async ({ request }) => {
    const r = await request.get(`${API_URL}/invoices`, {
      headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.tampered.signature' },
    });
    expect(r.status()).toBe(401);
  });
});
