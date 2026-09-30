/**
 * Descarga AUTOMÁTICA (local) de la Opinión de Cumplimiento 32-D del SAT y de la
 * Constancia de Situación Fiscal (CSF).
 *
 * Corre EN TU MÁQUINA (no en la nube): tu e.firma nunca sale de tu equipo.
 * Automatiza el flujo oficial del SAT con Playwright y e.firma —NO con CIEC—,
 * justo para EVITAR el CAPTCHA (el acceso con CIEC lo tiene; con e.firma no):
 *   abre el login → cambia a e.firma → RFC + .cer + .key + contraseña → Enviar
 *   → abre el trámite → descarga el PDF → (opcional) lo registra en NEXO.
 *
 * REGLA: si en algún punto aparece un CAPTCHA/clave dinámica, el script se
 * DETIENE y deja captura en ./logs. No se resuelve ni se evade.
 *
 * DISEÑO: como los portales cambian, TODO es configurable en config.json (URLs,
 * selectores, tiempos). Si el SAT mueve un campo, se ajusta el config, no el
 * código. Calibra los selectores con:  node inspeccionar.mjs --portal sat32d
 *
 * Uso:
 *   node descargar-opinion.mjs --tipo SAT            → Opinión 32-D
 *   node descargar-opinion.mjs --tipo CSF            → Constancia de Situación Fiscal
 *   node descargar-opinion.mjs --tipo SAT --asistido → login automático; TÚ navegas al documento y le das
 *                                                      descargar, y el script CAPTURA el PDF y lo sube a NEXO
 *   node descargar-opinion.mjs --tipo SAT --inspect  → solo vuelca el formulario de login (SIN credenciales)
 *
 * La contraseña NUNCA va en el código ni en el config: se lee de la variable de
 * entorno indicada en config.passwordEnv (por defecto SAT_FIEL_PASSWORD).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const MODO_INSPECCION = args.includes('--inspect');
const MODO_ASISTIDO = args.includes('--asistido');
const TIPO = String(flag('--tipo') || 'SAT').toUpperCase();   // SAT (32-D) | CSF

/* ── Config ── */
const cfgPath = path.join(AQUI, 'config.json');
if (!fs.existsSync(cfgPath)) {
  console.error('✗ Falta config.json. Copia config.example.json a config.json y edítalo.');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const sel = cfg.selectors || {};
const tramite = (cfg.tramites || {})[TIPO];
if (!tramite) { console.error(`✗ No hay trámite "${TIPO}" en config.json → tramites (usa SAT o CSF).`); process.exit(1); }
const T = cfg.timeoutMs || 60000;
const logDir = path.join(AQUI, 'logs');
fs.mkdirSync(logDir, { recursive: true });

const ts = () => new Date().toISOString().replace(/[:.]/g, '-');
const log = (...a) => console.log(`[${new Date().toLocaleTimeString('es-MX')}]`, ...a);

/* Localización tolerante: prueba el selector del config y, si no, respaldos por
 * rol/placeholder/tipo. El primero que exista gana. */
async function primero(scope, candidatos) {
  for (const c of candidatos.filter(Boolean)) {
    try {
      const loc = typeof c === 'function' ? c() : scope.locator(c);
      if (await loc.first().count()) return loc.first();
    } catch { /* siguiente */ }
  }
  return null;
}

/* El formulario de e.firma puede vivir en la página o dentro de un iframe. */
async function ambitoDelFormulario(page) {
  if (sel.fielFrame) {
    const el = await page.$(sel.fielFrame);
    const fr = el && (await el.contentFrame());
    if (fr) { await fr.waitForLoadState('domcontentloaded').catch(() => {}); return fr; }
  }
  for (const f of page.frames()) {
    try { if (await f.locator("input[type='file']").count()) return f; } catch { /* sig */ }
  }
  return page;
}

async function detectarCaptcha(scope) {
  try {
    return await scope.evaluate(() =>
      !!document.querySelector('img[src*="captcha" i], input[id*="captcha" i], .g-recaptcha, iframe[src*="recaptcha"]')
      || /captcha|no soy un robot|clave din[aá]mica/i.test(document.body?.innerText || ''));
  } catch { return false; }
}

/** Sentido leído del PDF; si no se puede, VIGENTE para CSF y OTRO para el 32-D. */
async function inferirSentido(pdfPath) {
  try {
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const t = ((await pdfParse(fs.readFileSync(pdfPath)))?.text || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (/positiv/.test(t)) return 'POSITIVA';
    if (/negativ/.test(t)) return 'NEGATIVA';
    if (/sin adeud/.test(t)) return 'SIN_ADEUDOS';
    if (/suspendid/.test(t)) return 'SUSPENDIDA';
    if (/vigente/.test(t)) return 'VIGENTE';
  } catch { /* se cae al default */ }
  return TIPO === 'CSF' ? 'VIGENTE' : 'OTRO';
}

async function main() {
  const password = process.env[cfg.passwordEnv || 'SAT_FIEL_PASSWORD'] || '';
  if (!MODO_INSPECCION) {
    for (const [k, p] of [['cerPath', cfg.cerPath], ['keyPath', cfg.keyPath]]) {
      if (!p || !fs.existsSync(p)) { console.error(`✗ No existe el archivo de ${k}: ${p}`); process.exit(1); }
    }
    if (!password) { console.error(`✗ Falta la contraseña de la e.firma en la variable ${cfg.passwordEnv || 'SAT_FIEL_PASSWORD'}.`); process.exit(1); }
    if (!cfg.rfc) { console.error('✗ Falta el RFC en config.json.'); process.exit(1); }
  }

  const downloadDir = cfg.downloadDir || path.join(AQUI, 'descargas');
  fs.mkdirSync(downloadDir, { recursive: true });

  // Guarda el PDF descargado, infiere el sentido y (opcional) lo registra en NEXO.
  async function guardarYSubir(download) {
    const nombre = `${TIPO}_${cfg.rfc}_${new Date().toISOString().slice(0, 10)}.pdf`;
    const destino = path.join(downloadDir, nombre);
    await download.saveAs(destino);
    log('✔ Documento guardado en:', destino);
    if (cfg.nexo?.enabled) {
      const sentido = await inferirSentido(destino);
      log('Sentido detectado:', sentido);
      await empujarANexo(cfg, destino, sentido).catch((e) => log('⚠ No se pudo registrar en NEXO:', e.message));
    }
    return destino;
  }

  const browser = await chromium.launch({ headless: MODO_INSPECCION ? false : (cfg.headless ?? false) });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(T);

  try {
    const inicioUrl = (MODO_ASISTIDO && tramite.startUrl) ? tramite.startUrl : tramite.loginUrl;
    log(`Abriendo el acceso del SAT (${TIPO})…`, inicioUrl);
    await page.goto(inicioUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: T }).catch(() => {});

    /* ── MODO ASISTIDO (captura pura) ──
     * El script NO toca el login ni la navegación (así no choca contigo ni se
     * queda en el callejón del NIDP). TÚ inicias sesión con e.firma y navegas
     * hasta el documento; en cuanto le des Descargar/Imprimir, atrapa el PDF. */
    if (MODO_ASISTIDO) {
      const espera = cfg.asistidoTimeoutMs || 600000;
      log('— MODO ASISTIDO (captura) — yo NO toco el login; haz esto en la ventana:');
      log('  1) Inicia sesión con tu e.firma (botón e.firma / X.509).');
      log('  2) Navega hasta tu Opinión del Cumplimiento (o CSF) con el botón Descargar/Imprimir.');
      log('  3) Dale descargar: atrapo el PDF y (si activaste nexo) lo subo a NEXO.');
      log(`  Te espero hasta ${Math.round(espera / 1000)}s. NO cierres la ventana.`);
      const download = await page.waitForEvent('download', { timeout: espera });
      await guardarYSubir(download);
      log('✔ Listo.');
      await browser.close();
      return;
    }

    // Cambiar de CIEC a e.firma (evita el CAPTCHA del CIEC).
    if (tramite.botonEfirma) {
      const b = await primero(page, [tramite.botonEfirma, () => page.getByRole('link', { name: /e\.?firma|fiel/i }), () => page.getByRole('button', { name: /e\.?firma|fiel/i })]);
      if (b) { log('Cambiando a e.firma…'); await b.click().catch(() => {}); await page.waitForLoadState('networkidle', { timeout: T }).catch(() => {}); }
    }

    const scope = await ambitoDelFormulario(page);

    if (await detectarCaptcha(page)) {
      const shot = path.join(logDir, `captcha-${ts()}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      throw new Error('Apareció un CAPTCHA / clave dinámica. No se evade. Usa el acceso con e.firma (no CIEC). Captura: ' + shot);
    }

    if (MODO_INSPECCION) {
      const dump = await scope.evaluate(() => ({
        inputs: [...document.querySelectorAll('input')].map((e) => ({ id: e.id, name: e.name, type: e.type, placeholder: e.placeholder, accept: e.getAttribute('accept') })),
        buttons: [...document.querySelectorAll('button, input[type=submit], a.btn')].map((e) => ({ tag: e.tagName, id: e.id, name: e.name, text: (e.innerText || e.value || '').trim().slice(0, 50) })),
      }));
      const outJson = path.join(logDir, `inspeccion-sat-${ts()}.json`);
      fs.writeFileSync(outJson, JSON.stringify(dump, null, 2));
      const outPng = path.join(logDir, `inspeccion-sat-${ts()}.png`);
      await page.screenshot({ path: outPng, fullPage: true });
      log('✔ Inspección lista. Campos del formulario de e.firma:');
      console.log(JSON.stringify(dump, null, 2));
      log('Guardado:', outJson, '·', outPng, '— pásame el JSON y afino los selectores.');
      await browser.close();
      return;
    }

    /* ── Login con e.firma ──
     * En MODO ASISTIDO, si algo del autollenado falla (selectores sin calibrar),
     * NO se aborta: se avisa y tú inicias sesión a mano en la misma ventana. */
    try {
      log('Capturando la e.firma…');
      const files = scope.locator("input[type='file']");
      if (await files.count() < 2) throw new Error(`Esperaba 2 campos de archivo (.cer y .key) y hallé ${await files.count()}. Calibra con --inspect.`);
      await (sel.cer ? scope.locator(sel.cer) : files.nth(cfg.cerIndex ?? 0)).setInputFiles(cfg.cerPath);
      await (sel.key ? scope.locator(sel.key) : files.nth(cfg.keyIndex ?? 1)).setInputFiles(cfg.keyPath);

      const rfc = await primero(scope, [sel.rfc, () => scope.getByPlaceholder(/RFC/i), () => scope.getByRole('textbox', { name: /RFC/i })]);
      if (rfc) await rfc.fill(cfg.rfc).catch(() => {});   // el SAT suele autollenarlo del certificado

      const pass = await primero(scope, [sel.password, () => scope.getByPlaceholder(/contrase/i), "input[type='password']"]);
      if (!pass) throw new Error('No encontré el campo de contraseña de la e.firma. Calibra con --inspect.');
      await pass.fill(password);

      const enviar = await primero(scope, [sel.validar, () => scope.getByRole('button', { name: /enviar|validar|firmar|aceptar/i }), "button[type='submit']", "input[type='submit']"]);
      if (!enviar) throw new Error('No encontré el botón para enviar la e.firma. Calibra con --inspect.');
      log('Enviando la e.firma…');
      await Promise.all([page.waitForLoadState('networkidle', { timeout: T }).catch(() => {}), enviar.click()]);

      if (await detectarCaptcha(page)) throw new Error('Apareció un CAPTCHA tras enviar la e.firma. No se evade.');
    } catch (e) {
      if (!MODO_ASISTIDO) throw e;
      log('⚠ No pude autollenar la e.firma:', e.message);
      log('  Modo asistido: inicia sesión TÚ en la ventana con tu e.firma y sigue al documento.');
    }

    /* ── Abrir el trámite y descargar el documento ──
     * Tres modos, de más automático a más asistido:
     *  1) docUrl : el documento tiene URL directa tras el login → se abre.
     *  2) pasos  : navegación por clics (menú→submenú→generar) definida en config.
     *  3) ASISTIDO: si no hay ruta configurada (o con --asistido), TÚ navegas al
     *     documento en la ventana y le das descargar; el script espera el archivo
     *     y lo captura solo. Es lo que desbloquea el «caigo en una página x».
     */
    let download = null;

    if (!MODO_ASISTIDO && tramite.docUrl) {
      log('Abriendo el trámite…', tramite.docUrl);
      await page.goto(tramite.docUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: T }).catch(() => {});
    }

    if (!MODO_ASISTIDO && Array.isArray(tramite.pasos) && tramite.pasos.length) {
      log('Navegando al documento por los pasos configurados…');
      for (const paso of tramite.pasos) {
        if (paso.wait) { await page.waitForTimeout(paso.wait); continue; }
        if (paso.goto) { await page.goto(paso.goto, { waitUntil: 'domcontentloaded' }); await page.waitForLoadState('networkidle', { timeout: T }).catch(() => {}); continue; }
        if (paso.fill) { const f = await primero(page, [paso.fill.sel]); if (f) await f.fill(String(paso.fill.val ?? '')); continue; }
        if (paso.download) {
          const btn = await primero(page, [paso.download === true ? null : paso.download,
            () => page.getByRole('button', { name: /descargar|generar|imprimir|acuse/i }),
            () => page.getByRole('link', { name: /descargar|generar|imprimir|acuse/i })]);
          if (!btn) throw new Error('No encontré el control de descarga del paso. Revisa config → pasos.');
          [download] = await Promise.all([page.waitForEvent('download', { timeout: T }), btn.click()]);
          continue;
        }
        if (paso.click) {
          const el = await primero(page, [paso.click]);
          if (!el) throw new Error(`No encontré el paso a pulsar: ${paso.click}. Revisa config → pasos.`);
          await Promise.all([page.waitForLoadState('networkidle', { timeout: T }).catch(() => {}), el.click()]);
        }
      }
    }

    // Si aún no hay descarga, intenta un botón de descarga genérico en la página.
    if (!download && !MODO_ASISTIDO) {
      const descargar = await primero(page, [
        sel.descargar,
        () => page.getByRole('button', { name: /descargar|generar|imprimir|acuse/i }),
        () => page.getByRole('link', { name: /descargar|generar|imprimir|acuse/i }),
        "a[href*='pdf']", "[title*='escargar']",
      ]);
      if (descargar) {
        log('Descargando el documento…');
        [download] = await Promise.all([page.waitForEvent('download', { timeout: T }), descargar.click()]);
      }
    }

    // Respaldo: si la navegación automática no bajó nada, espero por si lo descargas tú.
    if (!download) {
      const espera = cfg.asistidoTimeoutMs || 600000;
      log(`No bajé el documento solo. Navega y dale Descargar en la ventana; te espero hasta ${Math.round(espera / 1000)}s…`);
      download = await page.waitForEvent('download', { timeout: espera }).catch(() => null);
    }

    if (!download) throw new Error('No se obtuvo ningún documento. Prueba el modo asistido: --asistido');
    await guardarYSubir(download);

    if (tramite.logoutUrl) await page.goto(tramite.logoutUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
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

/** Registra el PDF en NEXO. Requiere un token en cfg.nexo.tokenEnv (NEXO_TOKEN). */
async function empujarANexo(cfg, pdfPath, sentido) {
  const token = process.env[cfg.nexo.tokenEnv || 'NEXO_TOKEN'];
  if (!token) throw new Error(`Falta el token en la variable ${cfg.nexo.tokenEnv || 'NEXO_TOKEN'}.`);
  const b64 = 'data:application/pdf;base64,' + fs.readFileSync(pdfPath).toString('base64');
  const body = { tipo: TIPO, sentido, fecha_opinion: new Date().toISOString().slice(0, 10), pdf: b64 };
  const r = await fetch(`${cfg.nexo.baseUrl}/api/v1/accounting/opinion-cumplimiento`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`NEXO respondió ${r.status}`);
  log('✔ Registrada en NEXO.');
}

main();
