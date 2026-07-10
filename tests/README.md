# Suite QA E2E — ERP CFDI 4.0

Estrategia, casos y automatización ejecutable para el ERP CFDI 4.0 (FE Vite/React, BE Node/Express, Postgres).

## Requisitos previos

- Backend corriendo en `http://localhost:3000` (`npm run dev` en `/backend`)
- Frontend en `http://localhost:5173` (`npm run dev` en `/frontend`)
- Postgres con seeds aplicados (`manager@demo.com` / `admin123`)

## Instalar y correr

```bash
cd tests
npm install
npm run install:browsers     # solo la primera vez
npm test                     # toda la suite
npm run test:smoke           # gate de despliegue
npm run test:regression      # regresión funcional
npm run test:a11y            # accesibilidad WCAG 2.2 AA
npm run test:security        # OWASP básico
npm run report               # abre reporte HTML
```

## Tags

- `@smoke` — 5 tests; gate de promoción a UAT.
- `@regression` — funcional completa (auth, productos, facturas, NC, saldo, UI).
- `@a11y` — escaneo axe-core en 5 vistas críticas.
- `@security` — IDOR, CORS, rate-limit, XSS storage.
- `@performance` — SLA: login <800ms, list <600ms, PDF <1.5s & <100KB.

## Estructura

| Archivo | Cobertura |
|---|---|
| `01-smoke.spec.ts` | Health, login, contratos básicos del API |
| `02-auth.spec.ts` | Login válido/inválido, SQLi, tokens manipulados |
| `03-products.spec.ts` | 11 presets de impuesto, validaciones SAT |
| `04-invoices.spec.ts` | Cálculos Anexo 20, retenciones, XML, pairwise 10 |
| `05-credit-notes-balance.spec.ts` | NC monto/%, saldo combinado, historia timbres |
| `06-ui-flows.spec.ts` | Login UI, sidebar, columna Saldo, modal History |
| `07-a11y-security.spec.ts` | WCAG 2.2 AA + OWASP IDOR/CORS/XSS/rate-limit |
| `08-performance.spec.ts` | SLA latencia + tamaño PDF |

Ver `docs/estrategia.md` para la estrategia completa, matriz, riesgos y métricas.
