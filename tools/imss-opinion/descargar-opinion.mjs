/**
 * Descarga AUTOMÁTICA (local) de la Opinión de Cumplimiento IMSS 32-D.
 *
 * Corre EN TU MÁQUINA (no en la nube): tu e.firma nunca sale de tu equipo.
 * Automatiza el flujo oficial del Buzón IMSS con Playwright:
 *   login con e.firma (RFC + .cer + .key + contraseña, en el iframe de la FIEL)
 *   → 32-D Consultar Mi Opinión → descargar el PDF → cerrar sesión.
 *
 * DISEÑO: como los portales cambian, TODO es configurable en config.json
 * (URLs, selectores, tiempos). Si el IMSS mueve un campo, se ajusta el config,
 * no el código. Ante cualquier fallo deja una captura en ./logs para calibrar.
 *
 * Uso:
 *   node descargar-opinion.mjs            → corre el flujo completo
 *   node descargar-opinion.mjs --inspect  → solo abre el login y VUELCA los
 *                                           campos del iframe de la FIEL + captura,
 *                                           para calibrar selectores (SIN credenciales)
 *
 * La contraseña NUNCA va en el código ni en el config: se lee de la variable de
 * entorno indicada en config.passwordEnv (por defecto IMSS_FIEL_PASSWORD).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MODO_INSPECCION = process.argv.includes('--inspect');

/* ── Config ── */
const cfgPath = path.join(AQUI, 'config.json');
if (!fs.existsSync(cfgPath)) {
  console.error('✗ Falta config.json. Copia config.example.json a config.json y edítalo.');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const sel = cfg.selectors || {};
const urls = cfg.urls || {};
const T = cfg.timeoutMs || 45000;
const logDir = path.join(AQUI, 'logs');
fs.mkdirSync(logDir, { recursive: true });

const ts = () => new Date().toISOString().replace(/[:.]/g, '-');
const log = (...a) => console.log(`[${new Date().toLocaleTimeString('es-MX')}]`, ...a);

/* ── Localización tolerante: prueba el selector del config y, si no, una cadena
 *    de respaldos por rol/placeholder/tipo. El primero que exista gana. */
async function primero(scope, candidatos) {
  for (const c of candidatos.filter(Boolean)) {
    try {
      const loc = typeof c === 'function' ? c() : scope.locator(c);
      if (await loc.first().count()) return loc.first();
    } catch { /* siguiente */ }
  }
  return null;
}

async function main() {
  const password = process.env[cfg.passwordEnv || 'IMSS_FIEL_PASSWORD'] || '';
  if (!MODO_INSPECCION) {
    for (const [k, p] of [['cerPath', cfg.cerPath], ['keyPath', cfg.keyPath]]) {
      if (!p || !fs.existsSync(p)) { console.error(`✗ No existe el archivo de ${k}: ${p}`); process.exit(1); }
    }
    if (!password) { console.error(`✗ Falta la contraseña de la e.firma en la variable ${cfg.passwordEnv || 'IMSS_FIEL_PASSWORD'}.`); process.exit(1); }
    if (!cfg.rfc) { console.error('✗ Falta el RFC en config.json.'); process.exit(1); }
  }

  const downloadDir = cfg.downloadDir || path.join(AQUI, 'descargas');
  fs.mkdirSync(downloadDir, { recursive: true });

  const browser = await chromium.launch({ headless: MODO_INSPECCION ? false : (cfg.headless ?? false) });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(T);

  try {
    log('Abriendo el Buzón IMSS…', urls.login);
    await page.goto(urls.login || 'https://buzon.imss.gob.mx/buzonimss/login', { waitUntil: 'domcontentloaded' });

    // El formulario de la FIEL vive en un iframe (por defecto #formFirmaDigital).
    const frameSel = sel.fielFrame || '#formFirmaDigital';
    await page.waitForSelector(frameSel, { timeout: T });
    const frameEl = await page.$(frameSel);
    const frame = await frameEl.contentFrame();
    if (!frame) throw new Error(`No se pudo entrar al iframe de la FIEL (${frameSel}).`);
    await frame.waitForLoadState('domcontentloaded').catch(() => {});
    await frame.waitForSelector('input, button', { timeout: T }).catch(() => {});

    if (MODO_INSPECCION) {
      const dump = await frame.evaluate(() => ({
        inputs: [...document.querySelectorAll('input')].map((e) => ({ id: e.id, name: e.name, type: e.type, placeholder: e.placeholder, accept: e.getAttribute('accept') })),
        buttons: [...document.querySelectorAll('button, input[type=submit]')].map((e) => ({ tag: e.tagName, id: e.id, name: e.name, text: (e.innerText || e.value || '').trim().slice(0, 40) })),
      }));
      const outJson = path.join(logDir, `inspeccion-fiel-${ts()}.json`);
      fs.writeFileSync(outJson, JSON.stringify(dump, null, 2));
      const outPng = path.join(logDir, `inspeccion-fiel-${ts()}.png`);
      await page.screenshot({ path: outPng, fullPage: true });
      log('✔ Inspección lista. Campos del iframe FIEL:');
      console.log(JSON.stringify(dump, null, 2));
      log('Guardado:', outJson, '·', outPng);
      log('Pásame ese JSON/captura y afino los selectores de config.example.json.');
      await browser.close();
      return;
    }

    /* ── Login con e.firma ── */
    log('Capturando la e.firma…');
    const rfc = await primero(frame, [
      sel.rfc,
      () => frame.getByRole('textbox', { name: /RFC/i }),
      () => frame.getByPlaceholder(/RFC/i),
      "input[type='text']",
    ]);
    if (!rfc) throw new Error('No encontré el campo RFC en el iframe FIEL. Corre con --inspect para calibrar.');
    await rfc.fill(cfg.rfc);

    const files = frame.locator("input[type='file']");
    const nFiles = await files.count();
    if (nFiles < 2) throw new Error(`Esperaba 2 campos de archivo (.cer y .key) y hallé ${nFiles}. Calibra con --inspect.`);
    await (sel.cer ? frame.locator(sel.cer) : files.nth(cfg.cerIndex ?? 0)).setInputFiles(cfg.cerPath);
    await (sel.key ? frame.locator(sel.key) : files.nth(cfg.keyIndex ?? 1)).setInputFiles(cfg.keyPath);

    const pass = await primero(frame, [sel.password, () => frame.getByPlaceholder(/contrase/i), "input[type='password']"]);
    if (!pass) throw new Error('No encontré el campo de contraseña de la e.firma. Calibra con --inspect.');
    await pass.fill(password);

    const validar = await primero(frame, [
      sel.validar,
      () => frame.getByRole('button', { name: /validar/i }),
      "button:has-text('Validar')",
      "input[type='submit']",
    ]);
    if (!validar) throw new Error('No encontré el botón «Validar». Calibra con --inspect.');
    log('Validando…');
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: T }).catch(() => {}),
      validar.click(),
    ]);
    await page.waitForFunction(() => !/\/login$/.test(location.pathname), { timeout: T })
      .catch(() => { throw new Error('El login no avanzó (¿RFC/e.firma/contraseña o CAPTCHA?). Revisa la captura en ./logs.'); });
    log('✔ Sesión iniciada.');

    /* ── 32-D Consultar Mi Opinión ── */
    log('Abriendo 32-D Consultar Mi Opinión…');
    await page.goto(urls.opinion32d || 'https://buzon.imss.gob.mx/buzonimss/opinionCumplimiento/consultaMiOpinion', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: T }).catch(() => {});

    const descargar = await primero(page, [
      sel.descargar,
      "a:has(.glyphicon-download)",
      ".glyphicon-download",
      "i.fa-download",
      "[title*='escargar']",
      "a[href*='escargar']",
    ]);
    if (!descargar) throw new Error('No encontré el ícono de descarga de la opinión. Calibra el selector selectors.descargar.');

    log('Descargando la opinión…');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: T }),
      descargar.click(),
    ]);
    const nombre = `MiOpinion_${cfg.rfc}_${new Date().toISOString().slice(0, 10)}.pdf`;
    const destino = path.join(downloadDir, nombre);
    await download.saveAs(destino);
    log('✔ Opinión guardada en:', destino);

    /* ── (opcional) Empujar a NEXO ── */
    if (cfg.nexo?.enabled) {
      await empujarANexo(cfg, destino).catch((e) => log('⚠ No se pudo registrar en NEXO:', e.message));
    }

    /* ── Cerrar sesión ── */
    if (urls.logout) { await page.goto(urls.logout, { waitUntil: 'domcontentloaded' }).catch(() => {}); }
    log('✔ Listo.');
    await browser.close();
  } catch (e) {
    const shot = path.join(logDir, `error-${ts()}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    console.error('✗ Falló:', e.message);
    console.error('  Captura para calibrar:', shot);
    await browser.close();
    process.exit(1);
  }
}

/** Registra el PDF en NEXO (opcional). Requiere un token en cfg.nexo.tokenEnv. */
async function empujarANexo(cfg, pdfPath) {
  const token = process.env[cfg.nexo.tokenEnv || 'NEXO_TOKEN'];
  if (!token) throw new Error(`Falta el token en la variable ${cfg.nexo.tokenEnv || 'NEXO_TOKEN'}.`);
  const b64 = 'data:application/pdf;base64,' + fs.readFileSync(pdfPath).toString('base64');
  const body = {
    tipo: 'IMSS', sentido: 'POSITIVA',
    fecha_opinion: new Date().toISOString().slice(0, 10),
    pdf: b64,
  };
  const r = await fetch(`${cfg.nexo.baseUrl}/api/v1/accounting/opinion-cumplimiento`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`NEXO respondió ${r.status}`);
  log('✔ Registrada en NEXO.');
}

main();
