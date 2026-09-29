/**
 * Inspector GENERAL de páginas de login — para calibrar el portal del SAT
 * (e.firma 32-D, CSF) antes de automatizarlo.
 *
 * NO usa credenciales: solo abre la URL, anota los campos (inputs/botones/iframes)
 * y DETECTA si hay CAPTCHA. Si hay CAPTCHA, ese camino NO se automatiza (no se
 * resuelven ni se evaden — es la regla). Guarda un JSON + captura en ./logs.
 *
 * Uso:
 *   node inspeccionar.mjs --portal sat32d      (lee la URL de config.json → portales; EVITA pegar la URL)
 *   node inspeccionar.mjs --portal csf --click "#buttonFiel"   (pulsa e.firma y reinspecciona)
 *   node inspeccionar.mjs "https://url-del-login" [--frame "#idIframe"] [--click "#boton"]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.join(AQUI, 'logs');
fs.mkdirSync(logDir, { recursive: true });
const ts = () => new Date().toISOString().replace(/[:.]/g, '-');

const args = process.argv.slice(2);
function flag(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
let url = args.find((a) => /^https?:\/\//.test(a));
let frameSel = flag('--frame');
let clickSel = flag('--click');

// --portal <nombre>: toma la URL (y click/frame) de config.json → portales,
// para no pegar URLs enormes con & en la terminal (PowerShell las rompe).
const portalName = flag('--portal');
if (portalName) {
  const cfgPath = path.join(AQUI, 'config.json');
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
  const p = (cfg.portales || {})[portalName];
  if (!p || !p.url) { console.error(`No hay portal "${portalName}" con url en config.json → portales.`); process.exit(1); }
  url = p.url; clickSel = clickSel || p.click || null; frameSel = frameSel || p.frame || null;
}

if (!url) {
  console.error('Uso: node inspeccionar.mjs --portal <nombre>  |  node inspeccionar.mjs "https://url" [--frame "#iframe"] [--click "#boton"]');
  process.exit(1);
}

const VOLCADO = () => ({
  inputs: [...document.querySelectorAll('input')].map((e) => ({ id: e.id, name: e.name, type: e.type, placeholder: e.placeholder, accept: e.getAttribute('accept') })),
  buttons: [...document.querySelectorAll('button, input[type=submit], a.btn')].map((e) => ({ tag: e.tagName, id: e.id, name: e.name, text: (e.innerText || e.value || '').trim().slice(0, 50) })),
  iframes: [...document.querySelectorAll('iframe')].map((f) => ({ id: f.id, name: f.name, src: f.src })),
  captcha: {
    imagen: !!document.querySelector('img[src*="captcha" i], img[id*="captcha" i], input[id*="captcha" i], input[name*="captcha" i]'),
    recaptcha: !!document.querySelector('.g-recaptcha, iframe[src*="recaptcha"]'),
    texto: /captcha|no soy un robot|escribe.*(palabra|imagen)|clave dinámica/i.test(document.body.innerText),
  },
});

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
page.setDefaultTimeout(45000);
try {
  console.log('Abriendo', url);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  if (clickSel) {
    console.log('Pulsando', clickSel, '…');
    await page.click(clickSel).catch((e) => console.log('  (no se pudo pulsar:', e.message, ')'));
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  const scope = frameSel ? await (await page.$(frameSel))?.contentFrame() : page;
  if (frameSel && !scope) throw new Error(`No se pudo entrar al iframe ${frameSel}.`);
  const dump = await scope.evaluate(VOLCADO);

  const outJson = path.join(logDir, `inspeccion-${ts()}.json`);
  fs.writeFileSync(outJson, JSON.stringify({ url, frame: frameSel || null, ...dump }, null, 2));
  const outPng = path.join(logDir, `inspeccion-${ts()}.png`);
  await page.screenshot({ path: outPng, fullPage: true });

  console.log(JSON.stringify(dump, null, 2));
  if (dump.captcha.imagen || dump.captcha.recaptcha || dump.captcha.texto) {
    console.log('\n⚠ Parece haber CAPTCHA / clave dinámica en esta página → ese camino NO se puede automatizar. Usa el acceso con e.firma.');
  } else {
    console.log('\n✔ No detecté CAPTCHA aquí. Pásame este JSON y armo los selectores.');
  }
  console.log('Guardado:', outJson, '·', outPng);
} catch (e) {
  console.error('✗ Falló:', e.message);
} finally {
  await browser.close();
}
