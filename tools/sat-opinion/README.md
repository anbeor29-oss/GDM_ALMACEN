# Descarga local — Opinión 32-D del SAT y CSF (con e.firma)

Herramienta que corre **EN TU MÁQUINA** (tu PowerShell, **no** el Web Shell de Render).
Tu e.firma **nunca sale de tu equipo**. Automatiza el acceso al SAT **con e.firma
(no con CIEC)** justamente para **evitar el CAPTCHA**, abre el trámite y descarga el PDF.
Si aparece un CAPTCHA, se **detiene** — no se evade.

## 1. Instalar (una vez)

En **tu PowerShell**:

```bash
cd E:\Obsidian\GDM_NEXO\tools\sat-opinion
npm install
```

(El `postinstall` baja el navegador de Playwright.)

## 2. Configurar

```bash
copy config.example.json config.json
```

Edita `config.json`:
- `rfc`, `cerPath`, `keyPath` → tu RFC y las rutas reales de tu `.cer` y `.key`.
- La **contraseña NO va en el archivo**. Ponla en una variable de entorno antes de correr:
  ```bash
  $env:SAT_FIEL_PASSWORD = "tu-contraseña-de-la-e.firma"
  ```

## 3. Calibrar los selectores (una vez, o si el SAT cambia)

El portal del SAT cambia; por eso los selectores se **descubren**, no se adivinan:

```bash
npm run inspect:sat32d
```

Se abre el login, se cambia a e.firma y se vuelca el formulario (campos y botones)
a `./logs`, y **avisa si hay CAPTCHA**. Pásame ese JSON y afino `selectors` +
`tramites.SAT.docUrl` (la página del documento) en tu `config.json`.
Para la constancia: `npm run inspect:csf`.

## 4. Descargar

```bash
npm run sat      # Opinión de Cumplimiento 32-D
npm run csf      # Constancia de Situación Fiscal
```

El PDF queda en tu `downloadDir`. Ábrelo o cárgalo a NEXO
(Contabilidad → Opinión de Cumplimiento → registrar).

## 5. (Opcional) Registrar en NEXO automáticamente

En `config.json` pon `nexo.enabled: true` y un token en la variable `NEXO_TOKEN`.
Al terminar la descarga, el PDF se registra en NEXO con el **sentido leído del propio
documento** (Positiva/Negativa/Vigente…); si no se puede leer, queda como *OTRO* / *VIGENTE*
para que lo confirmes en la pantalla.

---

**Reglas:** nunca se resuelve ni se evade un CAPTCHA; la contraseña y la e.firma nunca
se registran ni salen de tu equipo; si el flujo falla, deja una captura en `./logs` para
calibrar. Esta herramienta es el **camino asistido con e.firma** del motor de cumplimiento
de NEXO (ver `docs/NEXO_COMPLIANCE_API_PLAN.md`).
