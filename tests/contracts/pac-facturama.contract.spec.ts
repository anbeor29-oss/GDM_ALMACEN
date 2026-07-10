/**
 * Contract tests — PAC Facturama (sandbox real).
 *
 *  Se ejecutan SOLO cuando estas variables están seteadas:
 *    PAC_BASE_URL=https://apisandbox.facturama.mx
 *    PAC_USER=...
 *    PAC_PASS=...
 *
 *  El propósito: cuando integremos el adapter de Facturama dentro del backend,
 *  esta misma suite (con env activado) corre contra el sandbox de Facturama
 *  para validar que el adapter respete el contrato. Hoy quedan `test.skip`.
 */
import { test, expect } from '@playwright/test';

const SHOULD_RUN =
  Boolean(process.env.PAC_BASE_URL) &&
  Boolean(process.env.PAC_USER) &&
  Boolean(process.env.PAC_PASS);

test.describe('@contract @pac-real Contrato PAC (Facturama Sandbox)', () => {
  test.skip(!SHOULD_RUN, 'Configura PAC_BASE_URL / PAC_USER / PAC_PASS para correr');

  test('PAC-R01 Auth Basic devuelve 200 sobre /api-lite/cfdis', async ({ request }) => {
    const r = await request.get(`${process.env.PAC_BASE_URL}/api-lite/cfdis?keyword=`, {
      headers: {
        Authorization: 'Basic ' + Buffer
          .from(`${process.env.PAC_USER}:${process.env.PAC_PASS}`)
          .toString('base64'),
      },
    });
    expect([200, 204]).toContain(r.status());
  });

  // Cuando esté el adapter real, agregar tests PAC-R02..R05 que repliquen
  // PAC-C01..C05 pero ejecutándose contra el endpoint real. La forma del
  // assert es idéntica — solo cambia el origen del XML.
});
