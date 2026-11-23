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

## 8. Pólizas → Nómina (emitida): corridas de un mes no aparecían (se filtraban por día de PAGO)

**Síntoma.** En **Contabilidad → Pólizas → Nómina → Nómina emitida**, al elegir un mes concreto (p. ej. **julio 2026**)
la tabla salía vacía («Sin corridas de nómina») y el botón **«Bajar pendientes»** quedaba deshabilitado, aunque la
nómina de todo el año ya estaba generada/timbrada. En **«Todo el año»** sí aparecían.

**Causa raíz.** El filtro de mes del frontend tomaba el mes de **`fecha_pago`** (y si no, de `fecha_fin`). La
provisión de nómina es **devengo**: pertenece al mes que **cubre** la corrida, no al día en que se paga. Si a una
corrida de julio se le fijó `fecha_pago` en los primeros días de agosto (pago el 5 de agosto), caía en **agosto** y
julio quedaba vacío. Mezclaba fecha de **caja** con mes **contable**.

**Cómo diagnosticar.** Cambiar el selector de mes a **«Todo el año»**: si ahí aparecen las corridas pero en el mes
concreto no, el problema es el criterio de mes, no los datos ni el aislamiento de empresa. El endpoint
`/nomina/poliza-periodos` no filtra por fecha (devuelve todo); el filtro vivía sólo en `PolizasHub.tsx`.

**❌ Lo que NO hay que hacer.** Clasificar el mes contable de una provisión de nómina por `fecha_pago`. La fecha de
pago es caja; el devengo lo marca el periodo (`fecha_inicio`/`fecha_fin`, o el `numero` del mes para MENSUAL).

**✅ Solución (commit `1950b14`).**
- `PolizasHub.tsx` (NominaEmitida): nuevo `mesPeriodo(p)` → para **MENSUAL** usa `numero` (1–12); para lo demás, el
  mes de **`fecha_fin`** (cierre del periodo), con respaldo `fecha_inicio`/`fecha_pago`. El filtro `enPeriodo` ahora
  empareja `anio` + `mesPeriodo`, sin usar `fecha_pago`.
- La columna «Fecha» de la fila muestra `fecha_fin` (devengado) en vez del día de pago, para que concuerde con el mes.
- «Nómina recibida» no cambia: filtra en el backend por su propia fecha de CFDI (otra semántica).

**Límite conocido.** Una corrida SEMANAL que cierra el primer día del mes siguiente (p. ej. semana que termina el 1
de agosto) se archiva en ese mes de cierre. Es una convención consistente (el periodo cierra en agosto); si se
quisiera por inicio, se cambiaría a `fecha_inicio`.

---

## 9. Pólizas → Nómina (emitida) seguía vacía: la nómina se timbró FUERA del módulo de Nómina

**Síntoma.** Tras el arreglo #8, **Nómina emitida** seguía en «Sin corridas de nómina» y «Bajar pendientes»
deshabilitado, aunque la nómina de todo 2026 estaba timbrada. La **Nómina recibida** sí aparecía.

**Causa raíz.** La pestaña sólo leía las corridas del **módulo de Nómina** (`nomina_periodos` + `nomina_recibos`).
Esta empresa timbra su nómina en **otro sistema**: no hay corridas en el módulo; sus recibos sólo existen en la
**bóveda de XML** (`cfdi_recibidos`, `direccion='emitidos'`, `tipo_comprobante='N'`), que llena la descarga del SAT.
La recibida sí salía porque ésa siempre leyó la bóveda. Además, `/nomina/*` exige el módulo de Nómina
(`requireModule('nomina')`) y si falla, la tabla mostraba «Sin corridas» **sin enseñar el error**.

**❌ Intento que NO resolvió (registrado).** El #8 (mes por periodo devengado, no por `fecha_pago`) es correcto y se
queda, pero sólo arregla empresas que SÍ usan el módulo. Aquí no había corridas que filtrar.

**❌ Lo que NO hay que hacer.**
- Reconstruir las corridas DENTRO del módulo (crear periodos/recibos/trabajadores desde el XML): crear un trabajador
  exige confirmación explícita (importar-xml.service) y alteraría acumulados de ISR, PTU, aguinaldo y la revisión anual.
- Contabilizar la bóveda sin candados: los recibos que timbró el propio módulo TAMBIÉN están en la bóveda (su póliza
  de corrida no lleva los UUID) y los respaldos CPQ/CTLK pueden traer ya la provisión → se duplicaría el gasto.
- Poner las rutas bajo `/nomina`: quien timbra fuera puede no tener el módulo.

**✅ Solución (commit `da30148`).**
- Backend `sat-descarga/nomina-emitida-xml.ts` (puro, con pruebas Jest) + `nomina-emitida-xml.service.ts`: lee los
  emitidos tipo N de la bóveda cuyo **FechaFinalPago** cae en el periodo (mismo criterio devengado que el #8), los
  agrupa en **corridas** (tipo de nómina + periodo + fecha de pago) y arma la MISMA póliza de provisión que la corrida
  del módulo, con las cuentas de Asignación de cuentas → Nómina (percepciones 601 / subsidio 110 / deducciones
  216-205-213 / neto 210). El concepto se reconoce por su **clave SAT** (el catálogo de NEXO está indexado así); 011 →
  FONACOT, 009 → INFONAVIT; lo que no tiene concepto propio cae al «cajón» (039 / 004), rotulado y avisado.
- Rutas `GET /sat-descarga/nomina-emitida/corridas` y `POST /sat-descarga/nomina-emitida/contabilizar` (ADMIN).
- `crearPoliza` acepta `cfdis` opcional: liga los UUID en `journal_entry_cfdi` en la MISMA transacción.
- Candados: excluye los UUID de `nomina_recibos`; «ya contabilizado» = `cfdiYaContabilizado` (3 vías); `origen_uuid`
  = `NOMXML:<md5 de los UUID>` (doble clic choca); dedupe por UUID; sólo emisor = RFC de la empresa; el neto del
  detalle debe ser el Total del CFDI; red «posible duplicado» (otra póliza en las fechas con el mismo neto abonado
  fuera de caja/bancos o el mismo total de percepciones) → sale del bloque, se fuerza una por una confirmando.
- Frontend `PolizasHub.tsx`: «Bajar pendientes» SIEMPRE activo (baja corridas del módulo y luego busca y baja la
  bóveda); tabla «Nómina emitida en la bóveda de XML» con faltantes, posible duplicado, conceptos sin concepto propio
  y vista previa de la póliza (ojo); avisos de recibos sin XML, que no cuadran o de otro RFC.

**Límite conocido.** La póliza lleva la **fecha de pago** (igual que la corrida del módulo): una nómina de julio
pagada en agosto se lista en julio pero su póliza queda en agosto. Todos los «otros pagos» van a la cuenta del
subsidio (como en el módulo). La red de duplicado empata importes exactos: un respaldo que agrupó la nómina por mes
no se detecta (revisar antes de bajar esos meses).

---

## 10. Subcuentas de cliente/proveedor nacían con el agrupador del MAYOR (105 / 201)

**Síntoma.** En la **balanza (Reportes NIF)** aparecían terceros creados por el motor de pólizas con el agrupador
del rubro: `11025001 LUIS AMADOR TORALES DURON` con **105** y `21005001 PEDRO MARTINEZ HERNANDEZ` con **201**,
en vez de `105.01` y `201.01`.

**Causa raíz.** En `resolverOCrearSubcuentaTercero` (catalogo-terceros.service) el INSERT de la subcuenta copiaba
`control.codigo_agrupador`. Y `cuentaControl` busca el control por el agrupador **específico Y por su padre**
(`IN ('105.01','105')`) justamente porque *el mayor del respaldo suele traer el agrupador padre* — así que el
tercero heredaba **105 / 201**. La regla del propio proyecto es la contraria y está declarada en el mapeador:
`{ /CLIENTES/, agrupador: '105', hijos: '105.01' }` y `{ /PROVEEDORES/, agrupador: '201', hijos: '201.01' }` —
el **mayor** lleva el rubro, los **hijos** el específico.

**Por qué importa (no es cosmético).** Media app filtra por el agrupador ESPECÍFICO, así que esos terceros quedaban
invisibles: `listarSubcuentasTercero` (pantalla de subcuentas), **`saldosPorCliente` → cuentas por cobrar desde la
contabilidad**, `capturarTercerosEnCatalogo`, el enlace `customers.cuenta_contable` y hasta `reorganizarTerceros`
(filtra `['105.01','105.02','201.01','201.02']`, o sea *la herramienta de reparación tampoco los veía*). Además
el `ya`-existe de la propia función busca por `codigo_agrupador = ANY(['105.01','105.02'])`, de modo que si el
control elegido cambiaba, el tercero no se encontraba y se **duplicaba**. En la balanza sí salían porque los
estados financieros suman por PREFIJO (`suma('105')`), por eso se veía ahí y en ningún otro lado.

**Cómo diagnosticar.** En la balanza, una subcuenta de tercero (con nombre de persona/empresa) cuyo agrupador sea
`105` o `201` pelón. En SQL: `tercero_rfc IS NOT NULL AND codigo_agrupador IN ('105','201')`.

**❌ Lo que NO hay que hacer.**
- «Promover» a 105.01/201.01 toda cuenta con agrupador 105/201: el **mayor** (1-10-25-000) debe conservar el de
  rubro. Por eso la corrección exige `tercero_rfc IS NOT NULL` — un control nunca lo tiene.
- Pisar un agrupador específico ya puesto (p. ej. `105.02` capturado a mano): puede ser deliberado.

**✅ Solución (commit `6cd7ead`).**
- `resolverOCrearSubcuentaTercero`: el INSERT usa el agrupador **específico** (`agrup`, que sale del tipo + RFC:
  `XEXX…` → extranjero), no el del control. Al **ligar** una cuenta del respaldo, sólo se le pone el específico si
  venía vacío o con el del rubro; uno específico ya puesto no se pisa.
- Nueva `normalizarAgrupadorTerceros(companyId)`: corrige las que ya nacieron mal
  (`tercero_rfc IS NOT NULL AND codigo_agrupador IN ('105','201')` → `.01`/`.02` según el RFC).
- Se engancha donde el usuario puede ejecutarla: en el botón **«Asignar agrupador»** del Catálogo de cuentas
  (`POST /accounting/cuentas/asignar-agrupador`), que corre justo después de la herencia del padre —que es la que
  deja el 105—; también al inicio de `reorganizarTerceros` y dentro de `generarSubcuentasDeComprobantes`.

**Límite conocido.** Sólo corrige terceros con `tercero_rfc`. Las hojas del respaldo sin RFC que quedaron con
`105`/`201` no se tocan (no se puede distinguirlas del mayor sin adivinar): ésas se ligan al pasar el motor, o se
capturan a mano. **«Reorganizar terceros» sigue OCULTO** en el Catálogo (`false &&`, decisión del 2026-11-11), así
que la vía real es «Asignar agrupador».

---

## 11. Alta de cuentas: el código no respetaba la MÁSCARA ni rellenaba huecos

**Síntoma.** Al dar de alta una subcuenta, la pantalla prellenaba el código con
**`<código del padre>` + punto** (`1-10-25-000.`), que no es un código válido de ninguna máscara. El usuario pidió
la regla explícita: *«no nada más pongas el número, acuérdate que tienen un formato… pero primero revisa si puedes
rellenar los huecos de la serie de clientes o proveedores»*.

**Causa raíz.** La regla de numeración sólo existía para TERCEROS (`codigoSiguienteTercero`, que sí usa máscara y sí
rellena huecos). El alta general (`crearCuenta` + `ModalNuevaCuenta`) no tenía ninguna: validaba que el código
colgara del padre y que no se duplicara, pero aceptaba cualquier formato y no proponía nada.

**La regla (mascara-cuenta.ts).** Un catálogo mexicano numera con una máscara de segmentos de ancho fijo
(`#-##-##-###` → `1-10-25-001`), y el PRIMER segmento es el RUBRO: 1 activo · 2 pasivo · 3 capital · 4 ingresos ·
5/6 costos y gastos. De ahí las dos reglas:
1. **Formato** — el hijo de `1-10-25-000` es `1-10-25-001`, nunca `1-10-25-000.1` ni `1-10-25-000-001` (un segmento
   de más). El hijo conserva los segmentos del padre y sólo numera el suyo, así que el rubro queda garantizado por
   construcción: un pasivo NO puede colgar de un activo.
2. **Huecos** — se ocupa el PRIMER número libre (001, 002, 003…), no el siguiente al mayor: un alta nueva rellena el
   hueco que dejó una cuenta dada de baja y la serie sólo crece cuando ya no hay huecos.

**❌ Lo que NO hay que hacer.** Imponer la máscara a un catálogo HEREDADO con numeración propia: se rompería el alta
de quien importó su catálogo. La regla sólo se aplica cuando el PADRE ya está en la máscara.

**✅ Solución (commit `97a667e`).**
- `mascara-cuenta.ts`: módulo PURO con la regla (`siguienteCodigoHijo` rellena huecos, `normalizarAMascara`,
  `conMascara`, `cuelgaDeEnMascara`, `rubroDe`) + 16 pruebas Jest.
- `crearCuenta`: con el padre en la máscara, **genera** el código si no se escribió ninguno y **normaliza** el que
  se escriba (da igual `11025001`, `1-10-25-001` o `1.10.25.001`), para que el catálogo no acabe con tres formatos
  del mismo número. Sin máscara utilizable se respeta lo capturado (comportamiento anterior).
- `GET /accounting/cuentas/siguiente-codigo?parentId=` + `sugerirCodigoHijo()`.
- `ModalNuevaCuenta`: propone el código correcto al abrir y explica de dónde salió; ya no prellena «padre + punto».
- Clientes/proveedores ya cumplían la regla (`codigoSiguienteTercero`): se verificó, no se tocó.

**Límite conocido.** Escribir sólo el último segmento (`001`) se interpreta como `0-01-00-000` y falla el candado de
«cuelga del padre» — es ambiguo a propósito; el formulario ya propone el código completo. Queda duplicado el helper
`anchosDeMascaraCat` en catalogo.service (ruta de importación), pendiente de unificar con el módulo nuevo.

---

## 12. Checador: «Permission denied» en la cámara y pestañas atoradas en «Cargando…»

**Síntoma.** (a) Enrolar rostro, Abrir kiosco y Campo mostraban un cuadro negro con **«Permission denied»** en inglés;
(b) las pestañas Configuración, Kioscos y Registro se quedaban en **«Cargando…»** para siempre; (c) el kiosco y el
modo campo ocupaban toda la pantalla **sin ningún control para volver**.

**Causa raíz.**
- (a) Las tres pantallas hacían `catch (e) { setError(e.message) }` y pintaban el mensaje CRUDO del navegador. Ese
  texto es para el programador: no dice la causa (son 5 distintas con salidas distintas) ni ofrece reintentar. La
  causa que más se esconde: `getUserMedia` sólo funciona en **contexto seguro** (https:// o localhost); abierta por
  http:// o por IP de la red local el navegador **ni siquiera pregunta**, y el error igual sale como «permiso
  denegado», que es mentira.
- (b) `if (!f) return <p>Cargando…</p>` sin rama de error: si la petición fallaba, el estado nunca se llenaba.
- (c) Sólo había un engrane gris de 20 px arriba a la derecha, sin etiqueta: nadie lo encontraba.

**❌ Lo que NO hay que hacer.** Mostrar `e.message` de una API del navegador a quien está parado frente a la tableta;
y dejar una pantalla completa sin salida (heurística #3 de Nielsen: control y libertad del usuario).

**✅ Solución (commit `233f7b3`).**
- `components/CamaraAviso.tsx`: `revisarEntornoCamara()` comprueba contexto seguro y disponibilidad de la API ANTES
  de pedir la cámara; `diagnosticarCamara(e)` mapea `NotAllowedError` / `NotFoundError` / `OverconstrainedError` /
  `NotReadableError` a causa + pasos concretos en español; `<CamaraAviso>` los pinta con `role="alert"`, botón
  Reintentar de 44 px y un `<details>` con el detalle técnico para soporte. Tonos claro y oscuro, ambos AA.
- `components/BotonSalirPantalla.tsx`: salida fija arriba-izquierda, 44×44 px, foco visible. En el KIOSCO va con
  confirmación (equipo compartido: no debe salirse del modo registro por un roce); en campo, directa.
- Las tres pantallas de cámara reintentan de verdad (el efecto depende de `intento`, ya no hay que recargar).
- `TabConfig`: rama `q.isError` con la causa y botón Reintentar.
- Barra del Checador: pestañas y accesos de cámara **separados en dos grupos** (unas cambian el contenido, los otros
  abren pantalla completa), con `role="tablist"`/`aria-selected`, foco visible y microinteracción. Mismo esquema de
  color (`claseOpcion`), como pide [[opciones-menu-colores]].

**Límite conocido.** No se pudo verificar en ejecución: las pantallas están detrás del login y no se usan las
credenciales del usuario. Compila y empaqueta; **falta probar en la tableta real**. Si el «Permission denied» venía
de http://, el aviso ahora lo dirá — pero la solución de fondo es servir el checador por https.

---

## 13. Checador: el consentimiento biométrico se otorgaba con una PALOMITA (sin prueba de la firma)

**Síntoma.** Para liberar el enrolamiento facial bastaba marcar una casilla («El trabajador firmó el
consentimiento»). Nada obligaba a imprimir el convenio, ni a que el trabajador lo firmara, ni quedaba constancia de
nada. Además el engrane de «Administración» de las pantallas de cámara iba al MISMO lugar que el botón Salir —dos
controles para lo mismo, y uno de ellos prometiendo configuración que no daba—.

**Causa raíz.** El rostro es un dato personal **SENSIBLE** (art. 3 fr. VI LFPDPPP) y la ley pide consentimiento
**expreso y por escrito**. Una palomita en pantalla no prueba nada el día de una queja ante el INAI: no identifica
quién la marcó, ni que el trabajador haya leído o firmado algo. El orden real es físico (imprimir → firmar en papel
→ archivar la prueba) y el sistema no lo imponía.

**Cómo diagnosticar.** `SELECT aceptado, documento IS NOT NULL FROM checador_consentimiento` — si hay `aceptado =
true` con `documento` nulo, ese enrolamiento no tiene prueba de la firma detrás.

**❌ Lo que NO hay que hacer.** Dejar que una casilla de la UI sea la única evidencia de un consentimiento de dato
sensible. Y confiar en «¿se imprimió?» como prueba: que el navegador abra el diálogo de impresión no significa que
alguien haya firmado.

**✅ Solución (commit `__HASH__`).** El candado del enrolamiento pasa a ser la **evidencia**:
1. **Imprimir** el convenio (el texto ya existía en `ConsentimientoBiometrico.tsx`) → `impreso_at`.
2. **Firma autógrafa** en papel, por duplicado — fuera del sistema.
3. **Foto del convenio firmado** → `checador_consentimiento.documento` (data-URL, mismo patrón que la foto del
   trabajador y la de entregas de equipo). **Esa foto, y sólo esa, libera el rostro.**
- `enrolarRostros` rechaza si no hay foto («Falta la FOTO del convenio FIRMADO…») y si el consentimiento fue
  revocado, con mensajes que dicen qué hacer.
- `setConsentimiento` se volvió una actualización **por partes** (`impreso` / `documento` / `aceptado` / `notas`):
  antes era un upsert que pisaba `metodo` y `notas` en cada llamada, así que marcar «impreso» borraba lo demás —y
  un PUT sin `aceptado` lo ponía en `false` (`!!undefined`)—. Otorgar sin foto se rechaza; **revocar siempre se
  puede** (es derecho del trabajador) y al revocar se bloquea el enrolamiento, conservando el convenio como
  constancia de lo que se firmó.
- `pages/nomina/ConsentimientoFirmado.tsx`: los 3 pasos numerados con su palomita, en la pantalla de Enrolar y en
  Checador → Empleados. Dos formas de tomar la foto: con la cámara ya abierta (laptop, sosteniendo la hoja) y con
  `capture="environment"`, que en celular/tableta abre la cámara **trasera** —la buena para un papel—. La imagen se
  reduce a 1600 px y ~1.4 MB en el navegador; el backend rechaza arriba de ~2 MB.
- El botón de captura apagado ahora **dice por qué** lo está (heurística #1 de Nielsen).
- `components/AvisoCarga.tsx`: un solo componente para «no se pudo cargar X» + Reintentar, usado en Configuración,
  Kioscos y Registro (del día e historial). Las tablas enseñaban «Aún no hay kioscos» / «Sin registros» cuando lo
  que pasaba era que el servidor no contestaba: **afirmar que no hay datos cuando no se sabe**. El error va antes
  del vacío.
- Las 3 opciones de cámara pasan a **verde fuerte relleno** (`claseOpcionCamara`, green-700) para distinguirlas de
  las pestañas de configuración; con eso el rótulo «Abrir cámara:» salió sobrando. Se quitó el engrane redundante
  de Kiosco, Campo, Enrolar y Registro (todos iban al mismo `/checador` que Salir/Regresar).
- Contrastes medidos, no supuestos: green-600 con texto blanco de 14 px da **3.3:1** y NO pasa AA; green-700 da
  5.0:1. Igual emerald-600 (3.8:1) → emerald-700 (5.5:1) en los botones, y emerald-500 → emerald-600 en la
  palomita de cada paso (3:1 para objetos gráficos).

**Límite conocido.** Sin verificar en ejecución (login) y el frontend no tiene corredor de pruebas: sólo `tsc` de
backend y frontend + build de producción. **Falta probarlo en la tableta real.** Consecuencia a tener presente: a
quien ya tenía `aceptado = true` por la palomita vieja **no se le podrá re-enrolar** hasta subir la foto de su
convenio firmado; los rostros YA enrolados siguen checando normal (la identificación no se tocó). El despliegue va
**primero backend y luego frontend**: con el backend viejo, un PUT sin `aceptado` apagaría el consentimiento.

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
