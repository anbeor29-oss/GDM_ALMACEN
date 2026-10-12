# Configuración de SatGo (proveedor fiscal) — NEXO + IVA

> SatGo (sat-go.com) es el proveedor que usa NEXO para **CIF/CSF, Opinión 32‑D, IMSS,
> Declaraciones e Información Fiscal**, y para la **descarga masiva de CFDI** (cuando
> `SAT_DESCARGA_VIA=satgo`). La app **IVA** (repo `GDM_IVA`) usa la **misma cuenta**.

---

## 1. Lo esencial (si algo falla, empieza aquí)

| Cosa | Valor correcto |
|---|---|
| **URL base de la API** | **`https://api.sat-go.com`** |
| **NO usar** | ❌ `https://web.sat-go.com` (ese es el **portal web**, no la API) |
| **Auth** | `POST /api/Auth/token?key=<API Key>` → JWT corto (Bearer) |
| **La API Key** | permanente, de la cuenta SatGo; **la misma sirve para NEXO y para IVA** |
| **Cuenta** | está en **PRUEBAS/trial** → **las llaves caducan** (ver §5) |

**Síntoma típico de llave caducada:** `SatGo Auth/token respondió 401` en 32‑D / CIF /
IMSS / descarga de facturas (todas usan la misma llave).

---

## 2. Dónde vive la API Key (¡OJO: por app, por separado!)

- **NEXO:** cifrada en su base de datos (tabla `satgo_config`, columna `api_key`,
  cifrada con `SAT_VAULT_KEY`). Se pone desde **Súper admin → Conector fiscal**.
- **IVA:** en la **variable de entorno** `SATGO_API_KEY` del servicio `iva` en Render.

Son la **misma cuenta SatGo**, pero **NO se comparten solas**: si renuevas la llave,
hay que ponerla **en los dos lugares**.

---

## 3. Cómo se usa en el código (todo pasa por una sola llave)

- `backend/src/modules/satgo/satgo.service.ts` → `accessToken()` lee la API Key de la
  BD, pide el JWT a `api.sat-go.com/api/Auth/token` y lo cachea (~4 min).
  - `baseUrl()` **normaliza** `web.sat-go.com` → `api.sat-go.com` (blindaje).
  - Las consultas de cumplimiento (CIF/CSF, 32‑D, IMSS, Declaraciones) usan `accessToken()`.
- `backend/src/modules/sat-descarga/satgo-transport.ts` → la **descarga masiva de CFDI**
  (solicita/verifica/descarga) también usa `accessToken()`. Se activa con
  `SAT_DESCARGA_VIA=satgo`.
- **Conclusión:** una sola API Key válida hace funcionar **32‑D, CIF, IMSS, Declaraciones
  y la descarga de facturas**.

---

## 4. Variables de entorno (Render → `gdm-almacen-backend`)

| Variable | Para qué |
|---|---|
| `SAT_VAULT_KEY` | **obligatoria** — cifra la API Key en la BD. Sin ella no se puede guardar la llave. |
| `SATGO_BASE_URL` | opcional; por defecto `https://api.sat-go.com`. No apuntar al portal. |
| `SAT_DESCARGA_VIA` | `satgo` para que la descarga de XML vaya por SatGo (si no, usa el SOAP propio). |
| `ENABLE_SAT_DESCARGA_CRON` | `true` para la **descarga automática** de XML. |
| `ENABLE_COMPLIANCE_CRON` | `true` para el **refresco automático** de 32‑D/CIF/IMSS (lunes 01:50 CDMX). |

> En **IVA** (Render → `iva`): `SATGO_API_KEY` (la llave) y, opcional, `SATGO_BASE_URL`.

---

## 5. RUNBOOK — "da 401 / no entra al SAT" (llave caducada)

La cuenta es de **prueba**, así que la llave caduca cada pocos días. Cuando pase:

1. **Consigue una llave NUEVA** (una de dos):
   - **Portal:** en `web.sat-go.com` → «API & Consultas», busca la **API Key** y
     **regenérala/cópiala**, **o**
   - **CreateKey** (en PowerShell, con el *Access Token* del portal — es de corta vida,
     úsalo de inmediato, en **una sola línea** y entre **comillas simples**):
     ```powershell
     $portal = 'EL_ACCESS_TOKEN_EN_UNA_LINEA'
     Invoke-RestMethod -Method Post -Uri 'https://api.sat-go.com/api/v1/Users/CreateKey' -Headers @{ Authorization = "Bearer $portal" }
     ```
2. **PRUÉBALA antes de usarla** (debe devolver un token, no 401):
   ```powershell
   $key = 'LA_API_KEY'
   Invoke-RestMethod -Method Post -Uri "https://api.sat-go.com/api/Auth/token?key=$([uri]::EscapeDataString($key.Trim()))"
   ```
3. **Pon la llave válida en los DOS lugares:**
   - **NEXO** → Súper admin → Conector fiscal → **«3 · O pega la API Key directamente»** → Guardar.
   - **IVA** → Render → `iva` → Environment → `SATGO_API_KEY` = la nueva.
4. **Verifica** con el botón **«Probar conexión»** del Conector fiscal (debe decir
   "Conexión correcta"). Si dice 401, la llave no sirve — repite desde el paso 1.

**Regla de oro:** nunca pegues una llave sin que pase el test de `Auth/token`.

---

## 6. Blindaje implementado (para que no se caiga en silencio)

- `baseUrl()` autocorrige `web.sat-go.com` → `api.sat-go.com`.
- `accessToken()`: ante **401** devuelve un mensaje claro ("la API Key caducó, renuévala
  en Conector fiscal"), no un "401" pelón.
- **Botón «Probar conexión»** en el Conector fiscal (`GET /admin/satgo/probar` →
  `probarConexion()`): valida la llave en el momento, antes de confiar en los crons.
- Pegar la API Key directo (`POST /admin/satgo/apikey`) reinicia el JWT cacheado para
  que tome efecto al instante.

---

## 7. Solución de fondo

Esto se repite porque la cuenta SatGo está en **trial/pruebas**. Para que la llave sea
**estable** (y los crons de facturas/cumplimiento no se corten), hay que **formalizar el
contrato con SatGo** (pasar a producción pagada). Mientras tanto, usar el runbook del §5.

---

*Actualizado: 2026‑10‑12.*
