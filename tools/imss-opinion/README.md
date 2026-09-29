# Opinión IMSS 32-D — descarga automática (local)

Automatiza el flujo oficial del **Buzón IMSS** para bajar tu **Opinión de Cumplimiento 32-D**
(seguridad social): entra con tu **e.firma**, abre *32D Consultar Mi Opinión*, descarga el PDF y
cierra sesión. Opcionalmente la **registra en NEXO**.

## Por qué es LOCAL (no en la nube)
Corre en **tu máquina**. Tu **e.firma (.cer + .key) y su contraseña nunca salen de tu equipo** ni
tocan Render. Es lo más seguro: automatizamos el trámite sin subir tus llaves a ningún servidor.

## Requisitos
- **Node.js 18+** (trae `fetch` nativo).
- Tu **e.firma vigente**: los archivos `.cer` y `.key`, y su contraseña.

## Instalación (una vez)
```bash
cd tools/imss-opinion
npm install            # instala Playwright y su navegador (Chromium)
copy config.example.json config.json   # (Windows)   ·   cp en Mac/Linux
```
Edita `config.json`:
- `rfc`, `cerPath`, `keyPath`, `downloadDir` con tus rutas reales.
- **La contraseña NO va en el archivo.** Se lee de una variable de entorno.

## Correr
Pon la contraseña de tu e.firma en la variable de entorno y ejecuta:

**PowerShell (Windows):**
```powershell
$env:IMSS_FIEL_PASSWORD = "TU-CONTRASEÑA-EFIRMA"
npm start
```
**Mac/Linux:**
```bash
IMSS_FIEL_PASSWORD='TU-CONTRASEÑA-EFIRMA' npm start
```
El PDF queda en `downloadDir` como `MiOpinion_<RFC>_<fecha>.pdf`. Con `headless: false` (por
defecto) verás el navegador trabajar; ponlo en `true` para que corra sin ventana.

## Calibrar si el IMSS cambia el portal
El login de la FIEL vive en un **iframe** (`#formFirmaDigital`) que **no pudimos inspeccionar por
dentro** al construir esto (es de otro dominio), así que los campos del iframe usan **respaldos
automáticos**. Si algo no lo encuentra, corre el modo inspección **(no usa tu contraseña)**:
```bash
npm run inspect
```
Deja en `logs/` un **JSON con los campos del iframe** y una **captura**. Pásamelos (o pega los
`id`/`name`/`placeholder`) y te dejo los `selectors` exactos en el `config.json`. Ante cualquier
fallo del flujo completo también se guarda una captura `logs/error-*.png` para calibrar.

## Programarlo (diario)
La opinión IMSS **vale solo el día que se consulta** (vence a las 23:59). Para tenerla al día,
prográmalo con el **Programador de tareas de Windows**:
1. Crea un `.bat`:
   ```bat
   @echo off
   set IMSS_FIEL_PASSWORD=TU-CONTRASEÑA-EFIRMA
   cd /d C:\ruta\a\tools\imss-opinion
   node descargar-opinion.mjs
   ```
   (Guárdalo en un lugar privado; contiene la contraseña.)
2. Programador de tareas → Crear tarea → Desencadenador diario → Acción: iniciar ese `.bat`.

## Registrar en NEXO automáticamente (opcional)
Pon `nexo.enabled: true` en `config.json` y una variable `NEXO_TOKEN` con un token válido de tu
sesión NEXO. Al terminar la descarga, el script hace `POST /api/v1/accounting/opinion-cumplimiento`
y la registra como *IMSS · Positiva* del día, con su PDF. (Mientras no tengas token, déjalo en
`false` y sube el PDF a mano con el botón «Registrar» de NEXO.)

## Otros portales (SAT 32-D, CSF) — ojo con el CAPTCHA
El **login del SAT por CIEC** (RFC + contraseña) trae **CAPTCHA** y **clave dinámica (2FA)**:
un CAPTCHA existe para frenar robots y **no se resuelve ni se evade** — ese camino **no se
automatiza**. El SAT también ofrece **e.firma**; si ese camino NO tiene CAPTCHA, se puede automatizar
igual que el IMSS. Para saberlo, usa el **inspector** (no usa credenciales, solo mira la página):
```bash
node inspeccionar.mjs "https://url-del-login-del-sat"
node inspeccionar.mjs "https://url-del-login" --click "#buttonFiel"   # para pasar a e.firma y reinspeccionar
```
Te dice si hay CAPTCHA y anota los campos. Pásame ese JSON y armo el trámite del SAT. Si el camino de
e.firma del SAT también trae anti-bot, se queda como **asistente guiado** (abrir portal + pasos +
registrar), no como automatización.

## Seguridad
- La contraseña se lee de una **variable de entorno**, nunca del código ni del `config.json`.
- `config.json`, `*.cer`, `*.key`, `logs/` y `descargas/` están en `.gitignore`: **no se suben al repo.**
- Uso responsable: es tu propia cuenta y tu propia opinión (trámite gratuito del IMSS). No evade
  CAPTCHA ni MFA; si algún día el portal los pide, el script se detiene y deja la captura para que
  completes el paso a mano.
