# Estrategia QA — ERP CFDI 4.0

**Versión** 1.0 · **Owner** QA Lead · **Última revisión** 2026-06-22

---

## 1. Alcance confirmado

**Sistema bajo prueba (SUT):** ERP de facturación CFDI 4.0 para PyMEs mexicanas.

**Módulos cubiertos:**

| Módulo | Componentes | Riesgo fiscal |
|---|---|---|
| Autenticación | Login JWT, refresh, roles ADMIN/MANAGER/USER | Medio (acceso a datos fiscales) |
| Clientes | CRUD, régimen fiscal SAT | Alto (RFC en XML) |
| Productos | CRUD, 11 presets de impuesto, validación SAT | **Crítico** (define impuestos del CFDI) |
| Facturas (CFDI tipo I) | Crear, listar, timbrar, PDF, XML, columna Saldo | **Crítico** |
| Notas de Crédito (E) | Monto/porcentaje, prorrateo IVA, descuenta saldo | **Crítico** |
| Pagos (Complemento P) | Aplicar pago, complemento Pagos 2.0 | **Crítico** |
| Dashboard | KPIs agregados (SQL) | Bajo (lectura) |
| PDF / XML | Generación + descarga + historia de timbres | Alto |

**Fuera de alcance esta iteración:** integración PAC real, multi-tenant cross-company, escalamiento horizontal, mobile, navegadores no-Chromium (se contemplan en plan de fase 2).

---

## 2. Enfoque y tipos de prueba

Pirámide invertida pragmática (el sistema no tiene unit tests todavía; el ROI es E2E + integración):

```
                 E2E UI (Playwright)         ← 06-ui-flows
              ──────────────────────
            Integración API (Playwright)     ← 02..08 spec files
         ─────────────────────────────────
       Contract / SQL fixtures               ← test-data.ts + seed
```

**Tipos cubiertos:**
- Funcional (positivo, negativo, edge)
- Regresión visual mínima (sidebar claro, columna Saldo)
- Integración API ↔ DB (Postgres real, no mocks)
- Accesibilidad WCAG 2.2 AA (axe-core)
- Seguridad OWASP top-10 nivel básico (Auth, IDOR, CORS, XSS storage, rate-limit)
- Performance smoke (SLA por endpoint)

**Técnicas:**
- Clases de equivalencia (login válido/inválido/inexistente)
- Valores frontera (cantidad 0, 0.001, 5.075, 999999.999, overflow)
- Tablas de decisión (matriz cliente × impuesto = 11 presets)
- Transición de estados (Factura DRAFT → STAMPED → PARTIAL_PAYMENT → PAID)
- Pairwise (régimen × preset, 10 combinaciones de los 5×11 posibles)

---

## 3. Ambiente y datos

| Componente | Versión / config | Endpoint |
|---|---|---|
| Frontend | Vite 5 + React + TS | http://localhost:5173 |
| Backend | Node 20 + Express + ts-node | http://localhost:3000 |
| BD | Postgres 16 portable | localhost:5432, db `cfdi_erp` |
| PAC | Mock (UUID `uuid v4`) | N/A |

**Usuarios sembrados:**
- `manager@demo.com` / `admin123` (rol MANAGER)
- `admin@demo.com` / *desconocida — bajo riesgo, ADMIN no toca pruebas*
- `user@demo.com` / *desconocida*

**Datos de prueba:** definidos en `tests/fixtures/test-data.ts` — los tests crean sus propios customers/products/invoices con timestamp único para no contaminar entre runs. SQL de limpieza (opcional) en `tests/fixtures/cleanup.sql`.

---

## 4. Matriz de casos (extracto principal)

| ID | Suite | Descripción | Datos | Resultado esperado | Prio | Tipo |
|---|---|---|---|---|---|---|
| SMK-001 | smoke | Health BE | GET /health | 200 + status:OK | P0 | Func |
| SMK-002 | smoke | FE sirve index | GET / | 200 + título | P0 | Func |
| SMK-003 | smoke | Login válido | manager/admin123 | 200 + JWT | P0 | Func |
| SMK-004 | smoke | Lista factura trae balance | GET /invoices | balance, paid_total presentes | P0 | Contract |
| SMK-005 | smoke | Dashboard 6 KPIs | GET /dashboard/summary | objeto con 6 keys | P0 | Contract |
| AUT-001 | auth | Login OK | manager | 200 + JWT 3 partes | P0 | Func |
| AUT-002 | auth | Password incorrecto | manager/wrong | 401 | P0 | Negativo |
| AUT-003 | auth | Email inexistente | noexiste/ | 401 (anti-enum) | P0 | Negativo |
| AUT-004 | auth | Body vacío | {} | 400/401/422 | P1 | Negativo |
| AUT-005 | auth | SQLi en email | `admin'--` | sin leak de stack | P0 | Seguridad |
| AUT-006 | auth | Sin token | GET /invoices | 401 | P0 | Seguridad |
| AUT-007 | auth | Token tamper | jwt corrupto | 401 | P0 | Seguridad |
| PRD-001 | prods | 11 presets persisten | matriz pairwise | tax_preset_id, banderas OK | P0 | Func |
| PRD-002 | prods | Precio 0 | basePrice=0 | 201 (servicio gratuito permitido) | P2 | Frontera |
| PRD-003 | prods | Clave SAT inválida | 99999999 | 400 con mensaje SAT | P0 | Negativo |
| PRD-004 | prods | Unidad inválida | ZZZ | 400 | P0 | Negativo |
| FAC-001 | facts | Cálculo IVA 16% | 2×$1000 | total=2320 | P0 | Func |
| FAC-002 | facts | RESICO retenciones | $10000 | total=10408.33 | P0 | Func |
| FAC-003 | facts | Honorarios retenciones | $5000 | total=4766.66 | P0 | Func |
| FAC-004 | facts | Cantidad 5.075 | qty=5.075 | persiste 3 dec | P0 | Frontera |
| FAC-005 | facts | Cantidad máx 999999.999 | qty=máx | aceptada | P1 | Frontera |
| FAC-006 | facts | Sin items | items=[] | 400 | P0 | Negativo |
| FAC-007 | facts | Customer inexistente | uuid inexistente | 400/404 | P0 | Negativo |
| FAC-008 | facts | PDF < 100KB | GET /pdf | 200, %PDF, ≤100KB | P0 | Func+Perf |
| FAC-009 | facts | XML Anexo 20 | GET /xml | tags requeridos | P0 | Contract |
| FAC-PWxN | facts | Pairwise régimen×preset | 10 combos | total > 0, preset persistido | P1 | Pairwise |
| NC-001 | NC | NC monto fijo prorratea IVA | amount=1160 | iva=160 | P0 | Func |
| NC-002 | NC | NC por % (0.01..100) | discountPercent | total = base × pct/100 | P0 | Frontera |
| NC-003 | NC | NC > saldo | amount=999999 | 400 | P0 | Negativo |
| NC-004 | NC | NC sin monto ni % | sin amount | 400 | P0 | Negativo |
| BAL-001 | bal | Saldo refleja NC | NC 10% | balance = total×0.9 | P0 | Integración |
| BAL-002 | bal | /balance retorna UUIDs | con NC | array creditNotes[] con uuid | P0 | Contract |
| TMB-001 | timbres | PDF+XML los 3 CFDIs | factura+NC | 200 application/pdf y xml | P0 | Func |
| UI-001 | ui | Login UI redirige | manager | URL /dashboard | P0 | UI |
| UI-002 | ui | Sidebar claro | DOM aside | class contiene bg-white | P1 | Regresión |
| UI-003 | ui | Columna Saldo | tabla | columnheader visible | P0 | UI |
| UI-004 | ui | 4 KPIs dashboard | textos | visibles | P0 | UI |
| UI-005 | ui | Modal History abre | botón title | heading + badges I/P/E | P1 | UI |
| A11Y-x5 | a11y | axe sin violaciones | 5 rutas | 0 serious/critical | P1 | A11Y |
| SEC-001 | sec | Health sin leaks | GET /health | sin stack/node/pg | P0 | Seguridad |
| SEC-002 | sec | CORS estricto | Origin attacker | ACAO ≠ * ni attacker | P0 | Seguridad |
| SEC-003 | sec | Anti-IDOR | uuid ajeno | 403/404 | P0 | Seguridad |
| SEC-004 | sec | Rate-limit no tumba | 20 logins | sin 5xx | P1 | Seguridad |
| SEC-005 | sec | XSS storage | `<script>` en name | persiste sin ejecutar | P1 | Seguridad |
| PERF-001 | perf | Login < 800ms | timing | OK | P1 | Performance |
| PERF-002 | perf | List < 600ms | timing | OK | P1 | Performance |
| PERF-003 | perf | Dashboard < 400ms | timing | OK | P1 | Performance |
| PERF-004 | perf | PDF < 1.5s & 100KB | timing+size | OK | P0 | Performance |

**Total: ~60 casos automatizados** (sin contar las iteraciones de las matrices pairwise/boundary que multiplican).

---

## 5. Casos negativos y edge cases destacados

| Edge case | Cubierto en | Notas |
|---|---|---|
| Cantidad = 0 | FAC (boundary) | Backend acepta, factura inválida en UI por validación frontend |
| Cantidad > 999999.999 | FAC-005 | Clamp en UI; backend no acepta |
| Cantidad negativa | FAC | Clamp a 0 |
| Precio extremo (1e12) | (manual) | Verificar overflow numérico |
| NC > saldo restante | NC-003 | 400 con mensaje claro |
| Aplicar pago a factura PAID | (manual) | Wallet deshabilitado en UI |
| RESICO con producto IVA 0 | FAC pairwise | El preset estructural (IVA 0) gana sobre el régimen |
| UUID timbre malformado | (no testeado) | PAC mock no genera inválidos |
| Régimen del receptor mal capturado ("19" suelto) | (manual) | Etiqueta "Estado SAT 19" en PDF |

---

## 6. Criterios de aceptación / Definition of Done

Un release es DONE cuando:

1. **Smoke** verde (5/5)
2. **Regression** verde >= 95% (tolerancia 5% para flakes)
3. **A11Y**: 0 violaciones serious/critical en las 5 vistas
4. **Security**: 5/5 controles básicos pasan
5. **Performance**: 4/4 SLA cumplidos
6. **Manual exploratory**: 1 sesión de 1 hora antes de RC con flujos reales
7. **Datos críticos**: ninguna factura/NC del seed alterada por la suite (timestamps únicos)
8. Tests TS sin errores (`npx tsc --noEmit` en el módulo `tests/`)

---

## 7. Métricas y dashboard de calidad

| Métrica | Objetivo | Cómo se mide |
|---|---|---|
| Cobertura E2E de endpoints CRUD principales | ≥ 90% | Conteo manual de endpoints en routes + cross-check con specs |
| **Defect density** | < 1 defecto severo / 1000 líneas backend | Bugs P0/P1 en sprint ÷ KLOC `backend/src` |
| **Defect escape rate** | < 5% | Bugs en prod ÷ bugs detectados antes |
| **MTTR** (P0) | < 4 h | gh timestamp de creación → resolución |
| **Tasa de éxito Smoke** (CI) | ≥ 99% | Playwright JUnit + Grafana |
| **Tiempo total suite** | < 5 min | reports/results.json `duration` |
| Pass rate A11Y | 100% (serious/critical) | axe-results.json |
| PDF size delta | ≤ +10% vs baseline (11KB) | PERF-004 |

**Dashboard sugerido** (Grafana/Looker): ingesta de `reports/junit.xml` + `results.json` en CI; visualizar pass/fail por suite, latencias y violaciones a11y por release.

---

## 8. Riesgos y mitigaciones

| Riesgo | Impacto | Probabilidad | Mitigación |
|---|---|---|---|
| **Postgres se cae intermitente** (observado en dev) | Alto — bloquea toda la suite | Alta | Pre-flight check + retry inteligente en `beforeAll`. Considerar `pg_ctl restart` en CI. |
| Mock-PAC se aleja del comportamiento real | Crítico fiscal | Media | Contract tests adicionales cuando PAC real esté integrado |
| Datos seed se contaminan entre runs | Medio | Media | Usar timestamps únicos en nombres + script de cleanup |
| UI rota por cambios de Tailwind classes | Bajo | Alta | Tests UI usan **roles ARIA** y `title`, no clases (excepto UI-002 que es regresión consciente) |
| Logo grande regresión (3MB) | Alto — descargas timeout | Baja | FAC-008 valida tamaño < 100KB |
| Empalme de texto en PDF (regresiones de layout) | Medio (cosmético-legal) | Media | A futuro: visual regression con Percy/snapshots de PDF→imagen |
| Time zone afecta `fmtDate` | Bajo | Media | Tests no asertan fecha exacta, solo presencia |
| Carga concurrente rompe folio | Alto | Baja | `INSERT … RETURNING` atómico ya implementado; tests serializan (`workers: 1`) |

---

## 9. Smoke / Sanity / Monitoreo

**Smoke (CI gate, 5 tests, ~30s):**
```bash
npm run test:smoke
```

**Sanity post-deploy (manual, 10 min):**
1. Login con manager
2. Crear factura RESICO → verificar retenciones
3. Crear NC 10% → verificar saldo
4. Descargar PDF + XML
5. Abrir Modal Historia

**Monitoreo producción (futuro):**
- Synthetic check cada 5 min: GET /health, POST /auth/login
- Alerta Sentry/Datadog si error rate > 1% en 5 min
- Métrica: p95 latencia de `/cfdi/:id/pdf`

---

## 10. Preguntas clarificatorias

1. **PAC real**: ¿cuándo se integra Finkok/SW/Facturama? Esto desbloquea contract tests reales (validación SAT de UUIDs, sellos, cadena original verdadera).
2. **Cancelación de CFDI**: hay endpoint pero no hay flujo de prueba. ¿Está dentro del MVP?
3. **Multi-empresa**: el sistema soporta `companyId` pero los tests sólo usan una. ¿Probar tenant-isolation con segundo usuario?
4. **Browsers**: el config solo cubre Chromium. ¿Agregar Firefox/WebKit?
5. **Carga**: ¿qué picos se esperan (concurrencia, facturas/min)? Define si necesitamos k6/JMeter dedicado.
6. **Snapshots PDF**: ¿interesa visual regression de los PDFs (compararlos pixel-a-pixel contra baseline)?
7. **CI**: ¿GitHub Actions, GitLab, Jenkins? Tengo `junit.xml` listo pero falta el workflow.

---

## Cómo ejecutar (TL;DR)

```bash
# Una vez
cd C:/Users/EQ-7/GDM_FAC/tests
npm install
npm run install:browsers

# Cada vez
npm run test:smoke      # 30s, gate CI
npm test                # suite completa, ~5 min
npm run report          # ver HTML
```
