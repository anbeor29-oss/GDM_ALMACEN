import { defineConfig, devices } from '@playwright/test';

/**
 * Configuración Playwright para el ERP CFDI 4.0.
 * - Apunta al stack local (FE :5173, BE :3000) — overrideable con env vars.
 * - Genera reporter HTML + JUnit (CI) + JSON (dashboards).
 * - Timeout generoso porque los tests E2E disparan SQL + PDFKit.
 */
// Browsers: por defecto solo Chromium (gate CI rápido). En jobs semanales
// exportar BROWSERS=all para correr Firefox + WebKit también.
const wantedBrowsers = (process.env.BROWSERS || 'chromium').toLowerCase();
const enableFirefox = wantedBrowsers === 'all' || wantedBrowsers.includes('firefox');
const enableWebkit  = wantedBrowsers === 'all' || wantedBrowsers.includes('webkit');

export default defineConfig({
  testDir: '.',                      // incluye e2e/ + contracts/
  globalSetup: './fixtures/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html',  { open: 'never', outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'reports/junit.xml' }],
    ['json',  { outputFile: 'reports/results.json' }],
  ],
  use: {
    baseURL: process.env.FE_URL || 'http://localhost:5173',
    extraHTTPHeaders: {
      'X-Test-Run': 'playwright',
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    ...(enableFirefox ? [{
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
    }] : []),
    ...(enableWebkit ? [{
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } },
    }] : []),
  ],
});
