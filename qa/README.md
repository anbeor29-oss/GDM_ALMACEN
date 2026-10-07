# QA — GDM NEXO

Suite de pruebas **E2E (Playwright)** + **performance smoke (k6)** para GDM NEXO.
Vive fuera de `backend/` y `frontend/`: **no toca el build de la app** ni se despliega.

> Anclada al sistema real: rutas de `backend/src/app.ts`, router de
> `frontend/src/App.tsx`, login de `frontend/src/pages/Login.tsx` y el modelo de
> permisos de `frontend/src/utils/permissions.ts`. Si esos cambian, revisar los specs.

## 1. Requisitos (corre en TU PowerShell, no en Render)

- Node 20+
- k6 (solo para `perf:smoke`): https://k6.io/docs/get-started/installation/

## 2. Instalar

```bash
cd qa
npm install
npm run install:browsers   # baja Chromium para Playwright
```

## 3. Configurar (único paso manual — sin esto los scripts no saben a dónde apuntar)

```bash
cp .env.example .env
```

Llena en `.env`:
- `BASE_URL` — URL del **frontend** (local `http://localhost:5173`, o tu URL de Render).
- `API_BASE` — origen del **backend** (local `http://localhost:3000`, o tu backend de Render).
- `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD` — cuenta **ADMIN / ADMIN_ALL** de prueba.
- (Opcional) `TEST_LIMITED_*` — cuenta con grupo acotado (**PUNTO_VENTA** recomendado) para RBAC.

Las pruebas que necesitan cuenta se marcan **SKIPPED** (no fallan) si no configuras credenciales.
`SMK-01/02` y `AUT-01..04` corren sin credenciales.

## 4. Ejecutar

```bash
npm run test:smoke     # gate de despliegue (rápido, no toca datos)
npm test               # toda la suite E2E
npm run test:headed    # viendo el navegador
npm run report         # abre el reporte HTML del último run
npm run perf:smoke     # k6 — ver nota de seguridad abajo
```

## 5. Estructura

```
qa/
├─ playwright.config.ts     # baseURL desde .env; reporter list+html
├─ .env.example             # plantilla de configuración
├─ fixtures/auth.ts         # uiLogin(), apiLogin(), CREDS
├─ tests/
│  ├─ smoke.spec.ts         # SMK-01..04
│  ├─ auth-rbac.spec.ts     # AUT-01..04, RBAC-01..03
│  └─ customers.spec.ts     # CLI-01..02 (patrón CRUD, solo lectura)
├─ k6/smoke.js              # PERF-01 (smoke de latencia)
└─ casos-de-prueba.csv      # matriz completa (importable a Jira/TestRail/Excel)
```

## 6. Datos de prueba y ambiente

- **No** correr pruebas **destructivas** (alta/baja real) contra producción ni contra un
  ambiente compartido: contaminan datos fiscales. Usar una **empresa de prueba dedicada**
  y limpiar al final. Los specs incluidos son de lectura/navegación a propósito.
- El **timbrado** en `sandbox` de SW Sapien solo acepta el RFC de prueba `EKU9003173C9`
  (ver `CFDI-01`). Nunca timbrar contra `production` desde QA.

## 7. ⚠️ Seguridad — performance y escaneos

`k6` (carga) y cualquier escaneo tipo **OWASP ZAP** **solo** deben lanzarse contra un
ambiente **NO productivo** y **con autorización explícita**. Lanzar carga o un scanner
activo contra la app en producción de Render puede degradar el servicio a clientes reales,
disparar bloqueos o consumir cuota. Este repo trae **scripts**, no ejecuciones automáticas.
