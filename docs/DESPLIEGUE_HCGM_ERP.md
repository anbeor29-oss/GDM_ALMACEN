# Publicar GDM NEXO en https://hcgm.com.mx/erp/

> Cómo poner el ERP NEXO a vivir en **una subcarpeta `/erp/`** del sitio de hcgm.com.mx.
> El **frontend** (React/Vite) se sube como archivos estáticos al hosting de hcgm.com.mx;
> el **backend** se queda donde está (Render). Ya hay un script hecho para esto:
> `frontend/scripts/build-hosting.mjs` (`npm run build:hosting`).

## Cómo queda

```
hcgm.com.mx/              → sitio actual (lo que ya tienes)
hcgm.com.mx/erp/          → GDM NEXO (SPA estática subida al hosting)
   └── pega por HTTPS →   backend NEXO en Render (no se mueve)
```

## Antes de empezar

1. **Backend de producción = `https://gdm-almacen-backend.onrender.com`** (el despliegue actual
   ES producción). El default de `build:hosting` ya apunta ahí, así que el Paso 1 corre **sin**
   tocar `HOSTING_API_BASE`.
   > El ambiente **PRUEBAS vs PRODUCCIÓN del timbrado NO depende del despliegue**: se controla
   > **por empresa** desde **Súper Admin** (`companies.timbrado_ambiente`). Una sola app en
   > producción atiende empresas en prueba y en real.
2. Ese backend debe permitir el origen **`https://hcgm.com.mx`** en su `CORS_ORIGIN`
   (se agrega en el Paso 3).

---

## Paso 1 — Compilar el frontend para `/erp/`  ·  *en tu PowerShell*

```powershell
cd E:\Obsidian\GDM_NEXO\frontend
# El default ya apunta al backend de producción; corre esto sólo si cambiara:
#   $env:HOSTING_API_BASE = "https://gdm-almacen-backend.onrender.com"
npm run build:hosting
```

Genera **`frontend\dist-hosting\nexo-erp-hosting.zip`**, con una carpeta `erp/` adentro
(`index.html` + `.htaccess` + `assets/`). El build ya quedó con base `/erp/` y la API correcta.

## Paso 2 — Subir al hosting  ·  *cPanel de hcgm.com.mx (navegador)*

- cPanel → **Administrador de archivos** → carpeta `public_html`.
- Sube el ZIP y **descomprímelo ahí**, de modo que quede **`public_html/erp/`** con
  `index.html`, `.htaccess` y `assets/` adentro.
  (Por FTP: sube el **contenido** de la carpeta `erp/` del ZIP a `public_html/erp/`.)
- El `.htaccess` ya trae el *fallback* de SPA para subcarpeta (Apache/LiteSpeed con `mod_rewrite`,
  que traen casi todos los hosting MX).

## Paso 3 — Permitir el origen en el backend  ·  *Render (navegador)*

- Render → servicio **backend de PRODUCCIÓN** → **Environment** → variable `CORS_ORIGIN`:
  agrega `https://hcgm.com.mx` (y `https://www.hcgm.com.mx`), separados por coma. Ej.:
  ```
  https://gdm-almacen-frontend.onrender.com,https://hcgm.com.mx,https://www.hcgm.com.mx
  ```
- Guarda → Render redepliega el backend solo (segundos).

## Paso 4 — Probar

- Abre **https://hcgm.com.mx/erp/** → debe cargar NEXO y el login.
- En **DevTools → Network**, las llamadas van a `…/api/v1/…` del backend y responden **200**
  (si ves error de **CORS**, revisa el Paso 3; si ves **404** en rutas internas al recargar,
  revisa que el `.htaccess` haya subido).

## Paso 5 — Renombrar el enlace del sitio principal  ·  *sitio hcgm.com.mx*

En el menú/botón del sitio que hoy dice **"Factura electrónica"**:
- Cambia el **texto** a **"NEXO"**.
- Cambia el **enlace** (`href`) a **`https://hcgm.com.mx/erp/`**.

El código del sitio **ya no está** en `D:\Obsidian\PAGINA A SUBIR\` (se quitó). Se edita donde
administres hcgm.com.mx hoy: el `index.html` en `public_html` (cPanel → Administrador de archivos),
o tu CMS. **Si me pasas ese archivo, hago el cambio yo.**

---

## Flujo de cambios (cómo publicar una modificación)

El cambio se hace en el **código** (local), **no "en Render"**: Render sólo publica lo que subes por git.

1. Haz el cambio en el código y **push**: `git push gdmalmacen erp-unificado:main`.
   → Render redepliega **solo** el **backend** y el frontend **`gdm-almacen-frontend.onrender.com`**.
   Ahí lo revisas (se actualiza automático; es tu vista "recién subida").
2. Para reflejarlo en **`hcgm.com.mx/erp/`**: `npm run build:hosting` + **re-subir** el ZIP a `public_html/erp`.
   Ese paso es **manual**: `/erp` NO se actualiza solo.

Según qué tocaste:
- **Backend** (API, lógica, BD) → con el **push basta**: aplica a las DOS URLs a la vez (ambas pegan al mismo
  backend). **No** re-subes nada a cPanel.
- **Frontend** (pantallas) → **push** (actualiza la URL de Render) **y** `build:hosting` + re-subir (para `/erp`).

> **Ojo (ambiente único):** hoy el push afecta de inmediato al backend que usan AMBAS URLs — es tu producción. Si
> quieres un ambiente de **pruebas separado** del real (para experimentar sin tocar lo vivo), ese es el esquema de
> 2 ramas (`main`=dev / `produccion`) de `DESPLIEGUE.md`: creas un 2º servicio de Render y apuntas `/erp` a producción.

## Alternativa: subdominio `erp.hcgm.com.mx`

Si algún día prefieres un subdominio en vez de subcarpeta: CNAME `erp` → el frontend de Render y
Custom Domain en Render (guía en `RESPALDO.md`). Pero lo que pediste es `/erp/`, que es lo de arriba
y **no requiere tocar DNS**.
