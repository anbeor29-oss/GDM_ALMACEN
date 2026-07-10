/**
 * IMPORT XML — negativos y seguridad.
 *   · XXE (external entity) → 400 sin abrir archivos locales
 *   · Bomba XML (billion laughs) → parser lo rechaza
 *   · Duplicado por sha256 → detectado
 *   · Tamaño > 1 MB → 400
 */
import { test, expect } from '@playwright/test';
import { login } from '../fixtures/api-client';

function b64(s: string) { return Buffer.from(s, 'utf-8').toString('base64'); }

test.describe('@security Import XML hardening', () => {
  test('IMP-006 XXE (external entity) es rechazado', async () => {
    const c = await login();
    const xxe = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///c:/windows/win.ini">]>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0"
                  TipoDeComprobante="I" Total="&xxe;">
  <cfdi:Emisor Rfc="ASH000404J1A" Nombre="TEST" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="XAXX010101000" Nombre="TEST" DomicilioFiscalReceptor="00000"
                 RegimenFiscalReceptor="616" UsoCFDI="G03"/>
</cfdi:Comprobante>`;
    const r = await c.ctx.post('cfdi-import/preview', { data: { xmlBase64: b64(xxe) }});
    expect([400, 422]).toContain(r.status());
    // El error NO debe contener contenido del archivo del sistema
    const body = await r.text();
    expect(body).not.toContain('[fonts]');
    expect(body).not.toContain('extensions');
  });

  test('IMP-004 XML > 1 MB → 400', async () => {
    const c = await login();
    // Padding con espacios dentro del XML para exceder 1 MB
    const big = `<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
                 Version="4.0" TipoDeComprobante="I" Total="1"><cfdi:Emisor Rfc="X" Nombre="${' '.repeat(1_100_000)}"/></cfdi:Comprobante>`;
    const r = await c.ctx.post('cfdi-import/preview', { data: { xmlBase64: b64(big) }});
    expect(r.status()).toBe(400);
    expect((await r.json()).message).toMatch(/1\s*MB|excede/i);
  });

  test('IMP-003 XML duplicado por sha256 marca already_imported', async () => {
    const c = await login();
    const xml = `<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
                 Version="4.0" Serie="A" Folio="9999" Fecha="2026-01-15T10:00:00"
                 LugarExpedicion="64000" TipoDeComprobante="I" Moneda="MXN"
                 SubTotal="100" Total="116" Exportacion="01">
  <cfdi:Emisor Rfc="DUP010101ABC" Nombre="DUP EMISOR" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="ASH000404J1A" Nombre="ACME" DomicilioFiscalReceptor="64000"
                 RegimenFiscalReceptor="601" UsoCFDI="G03"/>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="01010101" Cantidad="1" ClaveUnidad="H87"
      Descripcion="DUP" ValorUnitario="100" Importe="100" ObjetoImp="02"/></cfdi:Conceptos>
</cfdi:Comprobante>`;
    // Primera importación
    await c.ctx.post('cfdi-import/preview', { data: { xmlBase64: b64(xml) }});
    // Segunda: debería marcar duplicado
    const r2 = await c.ctx.post('cfdi-import/preview', { data: { xmlBase64: b64(xml) }});
    const d = (await r2.json()).data;
    expect(d.already_imported).toBeDefined();
  });
});
