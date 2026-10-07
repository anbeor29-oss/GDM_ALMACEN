import { test, expect } from '@playwright/test';
import { uiLogin, CREDS } from '../fixtures/auth';

/**
 * FUNCIONAL — Clientes (receptor CFDI 4.0). Ejemplo de patrón para pantallas CRUD.
 *
 * OJO: estas pruebas son de LECTURA/navegación a propósito. Crear y borrar clientes
 * reales contamina el ambiente; el alta/baja destructivo debe correr contra una
 * EMPRESA de prueba dedicada (ver README) y limpiar sus datos al final.
 */
test.describe('Funcional — Clientes', () => {
  test.skip(!CREDS.admin.email, 'Configura TEST_ADMIN_* en .env');

  test.beforeEach(async ({ page }) => {
    await uiLogin(page, CREDS.admin.email, CREDS.admin.password);
    await page.goto('/customers');
  });

  test('CLI-01 la lista de clientes carga con encabezado y acción de alta', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Nuevo Cliente/ })).toBeVisible();
    // La tabla trae las columnas fiscales (CFF 29-A)
    await expect(page.getByRole('columnheader', { name: 'RFC' })).toBeVisible();
  });

  test('CLI-02 abrir el alta muestra el formulario del receptor', async ({ page }) => {
    await page.getByRole('button', { name: /Nuevo Cliente/ }).click();
    await expect(page.getByText(/RFC/i).first()).toBeVisible();
  });
});
