# Colgar el ERP en hcgm.com.mx vía ZIP (cPanel) + activar PAC producción

Dos procedimientos:
- **Parte A**: servir el frontend del ERP desde `https://hcgm.com.mx/erp`
  subiendo un ZIP al hosting (sin tocar DNS ni Render frontend).
- **Parte B**: conectar el PAC en modo PRODUCCIÓN para usar los timbres
  reales contratados con SW Sapien.

---

## Parte A — Frontend en hcgm.com.mx/erp

### Arquitectura

```
Navegador ──► hcgm.com.mx/erp        (Hosting México: archivos estáticos del ZIP)
                   │ fetch /api/v1/…
                   ▼
              gdmfac-backend.onrender.com   (backend + BD siguen en Render)
```

El hosting solo sirve los archivos del frontend. El backend, la BD y el PAC
siguen en Render — nada de eso se mueve.

### Paso 1 — Generar el ZIP

En tu PowerShell:

```powershell
cd C:\Users\EQ-7\GDM_FAC\frontend
npm run build:hosting
```

Salida: `frontend/dist-hosting/gdmfac-erp-hosting.zip` (~1 MB).

El ZIP contiene la carpeta `erp/` con:
- `index.html` compilado con `base=/erp/` y `VITE_API_BASE` apuntando al backend Render.
- `.htaccess` con el fallback SPA (cualquier ruta → index.html) y cache de assets.
- `assets/` con JS/CSS versionados.

> Para otro path o backend:
> `HOSTING_BASE_PATH=/facturacion/ HOSTING_API_BASE=https://api.hcgm.com.mx npm run build:hosting`

### Paso 2 — Subir a cPanel

1. Entra a cPanel de Hosting México → **Administrador de archivos** (File Manager).
2. Navega a **`public_html/`** (la raíz del sitio).
3. Botón **Cargar** (Upload) → sube `gdmfac-erp-hosting.zip`.
4. De regreso en File Manager, click derecho sobre el ZIP → **Extract**.
   - Debe quedar `public_html/erp/index.html`, `public_html/erp/.htaccess`, etc.
5. Borra el ZIP (limpieza).

> ⚠ Si File Manager no muestra `.htaccess`, activa **Settings → Show Hidden
> Files (dotfiles)** en la esquina superior derecha.

### Paso 3 — CORS en Render

El backend debe aceptar peticiones del nuevo origen:

1. Render → `gdmfac-backend` → **Environment**.
2. Edita `CORS_ORIGIN` para que incluya ambos (separados por coma, sin espacios):
   ```
   https://hcgm.com.mx,https://gdmfac-frontend.onrender.com
   ```
3. Save Changes (reinicia solo, ~1 min).

> Si el sitio corre en `https://www.hcgm.com.mx` (con www), agrega TAMBIÉN ese
> origen: el CORS compara el string exacto.

### Paso 4 — Verificar

1. Abre **https://hcgm.com.mx/erp** en incógnito.
2. Debe cargar la landing pública del ERP.
3. Login → dashboard → abre DevTools → Network: las llamadas van a
   `gdmfac-backend.onrender.com/api/v1/…` y responden 200.
4. Navega a una ruta profunda (ej. `/erp/invoices`) y refresca (F5) — debe
   recargar la app, no un 404 del hosting (eso valida el `.htaccess`).

### Paso 5 — Menú en el sitio corporativo

En el sitio de hcgm.com.mx (WordPress u otro CMS), agrega el elemento de menú:

- **Texto**: `Facturación` (o `ERP`)
- **URL**: `https://hcgm.com.mx/erp/`
- **Abrir en**: misma pestaña o nueva, a gusto

### Actualizaciones futuras

Cada vez que el frontend cambie:

```powershell
cd C:\Users\EQ-7\GDM_FAC\frontend
npm run build:hosting
# → subir el nuevo ZIP a cPanel y extraer encima (sobrescribe)
```

> El deploy de Render sigue siendo automático con cada push; el del hosting
> es manual con el ZIP. Ambos frontends pueden convivir mientras migras.

---

## Parte B — PAC en PRODUCCIÓN (timbres reales)

El código ya soporta producción sin cambios (el guardrail de RFC de prueba
solo aplica en sandbox). Es pura configuración:

### Requisitos previos

- [ ] Contrato/paquete de timbres de **producción** activo con SW Sapien.
- [ ] Acceso al panel de **producción**: https://portal.sw.com.mx (el sandbox
      es un portal distinto).
- [ ] CSD **real** (.cer + .key + contraseña) de cada empresa emisora, vigente.

### Paso 1 — Token de producción

1. Portal SW **producción** → Configuración → Tokens → crear token
   (`GDMFAC-Prod`).
2. Copia el JWT completo (3 bloques separados por 2 puntos, sin espacios).

### Paso 2 — CSDs reales al vault de producción

Por **cada empresa emisora real** (las 2 que vas a dar de alta):

1. Portal SW producción → **Emisores / Certificados** → cargar `.cer` + `.key`
   + contraseña del CSD.
2. Verifica que el RFC aparezca como "activo" en su vault.

> Sin este paso el timbrado rebota: SW no puede sellar sin el CSD del emisor.

### Paso 3 — Variables en Render

Render → `gdmfac-backend` → Environment:

| Variable | Valor nuevo |
|---|---|
| `SW_SAPIEN_ENV` | `production` |
| `SW_SAPIEN_TOKEN` | el JWT de producción del Paso 1 |

Save Changes → espera el reinicio.

### Paso 4 — Alta de las empresas reales en el ERP

1. SUPER_ADMIN → Empresas → **Nueva empresa** → botón "Leer CIF" con la
   Constancia de Situación Fiscal real.
2. Sube el CSD también en el ERP (respaldo cifrado local + validación de
   vigencia).
3. Asigna plan y usuarios.

### Paso 5 — Prueba controlada (¡esto ya es dinero real!)

⚠ En producción **cada timbre consume saldo y el CFDI llega al SAT de
verdad**. Para la primera prueba:

1. Emite una factura **de monto pequeño** a un RFC propio o de un tercero
   que haya aceptado la prueba (ej. $1.00 + IVA).
2. Verifica: UUID real + QR válido en
   https://verificacfdi.facturaelectronica.sat.gob.mx (ahora SÍ debe aparecer,
   a diferencia del sandbox).
3. Cancela esa factura de prueba (motivo 02) — en producción el vault es
   estable y la cancelación procede sin el bug 404 del sandbox.
4. Confirma en el portal SW producción que el timbre se consumió y la
   cancelación se registró.

### Paso 6 — Facturación de la plataforma (opcional pero recomendado)

Si vas a usar el módulo de Facturación y Consumo con clientes reales:

| Variable | Valor |
|---|---|
| `PLATFORM_COMPANY_RFC` | RFC real de GRUPOHCGM |
| `ENABLE_BILLING_CRON` | `true` |

Con esto el día 1 de cada mes el sistema cierra el mes, emite los CFDIs de
cobro con timbres reales y los envía por correo.

### Rollback a sandbox

Si algo sale mal, en Render basta con volver a:
```
SW_SAPIEN_ENV=sandbox
SW_SAPIEN_TOKEN=<token sandbox>
```
El guardrail de EKU9003173C9 se reactiva solo.

---

## Checklist combinado

**Parte A (hosting)**
- [ ] `npm run build:hosting` genera el ZIP
- [ ] ZIP subido y extraído en `public_html/erp/`
- [ ] `.htaccess` visible en la carpeta
- [ ] `CORS_ORIGIN` incluye `https://hcgm.com.mx` (y `www.` si aplica)
- [ ] `https://hcgm.com.mx/erp` carga y el login funciona
- [ ] F5 en ruta profunda no da 404
- [ ] Menú "Facturación" agregado al sitio corporativo

**Parte B (PAC producción)**
- [ ] Token de producción generado
- [ ] CSDs reales cargados al vault SW producción
- [ ] `SW_SAPIEN_ENV=production` + token en Render
- [ ] Empresas reales dadas de alta con CIF + CSD
- [ ] Factura de prueba $1 timbrada y verificada en el portal SAT
- [ ] Cancelación de la prueba procesada
- [ ] (Opcional) `PLATFORM_COMPANY_RFC` + `ENABLE_BILLING_CRON=true`
