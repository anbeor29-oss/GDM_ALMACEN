# Recuperación: enlaces del respaldo (XML ↔ póliza)

> Fecha: 2026-11-09. Relacionado con `E:\Banco\NEXO_Requerimientos_Recuperacion_Respaldos_Tesoreria_RFC_XML.md`.
> Commits: `d2804b7` (herramienta B), `4d3cce0` (arreglo del enlace «Abrir asignación»).

## El síntoma

Tras recuperar un respaldo (Contalink/CPQ) aparecen avisos como:

- «Faltan N de compra producto(s) por clasificar en AAAA: sus facturas NO entran en la póliza ni en esta balanza.»
- En **Asignación de cuentas → Compras**: muchas «Pendiente», «Contabilizada · 0».
- En **Memoria por RFC**: «6602 pólizas importadas · 0 del motor», pero «4748 facturas de compra, sólo 820 con póliza (17.3 %), 3928 XML sin póliza».

…aunque la contabilidad del respaldo **ya entró y cuadra**.

## La causa raíz (NO es un bug)

Hay **tres cosas en tablas distintas**:

| Capa | Tabla | Estado típico |
|---|---|---|
| El XML (la factura) | `cfdi_recibidos` | ✅ existe |
| La póliza del respaldo | `journal_entries` + `journal_lines` | ✅ existe, entró tal cual |
| El **enlace** XML↔póliza (el UUID) | `journal_entry_cfdi.uuid` · `journal_lines.uuid_cfdi` · `journal_entries.origen_uuid` | ❌ **falta** |

La pantalla de Asignación y el aviso «por clasificar» preguntan **factura por factura**: «¿este UUID ya está en una póliza?». Eso se responde con el **enlace por UUID** (`cfdiYaContabilizado`, 3 vías, en `modules/accounting/cfdi-contabilizado.ts`).

El importador de Contalink sólo graba ese enlace cuando el Excel trae el bloque **«CFDI Asociados a la póliza»** (ver `contalink-import.service.ts`, inserción a `journal_entry_cfdi`). Si ese bloque **no viene**, la póliza se asienta correcta y cuadrada, pero **sin saber a qué XML corresponde**. Resultado: el XML aparece como «sin póliza / por clasificar» aunque ya esté contabilizado.

**Peligro:** el motor tampoco ve el enlace, así que si se le da **«Generar»** en esos periodos del respaldo, **duplica** la póliza. El arreglo «respetar el respaldo» sólo funciona donde el enlace existe.

CPQ (CONTPAQi) tiene el mismo patrón: liga por `journal_lines.uuid_cfdi` sólo cuando la póliza traía un único CFDI.

## Opción A (la limpia) — acción del usuario

Reexportar de Contalink el **libro diario con la sección «CFDI Asociados a la póliza» activada** y reimportarlo. El importador ya la sabe leer → los enlaces se llenan solos. No requiere código.

## Opción B (red de seguridad) — herramienta `d2804b7`

`modules/accounting/reparar-enlaces.service.ts`. Para cada XML **sin enlace**, busca su póliza de respaldo probable y, si la identifica con seguridad, graba **sólo** el enlace faltante en `journal_entry_cfdi` (no toca importes ni cuentas; idempotente).

**Cómo empareja (conservador — ante la duda, no enlaza):**

- Candidata = póliza de **respaldo** (`origen='CONTPAQI'` · `origen_uuid LIKE 'CTLK:%'` · `regla LIKE '%migrado%'`), del tipo correcto (compra↔recibidos, venta↔emitidos), **aún sin ligar** a ningún CFDI.
- **Importe EXACTO** (a 1 centavo): total del CFDI = suma de cargos de la póliza. Los centavos son muy discriminantes.
- **Fecha** dentro de ±45 días.
- **Unicidad 1:1**: sólo enlaza si queda **exactamente una** candidata libre. 2+ = ambiguo (no toca); 0 = sin candidata (de verdad no está en el respaldo). Una candidata consumida no se reusa.

**Confianza** (como la bandeja del agente):

- **ALTA** — la póliza trae RFC de tercero y coincide con el del CFDI.
- **MEDIA** — la póliza no trae RFC, pero su concepto contiene el **folio** o el **nombre** del tercero.
- **BAJA** — sólo importe exacto único + tipo + fecha.

Una póliza con RFC que **no** coincide se descarta (evidencia en contra), nunca baja a BAJA.

**Dónde:** Contabilidad → Asignación de cuentas → pestaña **Memoria por RFC** → tarjeta **«Reparar enlaces del respaldo»**.
**Flujo:** elegir año (o Todos) → **Analizar (simulacro)** (no toca nada; da conteos Alta/Media/Baja/ambiguos/sin candidata + muestra) → **aplicar** por nivel (Sólo Alta → Alta+Media → Todas).
**Endpoints:** `GET /accounting/enlaces-respaldo/diagnostico?anio` · `POST /accounting/enlaces-respaldo/reparar` `{ anio?, aplicar?, confianza? }`.
**API front:** `getDiagnosticoEnlaces`, `repararEnlacesRespaldo`.

El **diagnóstico** (parte superior del panel) muestra por año: XML recibidos/emitidos, cuántos ya enlazados, y cuántas pólizas de respaldo hay — para ver cuánto es «ya está, sólo falta enlazar» vs «de verdad no está en el respaldo».

### Orden recomendado

1. **A**: reexportar con el bloque CFDI y reimportar.
2. **B**: para lo que A no haya podido enlazar, correr el reparador (Alta primero, revisar, subir nivel).

## Arreglo del enlace «Abrir asignación» — `4d3cce0`

El aviso «por clasificar» (en `Estados.tsx`) tenía `<a href="/contabilidad/asignacion">`, que forzaba **recarga completa** y fallaba. Se cambió a navegación SPA (`useNavigate`), igual que el resto de la app. Mismo arreglo para el enlace a «Periodos».

## Nota sobre «Resultado del ejercicio 2025/2026/2027»

`crearResultadoIntegralTodas` (`cierre-ejercicio.service.ts`) recorre **todas las empresas con catálogo** (`accounting_accounts JOIN companies`). Si reporta «2 empresas» es porque **sólo 2 tienen catálogo cargado** en la base (las demás vacías o reiniciadas con «Borrar respaldo»). No es un bug; para darles la cuenta de resultado primero hay que importarles su catálogo (necesita la madre 305).

## Despliegue

- Push: `git push gdmalmacen erp-unificado:main`.
- Render: Manual Deploy **backend** (endpoints de B) **y frontend** (panel + arreglo del enlace).
- Hosting México: `npm run build:hosting` → `frontend/dist-hosting/nexo-erp-hosting.zip`; subir la carpeta interna `erp/` a `public_html/`. El front del hosting pega al backend de Render, así que el backend debe tener `d2804b7`.
