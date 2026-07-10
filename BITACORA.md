# BITÁCORA — GDM_FAC

Histórico cronológico de cambios funcionales, decisiones técnicas y deploys.
Formato: cada entrada tiene fecha, contexto, decisión y consecuencia.

---

## 2026-07-02 (tarde) — Stabilización post-deploy y correcciones de UI

### Contexto
Después del deploy exitoso a Render, aparecieron múltiples bugs derivados de:
1. Cambios manuales en la BD local que nunca se migraron a git
2. Recursos que Render no maneja igual que un servidor tradicional (sin disco persistente, sin devDeps en runtime, CORS estricto)
3. Bugs de UI que en dev no eran visibles por el proxy Vite

### Bugs enfrentados y soluciones

| # | Bug | Causa raíz | Solución |
|---|-----|------------|----------|
| 1 | CORS bloqueaba login desde frontend Render | `CORS_ORIGIN=gdmfac-frontend.onrender.com` (sin protocolo); Express CORS compara literal con Origin del navegador (`https://...`) | Hardcodear `value: "https://gdmfac-frontend.onrender.com"` en render.yaml |
| 2 | Login falla para admin.demo/usuario.demo | Hash bcrypt del seed no correspondía a "Cap4citAcion!" | Regenerar hash de "Demo123!" y UPDATE en Render Shell |
| 3 | Menús Importar XML, Proveedores, Paquetes visibles para todos | Sin guard de rol | Restringir a SUPER_ADMIN en Layout + `SuperAdminRoute` en App.tsx |
| 4 | Modal AdminPackages decía "requiere ADMIN" con SUPER_ADMIN | Guard hardcoded `role === 'ADMIN'` | Cambiar a SUPER_ADMIN + rehacer página con 4 cards de planes |
| 5 | Dropdown Régimen fiscal y Estado vacíos en Emisor | Catálogos SAT (c_RegimenFiscal, c_Estado, c_Moneda...) no seedeados | Migración `2026-06-16_sat_catalogs_seed.sql` con 200+ entries idempotentes |
| 6 | Producto no se guarda: `column "tax_preset_id" does not exist` | Columna creada manualmente en dev, nunca migrada | Migración `2026-06-17_products_tax_preset.sql` con IF NOT EXISTS + backfill |
| 7 | Logo no se sube en Render | Render Starter sin disco persistente — `fs.writeFileSync` funciona pero se pierde | Guardado dual: BYTEA en BD + FS como fallback dev; migración `2026-06-18_company_logo_bytea.sql` |
| 8 | Botón borrar producto no funciona | `fetch('/api/products/...')` con path relativo iba al static site del frontend en prod | Usar `api.deleteProduct(id)` con axios |
| 9 | Buscador SAT ClaveProdServ solo devolvía 7 claves | `src/data/c_ClaveProdServ.json.gz` (52,513 claves) no se copiaba a `dist/` con `tsc` | Script `scripts/copy-assets.js` que copia binarios post-tsc |
| 10 | Editar producto pierde el preset | Frontend siempre infería `taxPresetId` desde tax_rate, ignorando `p.tax_preset_id` guardado | Priorizar `p.tax_preset_id`; solo fallback si viene NULL |
| 11 | Solo 10 unidades en c_ClaveUnidad | Seed subset chico | Migración `2026-06-19_clave_unidad_full.sql` con ~115 claves (peso, longitud, tiempo, digital, energía) |
| 12 | Columna Impuesto en lista de productos inconsistente | Etiquetas variaban por preset ("Autotransporte", "Honorarios PF→PM", "IVA 16%") | Nomenclatura homogénea "IVA X%" o "IVA X% +Ret" con detalle en tooltip |
| 13 | Logo relativa `/api/public/companies/...` fallaba en prod | Path sin protocolo iba al static site; también faltaba `/v1` | Usar `client.defaults.baseURL` para construir la URL con protocol |

### Nuevas features en la misma sesión

- **Página Paquetes fiscales** rehecha con 4 cards visuales (PKG_100/200/500/FLEX) + sección descarga ZIP SAT.
- **Modal Nueva empresa** con:
  - Botón "Leer CIF" (SDK PDF SAT) — autollena RFC + razón + régimen + CP
  - Dropdown de plan de timbres (reemplaza 4 campos manuales)
  - Timbre extra default $2.00 editable
- **Migración catálogos SAT** completa (moneda, régimen, estado, uso CFDI, forma de pago, método de pago, tipo relación, motivos cancelación).
- **Migración c_ClaveUnidad** con 115 unidades (piezas, kg, m, m², m³, litros, tiempo, digital, energía, textiles).
- **Migración credit_notes** que faltaba en schema base (idempotente).
- **Migración products tax_preset_id + currency + no_identificacion** con backfill inteligente.
- **Migración logo BYTEA** para persistencia en Render sin disco.
- **Script copy-assets** para binarios que `tsc` ignora.

### Aprendizajes clave

1. **Render Starter NO tiene disco persistente** — cualquier archivo escrito a filesystem se pierde en cada deploy. Persistencia = BD (BYTEA) o storage externo (S3, B2).
2. **CORS con `fromService` de Render inyecta host sin protocolo** — para APIs autenticadas mejor hardcodear la URL completa.
3. **`tsc` solo copia .ts** — cualquier asset (JSON, .gz, .cer, .xls) necesita script propio.
4. **Cambios manuales en BD local sin migración = deploy roto** — regla estricta: cualquier `ALTER TABLE` o `CREATE TABLE` debe existir como archivo `.sql` en `migrations/` antes de merge.
5. **Frontend con fetch relativo funciona por accidente en dev** por el proxy Vite, pero rompe en prod cuando front y back están en dominios distintos.

### Consecuencia
- 🟢 Sistema 100% funcional en producción
- 🟢 Los 3 usuarios de capacitación validados con curl
- 🟢 SW Sapien Sandbox conectado con 501 timbres disponibles
- 🟢 Módulos SUPER_ADMIN operativos: crear empresa (con CIF), asignar plan, crear usuarios, gestionar CSDs
- 🟡 **Pendiente**: primer timbrado real con CSD de prueba SW Sapien + RFC EKU9003173C9

---

## 2026-07-02 — Deploy productivo en Render

### Contexto
Necesidad de un ambiente estable donde el servicio no dependa de que la máquina local esté prendida. El desarrollo local se caía intermitentemente (tsx watch, Vite server, y PG).

### Decisión
- **Plataforma**: Render.com con Blueprint (`render.yaml`)
- **Repo**: GitHub público `anbeor29-oss/GDM_FACT`
- **Plan**: Backend Starter ($7 USD), Frontend Static (Free), Postgres Free (90 días)

### Bugs enfrentados y resueltos durante deploy

| # | Error | Causa raíz | Solución |
|---|-------|------------|----------|
| 1 | `no such plan free for service type web` | Render descontinuó `free` para web services vía Blueprint | Cambiar `plan: free` → `plan: starter` en backend; quitar `plan` en static site |
| 2 | `TS5107: 'moduleResolution=node10' is deprecated` en TS 6.x | Render usaba TypeScript global 6.x en lugar del pinneado 5.9 | `build: "./node_modules/.bin/tsc"` (fuerza binario local) |
| 3 | `sh: ./node_modules/.bin/tsc: not found` | Render omite devDependencies con `NODE_ENV=production` | `buildCommand: "npm ci --include=dev && npm run build"` |
| 4 | `Node.js v26.4.0` demasiado nuevo | Render eligió última versión inestable | Pin `engines.node: "20.x"` + `.nvmrc` con `20` |
| 5 | `[migrate] FALLÓ: relation "credit_notes" does not exist` | Tabla `credit_notes` creada manualmente en dev, nunca en git | Nueva migración `2026-06-15_credit_notes.sql` con la definición completa |
| 6 | `Missing required environment variables: DB_HOST, ...` | Validación exigía vars sueltas, Render usa `DATABASE_URL` | Config acepta ambos: `DATABASE_URL` (parseada) o vars discretas |
| 7 | `$PORT` no respetado | Código usaba `APP_PORT` hardcode | Preferir `PORT` (Render) sobre `APP_PORT` (self-hosted) |

### Consecuencia
- 🟢 Backend live: https://gdmfac-backend.onrender.com
- 🟢 Frontend live: https://gdmfac-frontend.onrender.com
- 🟢 Postgres available: `gdmfac-postgres` (uso interno)
- Auto-deploy en cada `git push` a `main`
- Rollback con 1 clic desde el dashboard

### Aprendizaje
Render tiene 3 pitfalls no obvios que deberían estar mejor documentados:
1. Free tier YA NO aplica para web services vía Blueprint (sí manual)
2. `npm ci` con `NODE_ENV=production` omite devDeps por default
3. Node runtime pica versión bleeding-edge si no se pinnea

---

## 2026-07-01 — PDF paginación X/Y a la derecha inferior

### Contexto
Los PDFs generaban 4-6 páginas fantasma con contenido vacío. La paginación aparecía en el pie izquierdo pero con números incorrectos.

### Decisión
- Cambiar posición de "Página X/Y" al pie **derecho** (`x = PAGE_RIGHT - 120`)
- Workaround anti-auto-page en PDFKit: anular `doc.page.margins` temporalmente antes de escribir en zonas cerca del margen inferior
- Comprimir sellos base64 del timbre fiscal a 1 línea con ellipsis para evitar overflow

### Resultado
- Factura simple: 1 sola página con `Página 1/1`
- NC: 1 página `Página 1/1`
- Reporte cobranza (multi-cliente): 3 páginas `1/3, 2/3, 3/3`
- Cero páginas fantasma

### Archivos afectados
- `backend/src/modules/cfdi/pdf-helpers.ts`
- `backend/src/modules/cfdi/pdf.service.ts`
- `backend/src/modules/cfdi/pdf-credit-note.service.ts`
- `backend/src/modules/cfdi/pdf-payment.service.ts`

---

## 2026-07-01 — Integración SW Sapien PAC

### Contexto
El sistema estaba en modo MOCK PAC. Para producción real necesitamos timbrado ante SAT.

### Decisión
- **PAC elegido**: SW Sapien (`services.test.sw.com.mx` sandbox / `services.sw.com.mx` prod)
- **Modelo**: token JWT del panel `swpanel.mx` en `.env` cifrado, nunca password personal
- **Provider registrado**: `SW_SAPIEN` en el registry, seleccionado por env `PAC_PROVIDER=SW_SAPIEN`
- **Fallback**: MOCK cuando no hay token — permite dev sin dependencia externa

### Endpoints implementados
- `POST /cfdi33/stamp/v4` → timbrado CFDI 4.0
- `POST /cfdi33/cancel/{rfc}` → cancelación
- `GET /account/balance` → saldo de timbres

### Estado actual
- ✅ Sandbox conectado con **501 timbres disponibles**
- ✅ Balance leído correctamente por el ERP (`GET /pac/account-status`)
- ✅ Cuenta dedicada para el proyecto (separada del usuario personal)
- 🟡 Primer timbrado real pendiente
- 🟡 CSD de prueba de SW pendiente cargar en la empresa demo

### Archivos afectados
- `backend/src/modules/pac/providers/sw-sapien.provider.ts` (nuevo)
- `backend/src/modules/pac/pac.service.ts` (registry + selección dinámica)
- `backend/.env` (variable `SW_SAPIEN_TOKEN`)

---

## 2026-07-01 — Reporte de Cobranza detallado

### Contexto
El reporte de cobranza existente solo mostraba totales por cliente. Se pidió un reporte detallado que:
1. Filtre por cliente (o mostrar todos)
2. Liste facturas con saldo pendiente **> $0.20** (umbral anti-redondeo)
3. Muestre abonos (payments) y notas de crédito por factura
4. Exportable a PDF con paginación correcta

### Decisión
- Nueva pestaña **"Cobranza detallada"** en `/reports`
- Endpoint `GET /api/v1/reports/receivables?customerId=…` → JSON
- Endpoint `GET /api/v1/reports/receivables/pdf` → PDF descargable
- Saldo = `total - pagos - créditos`, filtro en memoria (2 decimales)

### Archivos afectados
- `backend/src/modules/reports/reports.service.ts` — nueva función `getReceivablesReport`
- `backend/src/modules/reports/receivables-pdf.service.ts` (nuevo)
- `frontend/src/pages/Reports.tsx` — pestaña nueva
- `frontend/src/services/api.ts` — métodos `getReceivablesReport` + `receivablesPDFUrl`

---

## 2026-06-30 — Importar XML: distinguir Cliente / Proveedor

### Contexto
Al importar un XML CFDI 4.0 externo, el sistema debe:
- Distinguir si la contraparte es CLIENTE (yo emito) o PROVEEDOR (yo recibo)
- Guardar CP y régimen reales del XML (no `'00000'` / `'616'` hardcoded)
- Los proveedores viven en `/suppliers` como vista read-only

### Decisión
**Single-Table Inheritance** con columna `party_type VARCHAR(16)` en `customers`:
- `CUSTOMER` (default) o `SUPPLIER`
- Constraint CHECK + índice parcial en `(company_id, party_type)`
- Sidebar: nuevo menú "Proveedores" con icono `Truck` color ámbar

**Auto-detección server-side**:
- Comparar RFC emisor/receptor del XML contra `companies.rfc` del JWT
- Si yo=emisor → sugerencia `receptor → CUSTOMER`
- Si yo=receptor → sugerencia `emisor → SUPPLIER`
- Si RFC coincide con la propia empresa → guard "no se puede crear como cliente ni proveedor"

**Parser XML actualizado** para extraer:
- `LugarExpedicion` (CP del emisor)
- `DomicilioFiscalReceptor` (CP del receptor)
- `RegimenFiscalReceptor`
- `UsoCFDI`

### Archivos afectados
- `backend/src/database/migrations/2026-06-23_party_type.sql`
- `backend/src/modules/cfdi-import/cfdi-import.service.ts`
- `backend/src/modules/cfdi-import/cfdi-import.types.ts`
- `backend/src/modules/suppliers/suppliers.routes.ts` (nuevo)
- `frontend/src/pages/Suppliers.tsx` (nuevo)
- `frontend/src/pages/ImportXMLWizard.tsx`
- `frontend/src/components/Layout.tsx`

---

## 2026-06-23 — Auto-memoria: registro de sesión

### Contexto
Necesidad de tener un rastro persistente de las decisiones tomadas entre sesiones del asistente.

### Decisión
Guardar auto-memoria en `C:\Users\EQ-7\.claude\projects\D--Obsidian-GDM-FAC\memory\`:
- `MEMORY.md` (índice)
- `gdm-fac-project.md` (contexto del proyecto)

Regla: no memorizar código o estructura (se puede leer del repo), sí memorizar **decisiones de negocio** y preferencias del usuario.

---

## 2026-06-22 — Paquetes de facturación (100/200/500 timbres)

### Contexto
Modelo comercial SaaS: cobrar renta mensual + cap de timbres. Necesidad de 3 planes con precios competitivos vs Facturama, Bind ERP, Contpaqi.

### Decisión

| Código | Timbres/mes | Renta MXN | Extra c/u |
|--------|-------------|-----------|-----------|
| `PKG_100` | 100 | $399 | $2.50 |
| `PKG_200` | 200 | $699 | $2.25 |
| `PKG_500` | 500 | $1,399 | $2.00 |
| `PKG_FLEX` | 0 (pay-per-stamp) | $0 | $2.00 |

**Margen bruto**: 40-57% (costo interno PAC + infra ~$1.72/timbre).

### Archivos afectados
- `backend/src/database/migrations/2026-07-01_stamp_packages.sql`
- `backend/src/database/migrations/2026-06-22_company_billing_plan.sql`
- `backend/src/database/migrations/2026-06-22_super_admin_module.sql`

---

## Decisiones acumuladas — resumen

- **Redondeo**: bancario (half-even) para centavos; nunca `toFixed(2)` sin verificar
- **Multi-tenant**: `company_id` en JWT, jamás en request body
- **Passwords**: bcrypt cost 12; force-change en primer login
- **CSD**: cifrado en BD con pgp_sym_encrypt + master key en env
- **XML**: parser tolerante para import; estricto para emisión
- **PDFs**: sellos abreviados (60+ellipsis+20) para caber en 1 página
- **API path**: `/api/v1/...` consistente en dev y prod
- **Auto-deploy**: cada push a `main` dispara build en Render (no manual)
- **Migrations**: idempotentes (`IF NOT EXISTS`, `ON CONFLICT DO`)
- **PAC**: switcheable entre MOCK y SW_SAPIEN vía env — cero recompilación

---

## Próximos pasos identificados

- 🟡 Migrar `CSD_MASTER_KEY` de env efímero a AWS KMS / Vault
- 🟡 Cerrar contrato PAC producción con SW Sapien (mayorista)
- 🟡 Cambiar dominio de `.onrender.com` a `.gdmfac.mx` custom
- 🟡 Job diario de reconciliación ERP ↔ SW (detectar desincronizaciones tras bypass local)
- 🟡 Timbrar NC y complementos de pago contra SW real (hoy XML se genera localmente y solo la factura pasa por PAC)
- 🟡 Envío automático por correo tras timbrar (checkbox "enviar al cliente")

---

## 2026-07-07 — Timbrado real, cancelación, correo y cierre pre-producción

### Contexto
Ronda intensiva para dejar el sistema listo para producción con dos empresas reales.
Cubrió el ciclo completo: emitir → NC → pago → cancelar → enviar por correo.

### Bloques principales

**Timbrado real con SW Sapien**
- Nuevo serializer `buildCFDIJson()` que arma el JSON CFDI 4.0 desde BD.
- `SWSapienProvider.stampFromJson()` sobre `/v3/cfdi33/issue/json/v4` (`application/jsontoxml`) — el CSD/`.key` vive en el vault SW, nuestro backend no maneja privadas.
- Guardrail: en sandbox solo se acepta RFC `EKU9003173C9`.
- Migración de fecha a `America/Mexico_City` (SAT valida contra hora local, no UTC).
- Provider real (MOCK vs SW_SAPIEN) expuesto al cliente para que los mensajes reflejen realidad.

**PDFs con datos y QR reales**
- `extractTimbreData(xml)` lee UUID, sellos, No. Certificado, RFCs y total del XML timbrado.
- `buildQrSatContent()` + `buildQrSatPng()` generan el QR de verificación SAT (Anexo 20).
- `drawTimbreFiscal` renderiza QR 90×90pt a la derecha del bloque timbre y usa sellos reales (no fabricados por regex).
- Aplicado a los 3 PDFs (factura, NC, complemento de pago).
- XML de NC y pago (generación local) ahora incluyen `NoCertificado`, `Emisor` y `Receptor` completos.

**Cálculos de saldo y status**
- Migración `2026-07-07_payments_missing_columns.sql` para columnas que el código esperaba.
- Migración one-shot `2026-07-08_recompute_invoice_paid_status.sql` corrige facturas con saldo real 0 atoradas en PARTIAL_PAYMENT.
- Regla `cubierto = pagos + NC` para status PAID.
- `ImpSaldoAnt`/`ImpSaldoInsoluto` del complemento de pago descuentan NC.
- Filtro `document_status != 'CANCELLED'` en 8 subqueries que sumaban pagos (lista, dashboard, reports, PDF, etc.).

**Envío por correo (SMTP)**
- Módulo mailer con nodemailer + variables env (`MAIL_HOST/PORT/USER/PASS/FROM`).
- `SendMailModal` con selección PDF+XML por factura, cada NC y cada pago.
- Backend tolerante: fallo de un adjunto no aborta el correo entero; se devuelve `{attached, skipped}`.
- Recomendación producción: SMTP del dominio propio (`facturas@hcgm.com.mx`).

**Cancelación**
- Fix RFC emisor real (antes hardcoded `ABC010101ABC` → 404).
- Endpoint correcto `/v4/cfdi/cancel/{rfc}` (no la mezcla `/v4/cfdi33/`).
- Parseo `data.uuid = { "<UUID>": "201"/"202"/"205"/... }` para leer códigos SAT.
- Cancelación en cascada desde el modal Historia (botones cancelar por NC y por pago con recálculo del padre).
- Validación anti-huérfanos: no se permite cancelar factura con dependientes vigentes.
- Bypass local para MOCK antiguo (pac_id='MOCK' salta el PAC).
- `forceLocal=true` desde UI cuando SW rebota (bug de vault sandbox) — panel amarillo con "Cancelar solo localmente".
- Resend a PAC de facturas ya canceladas localmente (mismo ícono, tooltip diferente).

**Editar factura DRAFT**
- Ruta `/invoices/:id/edit` reusando `NewInvoicePage`.
- Backend `updateInvoice` amplió a reemplazar cliente + items + totales en transacción.
- Botón sky ✏ en la lista, solo visible en DRAFT + no timbrada.

### Bugs enfrentados y soluciones

Detalle completo con síntoma/causa/fix/commit en [docs/BUGS_RESUELTOS.md](docs/BUGS_RESUELTOS.md).
Resumen: 22 bugs corregidos, 7 features nuevas. Todos los commits `ab3bd70…1a40cf3`.

### Archivos afectados (destacados)
- `backend/src/modules/cfdi/build-cfdi-json.service.ts` (nuevo)
- `backend/src/modules/cfdi/pdf-helpers.ts` (extractTimbreData, buildQrSatPng, drawTimbreFiscal con QR)
- `backend/src/modules/pac/providers/sw-sapien.provider.ts` (stampFromJson + endpoint v4 cancel)
- `backend/src/modules/pac/pac.service.ts` (cancelInvoice con bypass local + resend)
- `backend/src/modules/mailer/mailer.service.ts` (nuevo — SMTP con tolerancia)
- `backend/src/modules/invoices/invoices.service.ts` (updateInvoice completo + filtros cancelados)
- `backend/src/modules/payments/payments.service.ts` (cancelPayment + status con NC)
- `backend/src/modules/credit-notes/credit-notes.service.ts` (cancelCreditNote + XML completo)
- `backend/src/database/migrations/2026-07-07_payments_missing_columns.sql` (nuevo)
- `backend/src/database/migrations/2026-07-08_recompute_invoice_paid_status.sql` (nuevo)
- `backend/scripts/reset-company.ts` (nuevo — `npm run reset:company -- <RFC>`)
- `backend/scripts/generate-icons-guide.ts` (nuevo — `npm run docs:icons`)
- `docs/BUGS_RESUELTOS.md` (nuevo)
- `docs/GUIA_ICONOS_FACTURAS.pdf` (nuevo — generado)
- `frontend/src/pages/NewInvoice.tsx` (modo edición)
- `frontend/src/pages/Invoices.tsx` (SendMailModal, TimbresModal con cancelar, CancelModal con bypass)
- `frontend/src/pages/PublicHome.tsx` (nuevo — landing pública)
- `frontend/src/App.tsx` (guardas + ruta edición)

### Aprendizajes clave
1. **Placeholder es enemigo público**: dejar `'ABC010101ABC'` en el código costó dos horas de diagnóstico. Todo placeholder debe ser removido o tener test que lo detecte.
2. **Zonas horarias en fechas fiscales**: SAT valida contra hora local México (UTC-6/-5 con DST). Nunca usar `getHours()` en servidor UTC.
3. **Un mismo cálculo en 8 lugares**: al agregar `document_status != 'CANCELLED'` había que replicarlo en cada subquery. Vale la pena centralizar en una función helper.
4. **Sandbox del PAC no es fiel al prod**: 404 falsos, timbres que "desaparecen" del vault, etc. En prod hay que tener botón "reintentar" y logging fino.
5. **XML localmente generado ≠ XML del PAC**: hasta que NC y pago se timbren realmente, hay que mantener los atributos Anexo 20 (`NoCertificado`, `Emisor`, `Receptor`) coherentes en el XML de generación local, o el PDF los verá "pendientes".

---

## 2026-07-08/09 — Módulo de Facturación completo, marca GDM y despliegue en hcgm.com.mx

### Contexto
Con el timbrado real estable, esta ronda convirtió el ERP en un negocio
auto-administrado: el sistema mide el consumo, cierra el mes, emite sus
propios CFDIs de cobro y avisa por correo — más la integración visual y de
navegación con el sitio corporativo hcgm.com.mx.

### Bloque 1 — Módulo Facturación y Consumo (5 fases, diseño → producción)

Diseño completo en `docs/DISENO_FACTURACION_PLANES.md` con **10 decisiones
de negocio cerradas** (corte día 30/31, emisión día 1, prorrateo por días al
cambiar de plan con cap redondeado ↑, rollover que se conserva, extras al
precio del plan vigente al timbrar, CFDI de cobro emitido por el propio ERP,
prepago $4.99 fijo, umbral de aviso 5, bloqueo total con saldo 0, cancelar
no devuelve timbre).

| Fase | Entregable | Commit |
|------|-----------|--------|
| 1 | Migración `2026-07-09_billing_module.sql` (rollover en companies, `monthly_invoicing`, `prepaid_stamp_balance/purchases`, vista con cap efectivo) + `billing.service` (assertCanStamp, recordStampUsed dentro de la TX de timbrado) | `e5a6e47` |
| 2 | UI "Facturación y consumo": KPIs, tabla mes en curso (refresh 60 s), histórico anual, marcar pagado, botón cerrar mes; `close-month.service` idempotente | `56730cb` |
| 3 | UI "Compras prepago": saldos semaforizados (verde/ámbar/rojo BLOQUEADO), modal recarga 30/60/90 con desglose IVA, histórico de compras; endpoints `/admin/prepaid/*` | `7f4cec4` |
| 4 | **Dogfooding**: `issue-invoice.service` — HCGM (env `PLATFORM_COMPANY_RFC`) emite/timbra el CFDI de cobro contra cada cliente (upsert customer+producto SERV-TIMBRADO 81112000, PPD, IVA 16%), lo envía por correo y guarda folio+UUID; cron `node-cron` día 1 00:15 (`ENABLE_BILLING_CRON`); reintento por fila en la UI | `7473c6e` |
| 5 | Correos automáticos: `billing-alerts.service` (prepaid_low/prepaid_zero con flags anti-spam que se limpian al recargar + recordatorio de cobranza día 10); `sendPlainMail` en el mailer; trigger post-timbrado fire-and-forget + cron horario como red de seguridad | `6ca71f5` |

### Bloque 2 — Gestión de empresas (SUPER_ADMIN)

- **Editar empresa completa**: modal con Datos generales / Domicilio / Contacto + panel de sellos con acceso directo a actualizar CSD. El domicilio y `contact_email` alimentan el CFDI de cobro y los correos automáticos.
- **Reset operacional**: `POST /admin/companies/:id/reset-operations` (confirmRfc + dryRun) — para limpiar la escuela de pruebas sin PowerShell contra la BD.
- **Eliminar empresa (2 pasos)**: borrado total (14 tablas en cascada, usuarios, CSD, la empresa misma) con doble confirmación server-side (RFC exacto → palabra ELIMINAR), preview de conteos, protección anti-auto-eliminación y audit log.

### Bloque 3 — Manifiesto PAC con e.firma (firma criptográfica real)

- Tabla `sw_manifests` + `manifest.service`: parsea el `.cer` (X509Certificate — RFC del subject, CN, serial SAT decodificado, vigencia), abre la `.key` PKCS#8 DER cifrada con passphrase, **valida que la pública derivada coincida con la del certificado**, firma RSA-SHA256 el texto legal y verifica antes de persistir. La `.key` jamás se guarda.
- Pantalla en el modal Emisor (`ManifestSigner`): texto colapsable, carga de e.firma, badge verde al firmar y **constancia PDF** descargable (texto íntegro + serial + firma base64).
- SW no expone endpoint público de manifiesto → la constancia es el documento del expediente (status SIGNED; SENT/ACCEPTED manuales al tramitar en su panel).

### Bloque 4 — hcgm.com.mx: hosting, menú y marca

- **`npm run build:hosting`**: genera `gdmfac-erp-hosting.zip` con base `/erp/`, `VITE_API_BASE` al backend Render y `.htaccess` (SPA fallback + cache immutable). Guía completa en `docs/DEPLOY_HOSTING_ZIP.md` (Parte A hosting + Parte B checklist PAC producción).
- **Parche del menú corporativo**: se descargó el `index.html` real del sitio, se insertó "Facturas" en el nav (entre Nómina y Nosotros) y "📄 Facturación Electrónica" en el footer Herramientas — verificado byte a byte; entregado como `hcgm-menu-facturas.zip`.
- **Botón de regreso** en el login del ERP (`← hcgm.com.mx` junto a Ingresar) — ciclo completo sitio ↔ ERP.
- **Logo oficial GDM**: primero se recreó como SVG (feedback: "quedó feo") → se reemplazó por la **imagen real** de `hcgm.com.mx/assets/logo.png` (mockup 4000×2667, 7 MB) recortada al círculo con sharp y optimizada a 256×256 (104 KB). Aplicada en login, sidebar, landing y favicon; theme-color al azul marino del logo.

### Bugs de la ronda

| Bug | Causa | Fix |
|-----|-------|-----|
| **Failed deploy en Render** (backend caído) | `CREATE OR REPLACE VIEW v_stamp_usage_current` insertaba columnas en medio — Postgres solo permite agregar al final; migrate-up aborta con exit 1 | `DROP VIEW IF EXISTS` antes del CREATE (la migración es transaccional: el fallo hizo rollback y no quedó registrada) — `947cb99` |
| PDF guía de íconos con caracteres corruptos (Ø=Ý) | Helvetica no tiene glifos emoji | Íconos dibujados con los SVG paths reales de Lucide (`doc.path()` + `doc.circle()`) |
| Logo 7 MB en el bundle | `assets/logo.png` del sitio es el mockup completo | Recorte con sharp `extract` + `resize(256)` — verificación visual iterativa |

### Aprendizajes clave
1. **`CREATE OR REPLACE VIEW` no reordena columnas** — para vistas que evolucionan, `DROP VIEW IF EXISTS` + `CREATE` (si nada SQL depende de ellas) evita el deploy roto.
2. **Dogfooding cierra el círculo**: HCGM factura con su propio producto — cada mejora al ERP mejora también la operación del negocio, y los reportes de cobranza sirven de inmediato.
3. **Registrar consumo DENTRO de la TX de timbrado** garantiza que nunca haya CFDI timbrado sin contabilizar (ni al revés).
4. **Los flags anti-spam de correos** (low/zero_notified_at) deben marcarse solo si el envío tuvo éxito, y limpiarse al recargar — así los fallos de SMTP se reintentan sin duplicar avisos.
5. **Assets de sitios en producción pueden ser gigantes** — siempre verificar dimensiones/peso antes de meterlos al bundle; sharp del backend sirve para procesarlos sin dependencias nuevas.

---

## Estado para producción (checklist vivo)

- [x] Timbrado real SW sandbox verificado end-to-end
- [x] Módulo de facturación/cobro automático completo
- [x] ERP servido desde hcgm.com.mx/erp (ZIP) con marca GDM
- [ ] `git push` + deploy Live con el fix de la vista
- [ ] Subir ZIPs a cPanel (menú + ERP con logo)
- [ ] `CORS_ORIGIN` con hcgm.com.mx
- [ ] Pruebas finales con las 2 empresas reales
- [ ] Switch a SW producción (token + CSDs al vault + `SW_SAPIEN_ENV=production`)
- [ ] `PLATFORM_COMPANY_RFC` + `ENABLE_BILLING_CRON=true` en Render

---

## 2026-07-09 — Mudanza del repositorio a E: (consolidación de copias)

### Contexto
C: se estaba llenando y existían 3 copias del proyecto (C: repo real, D: y E:
copias obsoletas de Obsidian). Se consolidó todo en UNA copia local + GitHub.

### Procedimiento (seguro, con verificación antes de borrar)
1. Verificado: 0 commits sin pushear (GitHub como doble respaldo) y solo un
   archivo untracked (`docs/SW_TIMBRADO_ANALISIS.md`, viaja con la copia).
2. `robocopy /MIR /MT:16` de C:\Users\EQ-7\GDM_FAC → E:\Obsidian\GDM_FAC_new
   (484 MB, incluye `.git` y `node_modules`).
3. Verificación de integridad: mismo HEAD (`a4c1369`), mismo status, y
   **36,931 = 36,931 archivos**.
4. Swap: eliminada la copia vieja de E: (18,308 archivos obsoletos) y
   renombrado `GDM_FAC_new` → `GDM_FAC`. Re-verificado git + remote.
5. Eliminado `C:\Users\EQ-7\GDM_FAC` por completo (el directorio raíz requirió
   sacar primero el cwd de los shells de la sesión).
6. `D:\Obsidian\GDM_FAC` (copia obsoleta, 145 MB): su único archivo no
   presente en E: (`.claude/launch.json`) fue preservado; el borrado del
   contenido quedó **bloqueado por el guard de la sesión de Claude** (es su
   working directory — protección anti auto-borrado). Comando manual para el
   usuario al cerrar la sesión: `Remove-Item D:\Obsidian\GDM_FAC -Recurse -Force`.

### Resultado
```
E:\Obsidian\GDM_FAC   ← ÚNICA copia local (repo git íntegro)
GitHub                ← respaldo remoto + fuente del auto-deploy
Render                ← producción
```

### Aprendizajes
1. **Verificar antes de borrar**: conteo de archivos origen vs destino +
   `git log`/`status` en la copia ANTES de tocar el original.
2. **"Está en uso"** al borrar una carpeta = algún shell tiene su cwd dentro;
   mover el cwd y reintentar (el contenido puede borrarse aunque el raíz
   resista).
3. Los guards del entorno que impiden a una herramienta borrar su propio
   directorio de trabajo son deliberados: no rodearlos, documentar el paso
   manual.

---

# 📕 COMPENDIO MAESTRO — de cero a producción

> Resumen ejecutivo de TODO el proyecto para usarlo como plantilla del
> siguiente. Complementa: README §Lecciones, docs/BUGS_RESUELTOS.md (detalle
> bug-por-bug con commits) y las entradas cronológicas de arriba.

## 1. Línea de tiempo (10 etapas)

| # | Etapa | Qué se construyó |
|---|-------|------------------|
| 1 | **Fundación local** | Backend Node 20/Express/TS + frontend React 18/Vite + PostgreSQL. Módulos core: auth JWT multi-tenant (4 roles, force-password, impersonación), facturas CFDI 4.0 con retenciones, clientes (+ lector CIF PDF), productos (52k claves SAT), NC, complementos de pago, reportes, PDFs pdfkit |
| 2 | **Deploy a Render** | Blueprint render.yaml, backend Starter + PG Free + static site. Bugs de arranque: CORS, devDeps, versión de Node, TS 6 |
| 3 | **Estabilización post-deploy** | 13 bugs (tabla 2026-07-02): catálogos SAT no seedeados, columnas sin migrar, logo sin disco → BYTEA, assets que tsc no copia, fetch relativo |
| 4 | **Plataforma SUPER_ADMIN** | Paquetes fiscales, usuarios, empresas con CSD cifrado (pgcrypto), guards por rol y por URL |
| 5 | **Timbrado real (SW Sapien sandbox)** | Análisis JSON vs XML → ruta JSON `/v3/cfdi33/issue/json/v4` (el CSD vive en el vault del PAC). Bugs: token corrupto, fecha UTC vs México, "MODO SIMULACIÓN" hardcodeado |
| 6 | **Ciclo completo de documentos** | QR SAT real, NoCertificado desde el XML, cancelación en cascada (NC/REP → factura) con endpoint v4 + bypass local + resend, edición de DRAFT, envío SMTP con selección de adjuntos, marca de agua CANCELADO |
| 7 | **Módulo Facturación y Consumo** (5 fases) | Rollover de timbres, prepago FLEX con bloqueo, cierre mensual idempotente, **dogfooding** (HCGM emite sus CFDIs de cobro con su propio motor), correos automáticos con flags anti-spam, 3 crons |
| 8 | **Expediente del emisor** | Edición completa de empresas (domicilio/contacto), manifiesto PAC firmado con **e.firma real** (X509 + RSA-SHA256 + constancia PDF), full-delete con doble confirmación |
| 9 | **Integración hcgm.com.mx** | `build:hosting` (ZIP con base `/erp/` + .htaccess SPA), parche del menú del sitio, botón de regreso, logo oficial (recorte con sharp del asset real) |
| 10 | **Consolidación** | Mudanza del repo a E:, documentación integral, checklist de producción |

## 2. Catálogo maestro de errores (consolidado por categoría)

### Infraestructura / Render
| Error | Causa | Fix |
|---|---|---|
| CORS bloquea login | `CORS_ORIGIN` sin `https://` (fromService inyecta host pelón) | Hardcodear URL completa; múltiples orígenes separados por coma sin espacios |
| Build sin devDependencies | `npm ci` en prod las omite | `npm ci --include=dev && npm run build` |
| Node 26 rompe el build | Render usa la última si no se pinnea | `engines.node: "20.x"` + `.nvmrc` |
| tsc no copia binarios | `.gz`/assets no son TS | `scripts/copy-assets.js` post-build |
| Archivos suben pero desaparecen | Starter sin disco persistente | BYTEA en BD (logo, CSD); FS solo como cache |
| **Failed deploy** por migración | `CREATE OR REPLACE VIEW` reordenando columnas | `DROP VIEW IF EXISTS` + `CREATE` (migración transaccional → el fallo no dejó registro) |
| Modal eterno "Cargando…" | Código SELECT de columnas inexistentes (42703) | Migración `ADD COLUMN IF NOT EXISTS`; nunca evolucionar código sin su migración |

### PAC / SAT
| Error | Causa | Fix |
|---|---|---|
| "El token debe contener 3 partes" | JWT pegado con prefijo/`...`/saltos | Validar 2 puntos exactos; re-pegar limpio |
| "Fecha fuera del rango permitido" | `getHours()` en server UTC (6 h adelante) | `toLocaleString('sv-SE',{timeZone:'America/Mexico_City'})` |
| "XmlCFDI no proporcionado" | Flujo XML esperaba xml_content inexistente | Serializer `buildCFDIJson` + `stampFromJson` (ruta JSON) |
| Toast "MODO SIMULACIÓN" con timbre real | provider hardcodeado en controller y UI | Devolver `provider`/`is_mock` reales; endpoint diagnóstico `/pac/providers` con flags de env |
| Cancelación 404 (siempre) | `rfcEmisor='ABC010101ABC'` placeholder | Leer `companies.rfc`; regla: placeholders deben tronar |
| Cancelación 404 (sandbox intermitente) | Bug de vault sandbox + endpoint legacy | Endpoint v4 `/v4/cfdi/cancel/{rfc}`, parseo códigos 201/202/205, bypass `forceLocal` + resend |
| Factura MOCK no cancela en SW | SW nunca conoció ese UUID | Detectar `pac_id='MOCK'` → cancelar solo local |

### Datos / cálculos
| Error | Causa | Fix |
|---|---|---|
| Factura pagada seguía "Pago parcial" | Status ignoraba NC (`pagos >= total`) | `cubierto = pagos + NC`; migración one-shot que recalculó histórico |
| Saldo insoluto = monto de la NC | `ImpSaldoAnt` sin restar NC | Restar NC vigentes en XML del REP y en su PDF |
| Cancelar pago no liberaba la factura | 8 subqueries sumaban pagos cancelados | `AND document_status != 'CANCELLED'` en todas; lección: centralizar |
| Checkbox XML del pago siempre gris | Endpoint devolvía `uuid AS payment_uuid`, UI leía `p.uuid` | Quitar el alias (contrato de API consistente) |
| PDF "No. Certificado — pendiente" | XML local de NC/REP sin atributos Anexo 20 | Incluir `NoCertificado` + `Emisor`/`Receptor` en el XML generado localmente |

### PDF / UI
| Error | Causa | Fix |
|---|---|---|
| Emojis como `Ø=Ý` en PDF | Helvetica sin glifos emoji | Íconos con SVG paths de Lucide via `doc.path()`/`doc.circle()` |
| "−" renderizaba como coma | U+2212 no está en la fuente | ASCII `-` |
| Botón borrar/editar "no hace nada" en prod | `fetch('/api/…')` relativo o método inexistente en el api client | Siempre el cliente axios con baseURL; TS habría detectado el método faltante sin `as any` |
| Botón Cancelar invisible (círculo vicioso) | Acción dentro de `{r.uuid && …}` | Acciones de estado nunca condicionadas a datos opcionales |
| Logo de 7 MB | Asset del sitio era el mockup 4000×2667 | sharp `extract` + `resize(256)` con verificación visual |

## 3. Recetas y atajos (copiar/pegar)

### SQL de emergencia (Render Shell)
```bash
# Reset contraseña super-admin
psql $DATABASE_URL -c "UPDATE users SET password_hash = crypt('NuevaPass1!', gen_salt('bf',12)), password_change_required=false WHERE email='superadmin@plataforma.local';"
```

### Diagnóstico PAC end-to-end (PowerShell, sin DevTools)
```powershell
$b="https://gdmfac-backend.onrender.com"
$t=(Invoke-RestMethod -Method Post -Uri "$b/api/v1/auth/login" -ContentType application/json -Body (@{email="…";password="…"}|ConvertTo-Json)).data.token
Invoke-RestMethod -Uri "$b/api/v1/pac/providers" -Headers @{Authorization="Bearer $t"} | ConvertTo-Json -Depth 5
# → active/is_mock/env_sw_token_present dicen exactamente qué está mal
```

### Scripts npm del repo
```
backend:  reset:company -- <RFC>   · docs:icons   · migrate:up (auto en start:prod)
frontend: build:hosting            · build        · dev
```

### Flujo de trabajo diario
```powershell
cd E:\Obsidian\GDM_FAC ; git pull        # empezar
# …cambios…  (tsc --noEmit en backend/frontend antes de commitear)
git add … ; git commit -m "feat/fix: …" ; git push   # Render deploya solo
```

## 4. Checklist para replicar en un proyecto nuevo

1. [ ] Monorepo `backend/ + frontend/` + `render.yaml`; pinnear Node y TS
2. [ ] `schema.sql` base + `migrations/` idempotentes + runner que aborta el boot
3. [ ] Auth JWT con tenant en el token; guards por rol Y por URL
4. [ ] Binarios en BYTEA desde el día 1 (no filesystem)
5. [ ] Integraciones externas tras interfaz provider (MOCK primero)
6. [ ] Cliente API único en frontend (nada de fetch suelto); sin `as any`
7. [ ] Cálculos de dinero en UN helper/vista; probar con el caso "cancelado"
8. [ ] Fechas fiscales SIEMPRE con timeZone explícita
9. [ ] Scripts npm para toda operación repetible + endpoint de diagnóstico
10. [ ] Documentar al cerrar cada ronda: BITACORA (qué/por qué) + BUGS (síntoma/causa/fix)
