# GDM_FAC — ERP CFDI 4.0 México

Sistema de facturación electrónica CFDI 4.0 para México. Backend Node/Express + TypeScript, frontend React + Vite, PostgreSQL 15. Integrado con **SW Sapien** como PAC para timbrado real.

**Estado**: 🟢 **Live en producción** (Render.com)

---

## 🔗 URLs de producción

| Servicio | URL |
|----------|-----|
| Frontend | https://gdmfac-frontend.onrender.com |
| Backend API | https://gdmfac-backend.onrender.com/api/v1 |
| Health check | https://gdmfac-backend.onrender.com/health |
| Repo | https://github.com/anbeor29-oss/GDM_FACT |

---

## 🔐 Credenciales de capacitación (testeadas contra prod)

| Rol | Email | Contraseña | Cambio forzado |
|-----|-------|------------|-----------------|
| **SUPER_ADMIN** | `superadmin@plataforma.local` | `Super123!` | ⚠️ Sí (opcional) |
| **ADMIN** demo | `admin.demo@gdmfac.mx` | `Demo123!` | No |
| **USER** demo | `usuario.demo@gdmfac.mx` | `Demo123!` | No |

> ⚠️ **Cambia las contraseñas al primer acceso en producción real** (no capacitación).

---

## 🏗️ Arquitectura de deploy

```
┌─────────────────────────────────────────────────────────┐
│                       RENDER.COM                        │
│                                                         │
│  ┌────────────────────┐          ┌──────────────────┐   │
│  │  gdmfac-frontend   │  HTTPS   │  gdmfac-backend  │   │
│  │  React + Vite      ├─────────►│  Node 20 + TS 5.9│   │
│  │  Static Site free  │   CORS   │  Starter $7 USD  │   │
│  └────────────────────┘          └────────┬─────────┘   │
│                                           │             │
│                                    ┌──────▼──────┐      │
│                                    │  Postgres 15│      │
│                                    │  Free 1GB   │      │
│                                    └─────────────┘      │
└─────────────────────────────────────────────────────────┘
                          │
                          │ HTTPS bearer token
                          ▼
                ┌────────────────────┐
                │   SW SAPIEN (PAC)  │
                │  services.test     │
                │  .sw.com.mx        │
                │  (Sandbox 501⚡)   │
                └────────────────────┘
```

---

## 🧭 Entorno GDM_ALMACEN (segundo despliegue)

`GDM_ALMACEN` es un **entorno independiente** del mismo código, pensado para
demostrar/operar el flujo completo (POS + inventarios + grupos de trabajo) sin
tocar la producción `gdmfac`. Vive en su **propia base de datos** y sus propios
servicios de Render.

| Recurso | Nombre en Render |
|---------|------------------|
| Base de datos | `gdm-almacen-postgres` |
| Backend API | `gdm-almacen-backend` |
| Frontend | `gdm-almacen-frontend` |

**Se despliega desde la rama `almacen`** (que trae su propio `render.yaml`):

1. En Render: **New → Blueprint → conecta el repo → Branch: `almacen` → Apply**.
2. Render pedirá 2 secretos (`sync: false`): pega la **contraseña del admin**
   (`BOOTSTRAP_ADMIN_PASSWORD`) y tu **token SW** (`SW_SAPIEN_TOKEN`).
3. En el primer arranque, el `startCommand` corre migraciones y luego
   `bootstrap:env`, que crea empresa + **admin ADMIN_ALL** + datos de ejemplo.
4. Entra a `https://gdm-almacen-frontend.onrender.com` con
   `BOOTSTRAP_ADMIN_EMAIL` y la contraseña que pegaste.

El admin nace con **grupo de trabajo `ADMIN_ALL`** (ve todos los módulos). Desde
ahí puedes crear usuarios VENTAS / ALMACEN / COMPRAS / TESORERIA con acceso
restringido a sus módulos.

> 💡 Costo: el backend web de Render no tiene tier gratuito vía Blueprint
> (~$7 USD/mes, plan `starter`). Render permite **1 Postgres free por cuenta**;
> si el free ya lo usa `gdmfac`, cambia `gdm-almacen-postgres` a `basic-256mb`
> (~$6 USD/mes) en el `render.yaml` de la rama `almacen`, o libera el otro.

> 🔄 Para actualizar este entorno con cambios de `main`, haz
> `git checkout almacen && git merge main` y push (conservando su `render.yaml`).

---

## 📦 Módulos y estado

### 🔷 Operación diaria (todos los roles)

| Módulo | Estado | Descripción |
|--------|--------|-------------|
| Autenticación JWT | ✅ | Roles: SUPER_ADMIN, ADMIN, MANAGER, USER; force password change; impersonation con audit |
| Dashboard | ✅ | 6 KPIs (facturas, cobrado, saldo, acreditado, con saldo, total facturado) |
| Facturas CFDI 4.0 | ✅ | Emisión con retenciones RESICO/Honorarios; UUID SAT; PDF con paginación X/Y |
| Notas de Crédito | ✅ | % de descuento o monto fijo; prorrateo de IVA; CFDI tipo E |
| Complemento de Pago | ✅ | REP con desglose por parcialidades; `ImpSaldoAnt` descuenta NC previas |
| Clientes | ✅ | STI con `party_type`; extractor de CIF SAT (PDF); RFC + CP + régimen |
| Productos | ✅ | Impuestos por producto (11 presets fiscales); catálogo SAT 52,513 claves; c_ClaveUnidad ~115 opciones |
| Reportes | ✅ | Cobranza, cobranza detallada (saldo > 0.20), ventas, fiscal |
| Timbrado real SW Sapien | ✅ | Endpoint `/v3/cfdi33/issue/json/v4` con vault CSD; QR SAT + sellos del XML real |
| Editar factura DRAFT | ✅ | Reuso de la vista de emisión; totales se recalculan al guardar |
| Envío por correo (SMTP) | ✅ | Nodemailer + selección PDF/XML de factura + NC + pagos; tolerante a fallos parciales |
| Cancelación en cascada | ✅ | NC/pagos con botón cancelar en Historia; validación de dependientes en la factura padre |
| Cancelación SW real | ✅ | `/v4/cfdi/cancel/{rfc}` + parseo de códigos SAT (201/202/205); bypass local + resend |
| Marca de agua CANCELADO | ✅ | Diagonal roja translúcida en PDFs de factura/NC/pago cancelados (se regenera al descargar) |
| Manifiesto PAC con e.firma | ✅ | Firma RSA-SHA256 real con la FIEL del contribuyente (valida RFC + vigencia + correspondencia .cer/.key); constancia PDF; la .key nunca se persiste |
| Marca corporativa GDM | ✅ | Logo oficial (monograma azul/plata) en login, sidebar, landing y favicon |

### 🔶 Plataforma (solo SUPER_ADMIN)

| Módulo | Estado | Descripción |
|--------|--------|-------------|
| Importar XML | ✅ | Preview + auto-sugerencia (yo=emisor → receptor=CUSTOMER) |
| Proveedores | ✅ | Read-only, alimentados por Importar XML |
| Paquetes fiscales | ✅ | 4 planes: PKG_100/200/500/FLEX + descarga de respaldo SAT |
| **Facturación y consumo** | ✅ | Consumo del mes con cap efectivo (quota + rollover), cierre mensual idempotente, histórico anual, marcar pagado. Cron día 1 00:15 (`ENABLE_BILLING_CRON`) |
| **CFDI de cobro (dogfooding)** | ✅ | Al cerrar el mes, HCGM (`PLATFORM_COMPANY_RFC`) emite y timbra el CFDI contra cada cliente, lo envía por correo y guarda folio+UUID; reintento por fila en errores |
| **Compras prepago (FLEX)** | ✅ | Saldos semaforizados, recarga por bloques (30 × $4.99 + IVA), histórico de compras, bloqueo de timbrado al llegar a 0 |
| **Correos automáticos** | ✅ | Alertas prepago (saldo ≤ 5 y saldo 0) con flags anti-spam + recordatorio de cobranza el día 10 |
| Usuarios | ✅ | CRUD + reset password + impersonate |
| Empresas | ✅ | CRUD + lector CIF SAT + selector de plan + carga de CSD cifrado |
| Editar empresa completa | ✅ | Modal con datos generales, domicilio y contacto + acceso directo a actualizar CSD |
| Reset operacional | ✅ | `POST /admin/companies/:id/reset-operations` (confirmRfc + dryRun) — vacía operación conservando empresa/usuarios |
| Eliminar empresa (2 pasos) | ✅ | Borrado total (usuarios, CSD, todo) con doble confirmación server-side: RFC exacto + palabra ELIMINAR |

### 🔴 Infraestructura

| Item | Estado |
|------|--------|
| Deploy en Render (auto-deploy en push) | ✅ |
| Migraciones idempotentes con `schema_migrations` | ✅ |
| Logo persistente en BD (BYTEA) | ✅ |
| Watchdog local con auto-restart | ✅ |
| Health checks | ✅ |

---

## 🛠️ Stack técnico

**Backend**
- Node 20 LTS (pinneado `.nvmrc` + `engines`)
- TypeScript 5.9.3 exacto (evita error `moduleResolution=node10` de TS 6.x)
- Express 4 + JWT + bcryptjs
- PostgreSQL 15 con pg (pool + `DATABASE_URL`)
- pdfkit para PDF, xml2js para CFDI, sharp para logos
- Axios para SW Sapien PAC

**Frontend**
- React 18 + Vite 5 + TypeScript
- TailwindCSS + Lucide icons
- React Router (con `SuperAdminRoute` guard)
- React Query + Zustand
- Recharts para gráficas
- `VITE_API_BASE` dinámico por ambiente

**Infraestructura**
- Render Blueprint (`render.yaml`)
- Auto-deploy en push a `main`
- Backend Starter $7/mes (no hiberna)
- Postgres Free 1 GB (upgrade a Basic $7 para prod)
- Frontend Static free (ilimitado)

---

## 💰 Planes de timbrado (paquetes fiscales)

| Plan | Timbres/mes | Renta MXN | Extra c/u | Público |
|------|-------------|-----------|-----------|---------|
| **Esencial** (PKG_100) | 100 | $399 | $2.50 | Pyme chica |
| **Pyme** ⭐ (PKG_200) | 200 | $699 | $2.25 | Pyme mediana |
| **Empresarial** (PKG_500) | 500 | $1,399 | $2.00 | Empresa mediana |
| **Uso libre** (PKG_FLEX) | 0 | $0 | $2.00 | Ocasional |

Costo interno por timbre: ~$1.72 MXN → margen bruto 40-57 %.

---

## 🚀 Ciclo de desarrollo

### Local

```bash
# Servicios locales (Windows PowerShell)
scripts/start-all.ps1        # levanta PG + Backend + Frontend con watchdog auto-restart
scripts/healthcheck.ps1      # estado + balance SW en 1 comando
scripts/stop-all.ps1         # apagar (pregunta si detener PG)
```

- Backend en http://localhost:3000
- Frontend en http://localhost:5173
- PostgreSQL en localhost:5432 (portable en C:\pgportable)

### Deploy a producción

```powershell
cd E:\Obsidian\GDM_FAC        # ← el repo vive en E: desde 2026-07-09
git add .
git commit -m "feat/fix: descripción"
git push
```

Render detecta el push y deploya automáticamente en 3-5 min. Los logs se ven en tiempo real desde el dashboard.

### Rollback

Cada deploy en Render se puede revertir con 1 clic desde **Deploys → Rollback**.

---

## 🔒 Variables de entorno

Copiar `backend/.env.example` a `backend/.env` y llenar:

| Variable | Uso | Ambiente |
|----------|-----|----------|
| `DATABASE_URL` | Conexión PG completa | Render (auto-inyectada); local usa `DB_HOST/PORT/NAME/USER/PASSWORD` |
| `JWT_SECRET` | Firma tokens | Render la genera; local: `min 32 chars` |
| `JWT_REFRESH_SECRET` | Refresh tokens | Ídem |
| `ENCRYPTION_KEY` | Cifrado general | Ídem |
| `CSD_MASTER_KEY` | Cifrado de .key CSD SAT | Ídem |
| `PAC_PROVIDER` | `MOCK` (dev) o `SW_SAPIEN` (prod) | Manual |
| `SW_SAPIEN_ENV` | `sandbox` o `production` | Manual |
| `SW_SAPIEN_TOKEN` | Bearer token del panel SW | **Manual — no en git** |
| `CORS_ORIGIN` | URLs exactas del frontend con `https://`, separadas por coma (incluir `hcgm.com.mx` y `www.` si aplica) | Manual (Render usa host sin protocolo, falla) |
| `MAIL_HOST/PORT/USER/PASS/FROM` | SMTP para envío de facturas y correos automáticos (ej. `mail.hcgm.com.mx:465`) | Manual |
| `PLATFORM_COMPANY_RFC` | RFC de la empresa que emite los CFDIs de cobro (GRUPOHCGM). Vacío = cierre sin emisión | Manual |
| `ENABLE_BILLING_CRON` | `true` activa los crons: cierre mensual (día 1 00:15), alertas prepago (cada hora), cobranza (día 10 09:00) | Manual — `false` en dev |

---

## 🏥 Comandos frecuentes

### Estado de servicios (local)

```bash
scripts/healthcheck.ps1
```

### Reset de datos de capacitación (Render Shell)

```bash
psql $DATABASE_URL -f src/database/seeds/reset_to_training.sql
```

Deja 3 usuarios (superadmin + admin.demo + usuario.demo) y 1 empresa demo.

### Reset operacional de una empresa por RFC

Borra facturas + pagos + NC + clientes + productos de UNA empresa (conserva la empresa y usuarios). Corre desde tu PowerShell contra Render:

```bash
cd backend
# Requiere DATABASE_URL en .env apuntando a la BD que quieras limpiar
npm run reset:company -- EKU9003173C9
# Confirma escribiendo el RFC; para saltar el prompt agrega --yes
npm run reset:company -- EKU9003173C9 --yes
```

Ideal para volver a fojas cero antes de pruebas con clientes reales.

### Regenerar la guía visual de íconos

```bash
cd backend
npm run docs:icons
# → docs/GUIA_ICONOS_FACTURAS.pdf
```

### Generar el ZIP para el hosting (hcgm.com.mx/erp)

```bash
cd frontend
npm run build:hosting
# → frontend/dist-hosting/gdmfac-erp-hosting.zip
# Subir a cPanel → public_html/ → Extract (ver docs/DEPLOY_HOSTING_ZIP.md)
```

### Cerrar el mes de facturación manualmente

Desde la UI: SUPER_ADMIN → **Facturación y consumo** → "Cerrar mes anterior"
(calcula rollover, genera cargos y emite CFDIs de cobro). Es idempotente.
El cron del día 1 hace lo mismo automáticamente si `ENABLE_BILLING_CRON=true`.

### Limpiar productos de prueba (Render Shell)

Todos:
```bash
psql $DATABASE_URL -c "DELETE FROM invoice_items WHERE product_id IS NOT NULL; DELETE FROM customer_products; DELETE FROM products;"
```

De una empresa específica:
```bash
psql $DATABASE_URL -c "DELETE FROM invoice_items ii USING products p WHERE ii.product_id = p.id AND p.company_id = '<UUID>'; DELETE FROM products WHERE company_id = '<UUID>';"
```

### Backfill de `tax_preset_id` en productos existentes (Render Shell)

```bash
psql $DATABASE_URL <<'SQL'
UPDATE products SET tax_preset_id = CASE
    WHEN is_exempt = TRUE OR tax_type = 'EXENTO' THEN 'ivaex'
    WHEN applies_ieps = TRUE OR tax_type = 'IEPS' THEN 'ieps_tasa'
    WHEN tax_rate = 0.08                          THEN 'iva8'
    WHEN tax_rate = 0                             THEN 'iva0'
    ELSE 'iva16'
END
WHERE tax_preset_id IS NULL;
SQL
```

### Verificar balance SW en Render

```bash
curl -s https://gdmfac-backend.onrender.com/api/v1/pac/account-status -H "Authorization: Bearer $TOKEN"
```

---

## 📊 Costos operativos mensuales

| Concepto | Costo MXN/mes |
|----------|---------------|
| Render Backend Starter | ~$140 |
| Render Postgres Free (90 días retención) | $0 |
| Render Frontend Static | $0 |
| Cloudflare DNS + SSL | $0 |
| Backblaze B2 backup off-site (20 GB) | $20 |
| **Total infra** | **~$160 MXN/mes** |

Con 10 clientes activos mix Esencial/Pyme/Empresarial (~$7,200 MXN ingresos):
- Costo PAC (2,000 timbres × $1) = $2,000
- Costo infra = $160
- Utilidad neta ≈ **$5,000 MXN/mes (69 % margen)**

---

## 📚 Documentación adicional

- [BITACORA.md](BITACORA.md) — Histórico cronológico de cambios y decisiones
- [docs/BUGS_RESUELTOS.md](docs/BUGS_RESUELTOS.md) — Bugs de las pruebas pre-producción con síntoma/causa/fix/commit
- [docs/GUIA_ICONOS_FACTURAS.pdf](docs/GUIA_ICONOS_FACTURAS.pdf) — Guía visual de cada ícono de la lista de facturas (regenerable con `npm run docs:icons`)
- [docs/DEPLOY_HCGM_DOMAIN.md](docs/DEPLOY_HCGM_DOMAIN.md) — Guía paso a paso para colgar el ERP de `erp.hcgm.com.mx` (custom domain + SSL + variables)
- [docs/DEPLOY_HOSTING_ZIP.md](docs/DEPLOY_HOSTING_ZIP.md) — Servir el frontend desde `hcgm.com.mx/erp` vía ZIP en cPanel (`npm run build:hosting`) + checklist de PAC producción
- [docs/DISENO_FACTURACION_PLANES.md](docs/DISENO_FACTURACION_PLANES.md) — Diseño del módulo de Facturación y Consumo (rollover iguala, prepago FLEX, jobs y correos)
- [DEPLOY_RENDER.md](DEPLOY_RENDER.md) — Guía paso a paso del deploy inicial
- [ARCHITECTURE.md](ARCHITECTURE.md) — Arquitectura interna del backend
- [ESTRUCTURA_PROYECTO.md](ESTRUCTURA_PROYECTO.md) — Layout de carpetas

---

## 🧪 Testing

```bash
# Backend unitario
cd backend && npm test

# Frontend lint
cd frontend && npm run lint

# E2E (Playwright)
npx playwright test
```

Suite E2E en `tests/e2e/` con 14 archivos: smoke, auth, productos, facturas, NC + saldo, UI, a11y WCAG 2.2, performance, multi-tenant, paquetes de timbres, import XML hardening.

---

## 🐛 Reportar bugs

- **Bugs de código**: crear issue en el repo con etiqueta `bug` + captura
- **Emergencias PAC**: soporte SW Sapien 33 1380 9988
- **Reset admin en prod**: Render Shell + SQL directo (documentado arriba)

---

## 🧭 Lecciones del proyecto — guía para el siguiente

> Esta sección condensa TODO lo aprendido de cero a producción, pensada para
> arrancar un nuevo proyecto que incluya (o se parezca a) este. El detalle
> cronológico vive en [BITACORA.md](BITACORA.md) (§ Compendio Maestro) y el
> catálogo bug-por-bug en [docs/BUGS_RESUELTOS.md](docs/BUGS_RESUELTOS.md).

### Arquitectura que SÍ funcionó (repetir tal cual)

| Decisión | Por qué repetirla |
|---|---|
| **Monorepo backend/ + frontend/** con deploy separado en Render | Un push deploya ambos; el static site del frontend es gratis |
| **Migraciones SQL idempotentes** (`IF NOT EXISTS` + tabla `schema_migrations` + runner que aborta el boot si falla) | Cada deploy auto-migra; imposible arrancar con schema a medias |
| **Multi-tenant por `company_id` en el JWT** (nunca en el body) | Elimina toda una clase de vulnerabilidades de un plumazo |
| **Persistencia binaria en BYTEA** (logos, CSD cifrado) | Render Starter NO tiene disco persistente — el filesystem se borra en cada deploy |
| **Patrón provider para el PAC** (interfaz + registry MOCK/SW_SAPIEN por env) | Desarrollas todo con MOCK y conectas el PAC real sin recompilar |
| **PDFs regenerados al vuelo** (nunca persistidos) | Cada fix de PDF aplica retroactivamente a documentos viejos |
| **Contadores dentro de la MISMA transacción** que el evento (timbre → `stamp_usage`) | Nunca hay CFDI timbrado sin contabilizar ni viceversa |
| **Scripts npm para operación** (`reset:company`, `docs:icons`, `build:hosting`) | La operación repetible vive en el repo, no en la memoria de nadie |
| **Dogfooding**: la plataforma se factura a sí misma con su propio motor | Cada mejora al producto mejora la operación del negocio |

### Los 10 errores que más costaron (no repetir)

1. **CORS sin protocolo** — Express compara el `Origin` literal (`https://…`); Render inyecta el host pelón vía `fromService`. Hardcodear la URL completa.
2. **Placeholder olvidado** (`'ABC010101ABC'` como RFC) — costó horas contra el PAC. Todo placeholder debe gritar (`TODO-FIXME`) o fallar en arranque.
3. **`getHours()` en servidor UTC** para fechas fiscales — SAT valida contra hora México. Siempre `toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' })`.
4. **`CREATE OR REPLACE VIEW` reordenando columnas** — Postgres solo permite agregar al final; tumbó el deploy. `DROP VIEW IF EXISTS` primero.
5. **Columnas usadas por el código sin migración** — el modal "Saldo" quedó en `Cargando…` para siempre por un `42703`. El schema base y el código deben evolucionar juntos.
6. **Un cálculo replicado en 8 lugares** (saldo = total − pagos − NC) — al agregar la condición `!= 'CANCELLED'` hubo que cazarlos todos. Centralizar en un helper/vista desde el día 1.
7. **Emojis en PDFKit** — Helvetica no tiene esos glifos (salen `Ø=Ý`). Texto plano o dibujar los íconos con `doc.path()` (SVG paths de Lucide).
8. **`fetch('/api/…')` relativo en prod** — con frontend y backend en dominios distintos apunta al static site. Siempre el cliente axios con `baseURL`.
9. **Token JWT pegado con basura** (`NOMBRE=`, `...`, saltos) — validar formato (2 puntos exactos) antes de culpar al servidor.
10. **Confiar en el sandbox del PAC** — 404 falsos de vault, timbres que no aparecen. Siempre tener botón "reintentar" + bypass local + logging del `messageDetail`.

### Gotchas de plataforma (Render / Postgres / SAT)

- **Render**: sin disco persistente · `npm ci` omite devDeps (usar `--include=dev`) · pinnear Node (`engines` + `.nvmrc`) y TypeScript exacto · el runner de migraciones corre en `start:prod` · cron interno con `node-cron` funciona porque Starter no hiberna.
- **Postgres**: vistas no se reordenan · `pg` multi-statement respeta el `BEGIN/COMMIT` del archivo (migraciones atómicas) · `??` y `||` no se mezclan sin paréntesis en TS.
- **SAT/CFDI**: sandbox SW solo acepta el RFC de prueba `EKU9003173C9` · cancelación exige cancelar dependientes primero (NC/REP) · el timbre cancelado NO se devuelve · QR del portal = `?id=UUID&re=&rr=&tt=(17 chars zero-pad)&fe=(últimos 8 del sello)` · e.firma ≠ CSD (la FIEL firma manifiestos; el CSD sella CFDIs) · la `.key` SAT es PKCS#8 DER cifrado — Node la abre nativo con `passphrase`.

### Atajos de operación diaria

```powershell
cd E:\Obsidian\GDM_FAC                      # repo (única copia local + GitHub)
npm run reset:company -- <RFC>              # backend: vaciar una empresa (dry-run + confirmación)
npm run docs:icons                          # backend: regenerar guía PDF de íconos
npm run build:hosting                       # frontend: ZIP para hcgm.com.mx/erp
# SUPER_ADMIN UI: Facturación y consumo → "Cerrar mes anterior" (idempotente)
# Diagnóstico PAC sin abrir DevTools: GET /api/v1/pac/providers (con token)
```

---

**Copyright** © 2026 — Antonio Bernal / HCGM
