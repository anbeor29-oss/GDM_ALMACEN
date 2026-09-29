# NEXO Compliance API — Plan de trabajo

**Fecha:** 2026-09-29 · **Base:** `E:\Banco\NEXO_COMPLIANCE_API_ARQUITECTURA.md` (arquitectura aprobada)
**Objetivo:** motor que obtiene y da seguimiento a los documentos de cumplimiento (SAT Opinión 32-D,
SAT CSF/CIF, IMSS Opinión, INFONAVIT Constancia) de forma manual y automática, comercializable como API.

---

## 0. Adaptaciones a la realidad de NEXO (lo que cambia del documento base)

| Punto del doc | Realidad NEXO | Decisión |
|---|---|---|
| Stack .NET/C#/SQL Server/Hangfire | Node + TypeScript + PostgreSQL en Render | Se **conserva la arquitectura** (adaptadores, scheduler, auditoría) y se implementa en el stack de NEXO. NO se introduce .NET. |
| "NUNCA guardar credenciales" (efímero) | **Facturación (CSD) y descarga de XML (e.firma) corren a diario, desatendidos** → hay que tenerlas guardadas | **Se GUARDAN cifradas en la bóveda** (AES-256 / `SAT_VAULT_KEY`, pgcrypto), como ya lo hace NEXO. El motor de cumplimiento **reusa** esa misma bóveda; no hay flujo efímero por consulta. |
| "Compliance API independiente" (microservicio) | Hoy 1 backend en Render; "en algún momento nos iremos a la nube" | Se construye como **módulo AISLADO** (`modules/compliance/`) con fronteras limpias (contrato REST + tablas propias), **listo para EXTRAER** a un microservicio cuando se migre a la nube grande. |
| Tablas nuevas (Providers/Services/Config/…) | Ya existen `opinion_cumplimiento` (evidencia) y `cumplimiento_config` (config+credenciales cifradas) | Se **reconcilia**: se reusan esas tablas y se AGREGAN solo `compliance_execution` y `compliance_result`/auditoría del motor. |
| CAPTCHA / MFA | El SAT por CIEC tiene CAPTCHA; el e.firma no | Nunca se evade → estado **`REQUIRES_USER_ACTION`**. Se prioriza el camino **sin CAPTCHA** (opinión pública opt-in / e.firma server-to-server). |

### Postura de seguridad (dado que SÍ guardamos credenciales)
Como el requisito de negocio (automatización diaria) obliga a **conservar** la e.firma/CSD, la seguridad no se
apoya en "no guardarlas" sino en:
- **Cifrado en reposo** (pgcrypto / `SAT_VAULT_KEY`), descifrado **solo en memoria** durante la operación, nunca en logs/serialización/disco.
- **Aislamiento por tenant** (toda consulta valida `usuario + company_id`; un cliente jamás ve documentos de otro).
- **Validación RFC de la credencial == RFC de la empresa** antes de usarla (`RFC_MISMATCH` → cancela).
- **Auditoría sin secretos** (nunca `password=`, `.key`, cookies, tokens en la bitácora).
- **PDFs cifrados en reposo** + SHA-256 + política de retención.
- **Fase nube:** mover los secretos a un **Vault gestionado** (Azure Key Vault / AWS Secrets Manager / HashiCorp) al migrar; el módulo ya expone un `ISecretStore` para cambiar el backend sin tocar el resto.

---

## 1. Prioridad de mecanismos por organismo (matriz de disponibilidad — §56 del doc)

**Antes de programar un adaptador se valida el mecanismo oficial vigente.** Orden de preferencia
(de más estable a más frágil):

1. **Opinión pública / tercero autorizado (por RFC, opt-in):** sin e.firma, sin CAPTCHA → **el más estable**. SAT e IMSS lo tienen. *Camino primario para las opiniones.*
2. **Web service oficial con e.firma** (server-to-server, sin CAPTCHA): como el de descarga de CFDI que NEXO ya usa. *Para CSF y donde exista.*
3. **Automatización del portal (RPA con e.firma):** solo donde no haya (1) ni (2). CAPTCHA/MFA → pausa asistida.

| Organismo | Servicio | Camino primario | Fallback |
|---|---|---|---|
| SAT | Opinión 32-D | Opinión pública / tercero autorizado (RFC) | e.firma portal (asistido si CAPTCHA) |
| SAT | CSF / CIF | e.firma / parseo del PDF (NEXO ya lee la CIF) | portal |
| IMSS | Opinión | Buzón IMSS con e.firma / tercero autorizado | RPA (herramienta local ya hecha) |
| INFONAVIT | Constancia | Portal Empresarial (validar mecanismo vigente) | — |

---

## 2. Arquitectura en NEXO

```
NEXO (ERP)  ──HTTPS + NEXO_SERVICE_TOKEN──▶  Compliance (módulo, hoy in-process)
                                              ├─ Auth (token de servicio) / Rate limit / Audit
                                              ├─ Scheduler (jobs: 5 días · día 1 · día 17)
                                              ├─ Bóveda (reusa la cifrada de NEXO)  ── ISecretStore
                                              └─ Adaptadores  IComplianceProvider
                                                   ├─ SatProvider      (opinión, CSF)
                                                   ├─ ImssProvider     (opinión)
                                                   └─ InfonavitProvider(constancia)
                                              ▼
                                        Evidencia: PDF + hash + metadatos  →  opinion_cumplimiento
```

- **`IComplianceProvider`** (interfaz TS): `ejecutar(req): Promise<ComplianceResult>`. Un adaptador por organismo, con capas: **Auth · Navegación · Adquisición · Validación** (§27). El código SAT/IMSS/INFONAVIT vive SOLO aquí; el resto de NEXO no lo toca.
- **Contrato REST** (igual in-process o extraído): `POST /compliance/execute`, `POST /compliance/{sat|imss|infonavit}/…`, `GET /compliance/results/:companyId`.
- **Extraíble a microservicio:** el módulo solo depende de la BD y de `ISecretStore`; al migrar a la nube grande se levanta como servicio propio detrás del mismo contrato.

### Tablas (Postgres — reusa + agrega)
- **Reusa:** `opinion_cumplimiento` (evidencia: tipo, sentido, fecha, folio, pdf), `cumplimiento_config` (por empresa+tipo: método, credencial/token cifrados, activo).
- **Agrega:** `compliance_config` (por empresa+servicio: manual/automático, frecuencia_dias, ultima/proxima ejecución), `compliance_execution` (STARTED/SUCCESS/ERROR/TIMEOUT/BLOCKED/REQUIRES_USER_ACTION, http_status, error), y auditoría (reusa la de NEXO). El PDF sigue en la bóveda de evidencia + `sha256`.

---

## 3. Plan de trabajo por fases

**Fase 0 · Validación y reconciliación (sin código de organismos)**
- Confirmar el **mecanismo oficial vigente** de cada servicio (matriz §1) — sobre todo la **opinión pública opt-in** (SAT e IMSS) y el tercero autorizado.
- Reconciliar el modelo con `opinion_cumplimiento` + `cumplimiento_config` existentes.
- Definir el `ISecretStore` (hoy = bóveda pgcrypto; mañana = Vault gestionado).

**Fase 1 · Núcleo del motor (sin organismos)**
- Migración: `compliance_config`, `compliance_execution` (+ estados), índices, tenant.
- Interfaz `IComplianceProvider` + `providerFactory` + `EphemeralCredentialContext` (descifra de bóveda → memoria → destruye).
- Endpoints internos (`/compliance/execute`, individuales, `/results/:companyId`) con **token de servicio** (Nivel 1), rate-limit, auditoría.
- **Scheduler**: jobs `due` cada N minutos → cola con `ConcurrencyLimit` por organismo → reintentos con backoff (TIMEOUT/500 sí; PASSWORD/CERT/CAPTCHA/MFA no).
- Almacenamiento de evidencia (PDF cifrado + SHA-256 + metadatos).
- **Sin conectar organismos todavía** (mock provider para probar el flujo).

**Fase 2 · Adaptador SAT** — primero **opinión pública (RFC)** + **CSF** (reusa el lector de CIF). CAPTCHA → `REQUIRES_USER_ACTION`.

**Fase 3 · Adaptador IMSS** — Buzón/e.firma o tercero autorizado (reusa lo aprendido en la herramienta local).

**Fase 4 · Adaptador INFONAVIT** — Portal Empresarial (validar mecanismo).

**Fase 5 · Panel + parámetros + alertas + comercialización**
- Panel **Clientes → Cumplimiento** (extiende la pantalla Opinión 32-D): estado por servicio, [Consultar], [Consultar todo], última/próxima, [PDF].
- Parámetros por empresa: interruptor por servicio, modo (manual / automático / ambos), **frecuencia (5 días por defecto; presets día 1 SAT · día 17 IMSS)**, hora fuera de horario.
- Alertas (opinión no positiva, documento/certificado por vencer) sin convertir errores técnicos en "negativa".
- **API externa comercializable:** el mismo contrato con **API keys por cliente**, cuotas y **OpenAPI/Swagger** → se vende a despachos/sistemas.

---

## 4. Estados (nunca convertir error técnico en "negativa")
`POSITIVA · NEGATIVA · SIN_OPINION · VIGENTE · VENCIDA · NO_DISPONIBLE · ERROR_AUTENTICACION · ERROR_PORTAL · CAPTCHA(REQUIRES_USER_ACTION) · MFA(WAITING_USER_AUTH) · TIMEOUT · PENDIENTE`. Solo el documento oficial define el resultado.

---

## 5. Comercialización
- **Nivel 1** NEXO→API (token de servicio) ya sirve como base de la **API pública de terceros** (API key + cuota + OpenAPI).
- El producto vendible más **estable** es **"Consulta de Opinión por RFC"** sobre la **opinión pública opt-in** (sin e.firma, sin CAPTCHA, bajo mantenimiento) — se puede exponer y cobrar por consulta o suscripción.
- Modelo de cobro: se ata al de facturación por usuario ya existente, o cuota por consulta para clientes API externos.

---

## 6. Decisiones ya tomadas / pendientes

**Ya decidido:**
- **Frecuencia:** **día 1 de cada mes (SAT)** y **día 17 (IMSS)** — tal como lo indicaste. El default de 5 días del doc queda solo como opción de respaldo.
- **Credenciales:** se **guardan cifradas** en la bóveda (tu corrección) porque facturación + descarga de XML corren a diario.
- **Vault:** bóveda actual (pgcrypto) por ahora; Vault gestionado al migrar a la nube grande.

**Confirmado por el usuario (2026-09-29):**
1. **Orden de organismos:** **SAT (opinión 32-D + CSF) primero**, luego IMSS (reusa la herramienta local), luego INFONAVIT.
2. **API:** **uso interno de NEXO primero** (token de servicio); se abre a terceros después.
   - **Superficie futura (post-apertura):** evaluar integración a **hojas de Excel** y a **apps tipo la del IVA** (consumir la API desde herramientas ofimáticas/fiscales externas). No se construye ahora; se contempla en el diseño del contrato para no cerrarle la puerta.

---

## 7. Estado de avance

**Fase 1 — Núcleo del motor: IMPLEMENTADA (2026-09-29, compila `tsc --noEmit` OK).** Nada toca portales reales todavía; el mock y el cron van *gated* por variables de entorno.

Piezas creadas (`backend/src/modules/compliance/` salvo donde se indica):
- **Migración** `2026-09-29d_compliance_motor.sql`: programación en `cumplimiento_config` (modo, dia_mes, frecuencia_dias, última/próxima, último_estado), tabla `compliance_execution` (bitácora con estado técnico, sin secretos) y en `opinion_cumplimiento` los campos `sha256` + `execution_id` + `origen`.
- **`types.ts`** — separa ESTADO técnico de SENTIDO fiscal.
- **`credential-context.ts`** — `EphemeralCredentialContext`: descifra credenciales de la bóveda sólo en memoria y las suelta (`dispose`).
- **`provider.interface.ts`** — `IComplianceProvider` (Auth·Navegación·Adquisición·Validación; CAPTCHA/MFA → `REQUIRES_USER_ACTION`).
- **`providers/`** — `pendiente.provider` (no inventa: pide acción del usuario), `mock.provider` (`COMPLIANCE_MOCK=true`, PDF simulado), `index.ts` (factory `getProvider`).
- **`compliance.service.ts`** — orquestador `ejecutar` / `ejecutarTodos` / `bitacora` (abre ejecución → adaptador → guarda evidencia+SHA-256 si SUCCESS → cierra y reprograma → `dispose` siempre).
- **`programacion.ts`** — próxima ejecución (SAT/CSF día 1, IMSS día 17; o cada-N-días) y `pendientes()` para el scheduler.
- **`jobs/compliance-cron.ts`** — corre lo vencido cada hora; *gated* por `ENABLE_COMPLIANCE_CRON=true`. Registrado en `index.ts`.
- **Reconexión:** `opinion-cumplimiento.service.descargarAutomatico` ahora delega al motor; `setConfig`/`getConfig` manejan la programación; rutas nuevas `POST /opinion-cumplimiento/todas/descargar` y `GET /opinion-cumplimiento/bitacora`.

**Cómo probar el flujo sin portales:** poner `COMPLIANCE_MOCK=true` (y `SAT_VAULT_KEY`), pulsar "Consultar" en el tracker → se registra una ejecución SUCCESS con evidencia y hash; con la variable apagada, responde `REQUIRES_USER_ACTION` (no inventa).

**Fase 2 — Adaptador SAT: IMPLEMENTADA (2026-09-29, `tsc` OK + `jest` 12/12).**
- **`providers/sat.provider.ts`** — `SatProvider` para Opinión 32-D y CSF. Consulta por RFC (en el CUERPO, nunca en la URL) contra el ORIGEN configurado; despacha por `content-type` (PDF → lee texto con `pdf-parse` e infiere sentido; JSON → parser; HTML → detecta login/CAPTCHA → `REQUIRES_USER_ACTION`). e.firma/portal → `REQUIRES_USER_ACTION` (no se automatiza aquí). Errores HTTP mapeados (401/403, 404, 429, 5xx, timeout). Ruteado en la factory para SAT y CSF.
- **`sat-parse.ts`** — funciones PURAS (mapear sentido, detectar login/CAPTCHA, clasificar HTTP, interpretar JSON, validar RFC) con **12 pruebas** (`sat-parse.test.ts`). Nunca traduce un error técnico a sentido fiscal ni inventa opinión.

**Contrato del ORIGEN SAT (lo que falta validar — Fase 0 del SAT):** el adaptador está listo; para encenderlo se captura en `cumplimiento_config` (método **API**) la **URL del origen** + token. El adaptador hace `POST {url}` con `{"rfc","tipo"}` y espera **una de dos**:
- **JSON:** `{ "sentido": "Positiva|Negativa|Sin adeudos|Vigente", "fecha": "AAAA-MM-DD", "folio": "…", "pdfBase64": "…" }`, o
- **PDF** directo (`content-type: application/pdf`) — infiere el sentido del texto.

Ese origen es la **consulta pública opt-in del SAT por RFC** (o el servicio que la exponga), y **validar la URL real es el paso que requiere inspección del portal / tu confirmación** — no se cablea a mano una URL del SAT. Sin origen configurado, el adaptador responde `REQUIRES_USER_ACTION` (no inventa). Se prueba de punta a punta apuntándolo a un endpoint propio que devuelva el JSON de arriba.

**Origen SAT elegido (2026-09-29): herramienta LOCAL con e.firma** (como la del IMSS). Creada en `tools/sat-opinion/` (Playwright): accede al SAT **con e.firma, no con CIEC**, para evitar el CAPTCHA; baja el PDF de la Opinión 32-D (`npm run sat`) o de la CSF (`npm run csf`); lee el **sentido del propio documento** (pdf-parse) y **lo registra en NEXO** (`POST /accounting/opinion-cumplimiento`, opcional con `NEXO_TOKEN`). Incluye `inspeccionar.mjs` + `--inspect` para calibrar selectores y **detección de CAPTCHA** (si aparece, se detiene: no se evade). Corre en la PowerShell del usuario, NO en Render. **Pendiente:** el usuario calibra los selectores del portal real con `npm run inspect:sat32d` y me pasa el JSON para fijar `selectors` + `tramites.SAT.docUrl`.

Nota: el `SatProvider` server-to-server (Fase 2, camino API por RFC) sigue disponible para cuando exista un origen HTTP directo; hoy el camino operativo del SAT es esta herramienta local con e.firma.

**Siguiente:** calibrar selectores del SAT (usuario); luego Fase 3 (IMSS) y el panel (Fase 5).
