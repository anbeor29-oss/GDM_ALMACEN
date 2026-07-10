# Colgar el ERP de un subdominio de hcgm.com.mx

Guía paso a paso para migrar el ERP de las URLs `.onrender.com` a un
subdominio propio bajo `hcgm.com.mx`. No requiere mover el hosting ni
cambiar el DNS principal del dominio corporativo.

## Resumen visual

```
┌──────────────────────────────────────────┐
│  hcgm.com.mx  (Hosting México, cPanel)   │
│    ├── www.hcgm.com.mx     → sitio corp  │
│    ├── erp.hcgm.com.mx     → Render      │  ← nuevo
│    ├── api.hcgm.com.mx     → Render      │  ← nuevo
│    └── facturas@hcgm.com.mx (SMTP)       │
└──────────────────────────────────────────┘
                    │
                    │  CNAME
                    ▼
┌──────────────────────────────────────────┐
│  Render.com                              │
│    ├── gdmfac-frontend.onrender.com      │
│    └── gdmfac-backend.onrender.com       │
└──────────────────────────────────────────┘
```

## Decisión: qué subdominios usar

Recomiendo **dos subdominios** (más limpio para SEO, CORS y auditoría):

| Subdominio | Apunta a | Uso |
|---|---|---|
| `erp.hcgm.com.mx` | Frontend Render (static) | UI del ERP — lo que ven los usuarios |
| `api.hcgm.com.mx` | Backend Render (Node) | Endpoints REST — lo que consume el frontend |

Alternativa más simple con **un solo subdominio** (`erp.hcgm.com.mx`) usando
rewrite del static site para proxear `/api/*` al backend. Es menos limpio y
Render Static no soporta rewrites; requeriría cambiar el frontend a un
servicio Node o incluir Cloudflare/Netlify por delante. **No recomendado**.

Aquí voy con la ruta de **dos subdominios**.

---

## Paso 1 — En Render (agregar los dominios custom)

### Frontend

1. Entra a **dashboard.render.com** → tu servicio `gdmfac-frontend` (Static Site).
2. Pestaña **Settings** → sección **Custom Domains** → **Add Custom Domain**.
3. Escribe `erp.hcgm.com.mx` → **Save**.
4. Render te muestra el registro DNS que debes crear en tu registrador. Copia el valor. Suele ser:
   ```
   Type:   CNAME
   Name:   erp
   Value:  gdmfac-frontend.onrender.com
   TTL:    Automático (300s)
   ```

### Backend

1. Selecciona `gdmfac-backend` (Web Service).
2. **Settings → Custom Domains → Add Custom Domain**.
3. Escribe `api.hcgm.com.mx` → **Save**.
4. Render te muestra el CNAME. Copia el valor:
   ```
   Type:   CNAME
   Name:   api
   Value:  gdmfac-backend.onrender.com
   TTL:    Automático (300s)
   ```

Deja Render abierto — vas a volver a validar cuando el DNS propague.

---

## Paso 2 — En Hosting México (crear los CNAME)

1. Entra a tu panel de cliente en **[clientes.hostingmexico.com](https://clientes.hostingmexico.com/)** → tu dominio `hcgm.com.mx`.
2. Busca **DNS Zone Editor** o **Zona DNS** (varía por template; también accesible desde cPanel → *Advanced Zone Editor*).
3. Agrega **dos registros CNAME**:

**Registro 1**:
```
Name:  erp
Type:  CNAME
TTL:   300
Value: gdmfac-frontend.onrender.com
```

**Registro 2**:
```
Name:  api
Type:  CNAME
TTL:   300
Value: gdmfac-backend.onrender.com
```

> ⚠ Algunos paneles piden el name completo (`erp.hcgm.com.mx`) y otros solo el
> subdominio (`erp`). Usa el formato que muestre tu panel. Si dudas, prueba con
> el subdominio solo — es lo más común.

Guarda cambios.

---

## Paso 3 — Verificar la propagación DNS (5–30 minutos)

En tu PowerShell:

```powershell
nslookup erp.hcgm.com.mx
nslookup api.hcgm.com.mx
```

Debe resolver a la IP de Render (`216.24.xxx.xxx` o similar).

O usa el web tool: **[dnschecker.org](https://dnschecker.org/)** → escribe
`erp.hcgm.com.mx` → tipo **CNAME** → busca. Cuando veas ✅ en la mayoría de
países, sigue al Paso 4.

---

## Paso 4 — SSL automático en Render

Una vez que Render detecta el CNAME resuelto (~5 min después de propagar),
emite automáticamente un certificado SSL vía **Let's Encrypt**.

En cada dominio verás el badge:

- 🟡 `Certificate pending` → esperando
- 🟢 `Certificate active` → listo

No hay que hacer nada manual. Render renueva el cert cada 90 días.

**Prueba desde el navegador**:
- https://erp.hcgm.com.mx → debe mostrar la landing pública.
- https://api.hcgm.com.mx/health → debe responder JSON `{ status: "OK" }`.

Si sale error de certificado, espera 10 minutos más. Si persiste, dispara
"Reissue certificate" desde Render → Settings → Custom Domains.

---

## Paso 5 — Actualizar variables de entorno

### Backend — `gdmfac-backend` en Render

Actualiza `CORS_ORIGIN` para que acepte el nuevo dominio. Puede ser lista
separada por comas si quieres mantener también el `.onrender.com` en paralelo
mientras las pruebas terminan:

```
CORS_ORIGIN=https://erp.hcgm.com.mx,https://gdmfac-frontend.onrender.com
```

Save Changes → Render reinicia el servicio (~1 min).

### Frontend — `gdmfac-frontend` en Render

Actualiza `VITE_API_BASE` para que apunte al nuevo backend custom:

```
VITE_API_BASE=https://api.hcgm.com.mx
```

Save Changes → **Manual Deploy → Deploy latest commit** (los static sites
recompilan con la env nueva; sin esto el frontend seguiría apuntando al
`.onrender.com` viejo).

---

## Paso 6 — Actualizar el mailer (opcional pero recomendado)

Si aún no lo hiciste, deja el remitente SMTP con el dominio propio para que
los correos que salen del ERP también tengan `hcgm.com.mx`:

```
MAIL_FROM=facturas@hcgm.com.mx
```

(Ya cubierto en la guía de configuración SMTP anterior.)

Además, para reducir la probabilidad de que los correos caigan en spam, verifica
que tu dominio tenga:

- **SPF**: en la zona DNS, un registro TXT del tipo:
  ```
  Name: @
  TXT:  v=spf1 include:hostingmexico.com ~all
  ```
- **DKIM**: cPanel → Email Deliverability → habilitar DKIM.
- **DMARC**: TXT en `_dmarc`:
  ```
  Name: _dmarc
  TXT:  v=DMARC1; p=none; rua=mailto:facturas@hcgm.com.mx
  ```

Hosting México suele preconfigurar SPF y DKIM automáticamente. Verifica desde
cPanel → **Email Deliverability**. Si sale verde, todo bien.

---

## Paso 7 — Actualizar la landing (opcional)

En `frontend/index.html`, cambia las meta tags para reflejar el dominio nuevo:

```html
<meta property="og:url" content="https://erp.hcgm.com.mx/" />
<link rel="canonical" href="https://erp.hcgm.com.mx/" />
```

Commit + push → Render redeploya.

---

## Paso 8 — Verificación final

1. Abre en incógnito: **https://erp.hcgm.com.mx** → landing pública OK.
2. Login como super_admin → dashboard carga.
3. Emite una factura → llama a `https://api.hcgm.com.mx/api/v1/...` (revisa Network en DevTools).
4. Envía por correo → llega desde `facturas@hcgm.com.mx`.

Cuando confirmes que todo funciona, **elimina** los dominios viejos:
- Puedes quitar `gdmfac-frontend.onrender.com` de `CORS_ORIGIN` (Render → Backend → Environment).
- Los dominios `.onrender.com` seguirán activos como fallback pero ya nadie los usa.

---

## Rollback

Si algo falla, es reversible en minutos:

1. **Volver a Render**: Backend → Environment → cambiar `CORS_ORIGIN` a `https://gdmfac-frontend.onrender.com`.
2. **Frontend**: cambiar `VITE_API_BASE` a `https://gdmfac-backend.onrender.com` + Manual Deploy.
3. El DNS de Hosting México puede seguir con los CNAME apuntando a Render sin problema (no bloquea nada).

Los DNS records se pueden borrar si prefieres, pero no urgen.

---

## Preguntas frecuentes

**¿Los usuarios ven la URL del backend?**
Solo en el DevTools → Network si abren la consola. No la ven en la barra de direcciones. Aun así, tener `api.hcgm.com.mx` es más profesional que `gdmfac-backend.onrender.com`.

**¿Puedo usar solo `hcgm.com.mx` sin subdominio?**
No sin mover el sitio corporativo. `hcgm.com.mx` ya tiene registros A apuntando al hosting; no puedes tener también un CNAME al mismo tiempo.

**¿Afecta al SEO del sitio corporativo?**
No — `erp.hcgm.com.mx` es un subdominio separado y Google los trata como sitios distintos. El sitio corporativo en `www.hcgm.com.mx` no se altera.

**¿Cuánto cuesta agregar dominios en Render?**
Nada. Render permite dominios custom ilimitados y SSL automático incluidos en todos los planes.

**¿Qué pasa con la landing pública que armamos hoy?**
Sigue viva en el mismo `/`. La URL cambia de `gdmfac-frontend.onrender.com` a `erp.hcgm.com.mx` pero la vista es idéntica.

---

## Checklist final

- [ ] Dominio `erp.hcgm.com.mx` agregado en Render (Frontend)
- [ ] Dominio `api.hcgm.com.mx` agregado en Render (Backend)
- [ ] CNAME `erp` → `gdmfac-frontend.onrender.com` en Hosting México
- [ ] CNAME `api` → `gdmfac-backend.onrender.com` en Hosting México
- [ ] Certificados SSL activos (badge verde en Render)
- [ ] `CORS_ORIGIN` actualizado con `https://erp.hcgm.com.mx`
- [ ] `VITE_API_BASE` actualizado con `https://api.hcgm.com.mx` + redeploy
- [ ] SPF/DKIM/DMARC verificados en cPanel Email Deliverability
- [ ] Prueba end-to-end en incógnito exitosa
- [ ] Landing `og:url` y `canonical` actualizados

Cuando marques los 10 checks, el ERP ya está oficialmente colgado de
`erp.hcgm.com.mx`.
