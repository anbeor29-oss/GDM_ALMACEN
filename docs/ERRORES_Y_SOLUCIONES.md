# Errores y soluciones — GDM NEXO

> Registro **curado** de errores que ya nos costaron tiempo, con su causa REAL, la
> solución que quedó y —muy importante— los intentos que **NO** funcionaron, para no
> volver a diagnosticar desde cero ni repetir un arreglo que ya resultó contraproducente.
>
> Es distinto de `BITACORA.md` (diario cronológico): aquí cada entrada es un
> **síntoma → cómo diagnosticarlo → causa → solución → qué NO hacer → límite conocido**.

---

## 1. «Network Error» al importar (Contalink u otro proceso largo)

**Síntoma.** La pantalla de import (p. ej. Contalink → «Subir pólizas») muestra un
recuadro rojo **«Network Error»**. A veces, al mismo tiempo, otras acciones fallan igual
(p. ej. **«No se pudo cambiar de empresa — Network Error»**).

**Cómo DIAGNOSTICAR (no suponer).**
1. `Network Error` de axios = **no llegó NINGUNA respuesta HTTP** (conexión cerrada/reset),
   no es un 4xx/5xx. No es timeout del cliente: el axios de este proyecto no pone `timeout`
   (default infinito).
2. Si **también** fallan acciones no relacionadas (cambiar de empresa), el **backend
   entero está caído**, no sólo el import.
3. Confirmarlo con el health del backend desplegado:
   ```bash
   curl -s https://gdm-almacen-backend.onrender.com/health
   ```
   Si `commit` es el esperado pero `uptime` se **reinicia** entre llamadas (y a ratos
   responde **502**), el proceso está en **crash-loop**: algo lo está matando.

**Causa raíz (la que nos mordió, 2026-11-16).** El import corre miles de pólizas en UNA
petición (decenas de miles de consultas → minutos). Mantener viva esa conexión con un
«latido» que escribe al socket en un `setInterval` **TUMBA el proceso**: cuando la conexión
ya está cerrada, `res.write` provoca un evento **`'error'` ASÍNCRONO del stream SIN
listener** → Node lo eleva a `uncaughtException` → el handler global de
`backend/src/index.ts` hace **`process.exit(1)`** → se cae **TODO** el backend (por eso
moría también «cambiar de empresa»).

**❌ Lo que NO hay que volver a hacer.**
- **NO** mantener abierta una petición HTTP larga para un proceso de minutos.
- **NO** escribir a `res` desde un `setInterval`/`setTimeout` (el «latido»
  `responderConLatido`, ya **eliminado**). Un error de socket sin manejar = `process.exit`.
- Recordar que `backend/src/index.ts` hace `process.exit(1)` en `uncaughtException`:
  **cualquier** excepción no atrapada (no sólo la del import) tira el servidor.

**✅ Solución que quedó (commit `eaa3dba`).** Patrón **trabajo en segundo plano + sondeo**:
- `backend/src/modules/accounting/import-jobs.ts`: registro en memoria.
  `correrImportEnFondo` difiere con `setImmediate` (para que el `res.json(jobId)` salga
  antes del parseo síncrono) y envuelve el trabajo en `.then/.catch` → **un error NUNCA
  escapa**, se guarda en el job, no puede tumbar el proceso.
- El POST (`/contalink/polizas`, `/contalink/catalogo`) **responde al instante con
  `{ jobId }`**; `GET /contalink/importar/:jobId` (aislado por empresa) da estado/avance.
- El front sube (0-40 %), obtiene `jobId` y **sondea** (40-99 %) hasta `listo`/`error`;
  **tolera reinicios** (reintenta) y un **404** = el job se perdió → «vuelve a subir, no se
  duplica» (el import es idempotente por hash `CTLK:*`).

**Regla general.** Todo proceso de más de ~15-20 s sobre HTTP va con **jobId + sondeo**,
nunca manteniendo la petición abierta ni escribiendo al socket para «ganar tiempo».

**El patrón en segundo plano resolvió el crash del latido** (ya no se cae por `uncaughtException`
del socket): CORS, ruta de avance y bundle en vivo verificados OK; con el backend ocioso el
`uptime` crecía sin reiniciarse.

**PERO el archivo GIGANTE SÍ revienta la RAM (OOM) — corregido 2026-11-17.** (El supuesto previo
de «no es OOM» era FALSO: salía de medir sólo la memoria RETENIDA tras el parseo, no el PICO
transitorio.) Al subir de verdad un libro de **todos los años (~8 MB)**, el parseo síncrono del
`.xls` **pasa de los 512 MB del plan starter** → el OS mata el proceso → crash-loop (`/health`:
`uptime` de ~113 s y luego **502**). Como el parseo corre en segundo plano (`setImmediate`), el POST
ya devolvió el `jobId`; el sondeo entonces falla y el front muestra **«Se perdió la conexión…»** (y
un POST durante el reinicio = **«Network Error»**). Eso cuadra con las dos capturas.

**✅ Arreglo (memoria del parseo, bajo riesgo, sin tocar la máquina de estados):**
- `XLSX.read(..., { cellFormula:false, cellHTML:false })` → mucha menos RAM por celda.
- `sheet_to_json(..., { blankrows:false })` → NO materializa las filas VACÍAS (son no-ops); en un
  libro con miles de blancos entre bloques eso ahorra el grueso del arreglo.
- `delete wb.Sheets[nombre]` tras procesar cada hoja → no quedan TODAS las hojas en RAM a la vez.
- **Medido:** la memoria del parseo bajó **de 14.6 MB a 7.7 MB (~mitad)** en el archivo de prueba, con
  **salida idéntica** (598 pólizas, 3 412 movs, 223 CFDI, 0 descuadres) → el pico del libro grande baja
  en proporción y debe caber en 512 MB.
- **Si aun así un libro fuera demasiado grande:** exportarlo **por AÑO** (idempotente, aditivo) o
  **subir la RAM** de Render (plan Standard) — eso lo resuelve para cualquier tamaño.

**Verificado (parser), idéntico antes y después del arreglo:** 598 pólizas, 3 412 movs, 223 CFDI,
0 descuadres.

---

## 2. CSD / timbrado — «No se pudo cargar la llave privada» (bad decrypt)

`bad decrypt` = la **contraseña NO abre la `.key`** (no es vigencia). Detalle y guía en
`docs/CSD_TIMBRADO.md` y la memoria [[csd-timbrado-llave]].

---

## 3. Codificar pólizas «Todo el año» → `date/time field value out of range: "2026-00-01"`

**Síntoma.** Al codificar las pólizas pendientes con **«Todo el año»** seleccionado, Postgres truena con
`date/time field value out of range: "2026-00-01"` y no se contabiliza nada.

**Causa raíz.** Con «Todo el año» el front mandaba `mes = 0`; en `polizas.service.ts` el helper
`iniDeMes(anio, 0)` armaba literalmente `${anio}-00-01` → mes 0 no existe → fecha inválida.

**❌ Lo que NO hay que hacer.** Parchear sólo el front (seguiría roto si cualquier otra pantalla manda
mes = 0). El arreglo va en el **helper**, que es el origen único.

**✅ Solución (commit `f7bd659`).**
- `iniDeMes`/`finDeMes`: **mes 1–12** = ese mes; **mes 0 o fuera de rango** = **AÑO COMPLETO**
  (`${anio}-01-01` … `${anio}-12-31`). Un solo lugar, cubre todas las pantallas.
- `DocsContabilizar.tsx` pasa `todoElAnio = (mes === 0)` a `generarVentas/generarCompras` (las rutas
  `…DelAnio` ya existían en el backend).

**Verificado.** `tsc` backend + frontend verde.

---

## 4. Libro diario (respaldo NEXO): «las pólizas de enero a septiembre 2026 no se suben» (RFC saj10120859a)

**Síntoma.** Al importar el `libro-diario.xls` de saj10120859a, las pólizas de **ene–sep 2026** no aparecen.

**Cómo diagnosticar.** Réplica FIEL del parser (`raw:true`, misma máquina de estados) corrida sobre el
archivo real, contando pólizas y omisiones **por mes**.

**Hallazgo (el archivo NO es el problema).** El `.xls` (OLE2/BIFF8 real) parsea al **100 %**:
**240 pólizas**, Dic-2025 → Nov-2026, **ene–sep completas (183)**, en **orden cronológico** (0 saltos),
con **1 sola duplicada real** (2026-01-20, «iva de comisiones bancarias»). Ni el parser ni `crearPoliza`
descartan por mes; el `UNIQUE (company_id, origen_uuid)` es **por empresa** (no colisiona entre empresas).

**Causa raíz (BD / visibilidad, no el archivo).** El faltante de ene–sep es de **estado de la base**, no del
parseo: (a) el import no completó contra esa empresa, o (b) las pólizas entraron pero **falta reconstruir la
balanza** (los estados leen los **saldos de los periodos**, no las pólizas directas). Oct-Nov 2026
probablemente ya existían «en vivo» (operación reciente), por eso sí se ven.

**Qué hacer.** Importar respaldo → en la **pantalla verde de resultados**, botón **«Reconstruir todos los
ejercicios»** (o Balanza de comprobación → **«Reconstruir año»** 2026). Para confirmar qué hay realmente,
contar pólizas por mes en la BD (consulta en `docs/DIAGNOSTICO_POLIZAS_SAJ.sql`).

**✅ Mejora defensiva (commit `9911e40`).** `fechaDeCelda()` en `contalink-import.service.ts` acepta la
cabecera «Fecha» como **serial de Excel, Date o texto** (ISO / DD-MM-AAAA). ANTES sólo se aceptaba número:
si un export la escribía como Date o texto, **TODAS** las pólizas se caían como «sin fecha válida» y no
entraba nada. (En este archivo venía numérica, así que no era la causa aquí, pero blinda el caso.)

**Límite conocido.** Si Oct-Nov ya existían en vivo, re-importar el respaldo los **duplicaría** (la
idempotencia CTLK sólo coteja contra imports CTLK previos, no contra pólizas en vivo). Revisar duplicados
por mes tras el import si aplica.

---

## 5. «Ene–sep 2026 no cargan» (AABA020418BW2): pólizas FANTASMA (encabezado sin renglones)

**Síntoma.** La balanza anual 2026 de ALEJANDRO AYALA BARBA muestra **ENE–SEP en 0** y solo
OCT–NOV–DIC con saldo. Al re-importar el libro diario dice **«0 creadas · 183 ya estaban»** y la
reconstrucción integral solo toca **«3 meses»**. (Antes se pensó —entrada #4— que era solo falta de
reconstruir; el dato real lo dio la combinación «ya estaban» + «3 meses» + balanza 0.)

**Causa raíz.** Las 183 pólizas de ene–sep **existen como ENCABEZADO (`journal_entries`) pero SIN
renglones (`journal_lines`)** — una importación previa a medias creó la cabecera y no las partidas.
Entonces:
- El candado de idempotencia contaba por `origen_uuid` (sin mirar renglones) → **«ya estaban»** →
  nunca se re-creaban.
- La balanza/`reconstruirIntegral` se derivan de `journal_lines` (`alimentarAnioDesdePolizas` hace
  `JOIN journal_lines`) → esas pólizas **no existen** para la balanza → ene–sep en 0 y solo 3 meses
  reconstruidos (Dic-2025, Oct, Nov, que sí tienen renglones).

**❌ Lo que NO sirve.** Solo «Reconstruir año» (no hay renglones que sumar). Re-importar el archivo
completo (decía «ya estaban» y no sanaba; además duplicaría oct-nov si ya existen en vivo).

**✅ Solución (commit de esta fecha).** El importador **SANA** las fantasma:
- La idempotencia ahora solo cuenta pólizas CTLK **que tienen renglones**
  (`AND EXISTS (journal_lines)`), así una fantasma NO se considera «ya importada».
- Antes de re-crear cada póliza, un `DELETE … WHERE NOT EXISTS (journal_lines)` **borra la fantasma**
  (nunca toca una con renglones) para evitar chocar con el índice único `(company_id, origen_uuid)`.
- El reporte añade «N sanada(s)». Tras re-importar → **«Reconstruir todos los ejercicios»**.
- Para no duplicar oct-nov (que ya estaban en vivo), se entregó un **archivo filtrado solo ene–sep**
  (`libro-diario-AABA-ene-sep-2026.xlsx`, generado del respaldo; verificado: 183 pólizas, 0 omitidas).

**Diagnóstico BD.** `docs/DIAGNOSTICO_POLIZAS_SAJ.sql` (parametrizable por RFC) — y para ver fantasmas:
`SELECT count(*) FROM journal_entries je WHERE je.company_id=… AND je.origen_uuid LIKE 'CTLK:%' AND NOT EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.entry_id=je.id);`

**✅ CONFIRMADO funcionando (2026-11-18).** La pantalla «Periodos contables» del cliente mostró **«0 cerrados»** y
ene-sep en **«Sin saldos»** → NO era periodos cerrados, eran **fantasmas** (encabezado sin renglones). Lo que lo
resolvió, SIN desplegar: en el Web Shell de Render, `DELETE FROM journal_entries … AND NOT EXISTS (journal_lines)`
(borra los 183 encabezados vacíos) → re-importar `libro-diario-AABA-ene-sep-2026.xlsx` (ahora dice «183 creadas», ya
no «ya estaban») → **«Reconstruir todos los ejercicios»** → ene-sep con saldos. El auto-saneo del importador (commit
`62288e6`) hace lo mismo al re-importar, una vez desplegado.

**Límite conocido.** No se halló POR QUÉ la 1.ª importación dejó cabeceras sin renglones (crearPoliza es
transaccional); el saneo es idempotente y cubre el caso venga de donde venga.

---

## 6. «Al timbrar sale un error y se BORRA la pantalla» (pantalla en blanco)

**Síntoma.** El usuario da Timbrar, aparece un error y la **pantalla queda en BLANCO** (no se puede leer el error).

**Causa raíz.** DOS cosas encadenadas: (1) la app **no tenía ErrorBoundary**, así que un error durante el RENDER
desmontaba TODO el árbol de React y dejaba la página vacía; (2) el crash concreto era el **modal recordatorio de Uso
CFDI** (`TimbrarRecordatorio`, commit `7f9778d`): leía el catálogo SAT como `.data` y llamaba `.find()` →
`TypeError: o.find is not a function`. El catálogo de `api.getCatalog('usoCfdi')` viene en **`.data.entries`** (cada
entrada: `catalog_key` + `description`), NO en `.data`.

**Cómo diagnosticar.** Con el ErrorBoundary puesto, el error se LEE (ya no es blanco): `o.find is not a function` en
`tH` (ErpPrivado). DevTools → Console también lo muestra.

**✅ Solución (commits `d3c566e` + `aaf8c3c`).**
- **ErrorBoundary** (`components/ErrorBoundary.tsx`) envuelve el Router en `App.tsx`: ante cualquier crash de render
  muestra el error + detalle + botones (Copiar/Reintentar/Recargar) en vez de blanco. **Red de seguridad general.**
- Fix del modal: `const usos = Array.isArray((usosResp)?.data?.entries) ? … : []` y `u.catalog_key === uso`.
  El `Array.isArray` evita que vuelva a tronar aunque cambie la forma.
- `handleStamp` escribe el error COMPLETO (status+data) en la consola; blindado el acceso a `result.data`.

**❌ Lo que NO hay que hacer.** Dejar `.find()` directo sobre `response.data` de un catálogo sin verificar que es
arreglo (la forma es `{ success, data: { entries: [...] } }`, no un arreglo plano). Y no tener ErrorBoundary: un
error de render = pantalla en blanco imposible de diagnosticar.

**Límite conocido.** El ErrorBoundary SÓLO atrapa errores de RENDER; los de promesas (fetch/timbrado) van por try/catch.

---

## 7. Facturas PUE salían «Pendientes» e INFLABAN la cobranza

**Síntoma.** En el reporte de facturas (Excel/Historial) y en el menú de Facturas, folios PUE (p. ej. 295 y 300)
aparecían en rojo como «Pendiente» con saldo = total, aunque ya estaban pagadas. La cobranza se veía inflada.

**Causa raíz.** El saldo se calculaba `total − pagos − notas de crédito` para TODA factura. Una **PUE** (Pago en Una
Exhibición) se liquida con su forma de pago real **al timbrar** y **no lleva complemento de pago**, así que nunca
registra un `payment` → su saldo quedaba en el total completo. Sólo la **PPD** (Parcialidades/Diferido) lleva
complemento por cada pago y sí es cuenta por cobrar. Ver [[pue-ppd-cobranza-regla]].

**Cómo diagnosticar.** Una factura con `payment_method LIKE 'PUE%'`, timbrada y no cancelada, mostrando saldo > 0.
Los reportes de cobranza (`reports.service`) ya excluían PUE; el desajuste estaba en el **listado de facturas**
(`getInvoices`) y en el **historial** (`historial-facturas.service`).

**❌ Lo que NO hay que hacer.** Calcular el saldo de una PUE como `total − pagos`: nunca habrá pagos registrados, así
que siempre dará el total. No mezclar PUE con PPD en los controles de cobranza.

**✅ Solución (commit `7145a8e`).**
- `getInvoices` (invoices.service): el saldo y el pagado ahora llevan `CASE WHEN payment_method LIKE 'PUE%'` →
  `balance = 0`, `paid_total = i.total`, y se expone la bandera `es_pue`.
- `Invoices.tsx`: el badge de Estado muestra **«Pagada»** cuando la factura es PUE + timbrada + no cancelada
  (el saldo ya llega en 0 desde el backend).
- `historial-facturas.service`: en el mapeo, una PUE no cancelada se marca `PAGADA` (verde) con saldo 0.
- `reports.service` ya excluía PUE (sin cambios).

**Límite conocido.** La regla se basa en `payment_method`. Si una factura PUE se capturó con método vacío/incorrecto,
no se detecta como PUE; el método debe venir correcto del alta/timbrado.

---

<!-- Plantilla para una entrada nueva:
## N. <síntoma corto>
**Síntoma.** …
**Cómo diagnosticar.** …
**Causa raíz.** …
**❌ Lo que NO hay que hacer.** …
**✅ Solución (commit `xxxxxxx`).** …
**Límite conocido.** …
-->
