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

**✅ Solución (commit `fa3c821`).** El candado del enrolamiento pasa a ser la **evidencia**:
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
- **Configuración salió de la fila de pastillas** (commit `a39dea2`): no es trabajo del día a día —se ajusta una
  vez y se olvida—, así que no debe competir con las pestañas que sí se usan a diario. Va como **engrane sin
  apariencia de botón** (ni relleno ni borde; el fondo sólo asoma al pasar el cursor) a la **derecha** de la barra,
  que es donde se busca un engrane. Sigue siendo `role="tab"`, así que su estado activo se ve con azul **+
  subrayado + fondo tenue**: color solo no basta (WCAG 1.4.1).
- Contrastes medidos, no supuestos: green-600 con texto blanco de 14 px da **3.3:1** y NO pasa AA; green-700 da
  5.0:1. Igual emerald-600 (3.8:1) → emerald-700 (5.5:1) en los botones, y emerald-500 → emerald-600 en la
  palomita de cada paso (3:1 para objetos gráficos).

**Límite conocido.** Sin verificar en ejecución (login) y el frontend no tiene corredor de pruebas: sólo `tsc` de
backend y frontend + build de producción. **Falta probarlo en la tableta real.** Consecuencia a tener presente: a
quien ya tenía `aceptado = true` por la palomita vieja **no se le podrá re-enrolar** hasta subir la foto de su
convenio firmado; los rostros YA enrolados siguen checando normal (la identificación no se tocó). El despliegue va
**primero backend y luego frontend**: con el backend viejo, un PUT sin `aceptado` apagaría el consentimiento.

---

## 14. Estado de cuenta de Stripe: cifras invisibles y comisión sin IVA desglosado

**Síntoma.** Al cargar el estado de cuenta de Stripe (cobrador de pagos) no salía ningún movimiento y el
documento parecía ilegible, aunque abierto en un visor se ve perfecto. Y la **comisión** —que Stripe cobra
con IVA incluido y descuenta del depósito— no aparecía en ninguna parte: se quedaba dentro del neto, así
que ni el gasto ni el IVA acreditable existían para la contabilidad.

**Cómo diagnosticar.** Volcar el texto del PDF e imprimir los **códigos de carácter**, no el texto:
`[...linea].map(c => c.charCodeAt(0))`. Si salen valores de **57344 a 63743** (U+E000–U+F8FF), el PDF
escribe con una fuente cuyo subconjunto de glifos no trae mapa a Unicode.

**Causa raíz.** DOS cosas distintas:
- El PDF de Stripe escribe la tabla con una fuente **sin `ToUnicode`**: cada cifra llega como un carácter
  del **área de uso privado**. La fecha «2026-10-01» llegaba como `2026·10·01` con los guiones en U+E088
  (506 glifos en el estado de octubre), y las cifras de los importes llegaban enteras en esa área — por eso
  sólo se veían los «$» sueltos. El renglón no empataba con ningún patrón y **el detalle se perdía en
  silencio**: nada avisaba. Los **saldos y los totales** sí se leen, porque van en la fuente normal.
- Stripe no es un banco y no se había modelado: no tenía lector propio, así que caía en el genérico.

**❌ Lo que NO hay que hacer.** Deducir qué dígito es cada glifo de uso privado: el orden del subconjunto
depende de cómo se generó el PDF, y **una cifra adivinada en contabilidad es peor que una cifra ausente**.
Tampoco meter movimientos en cero para «no dejarlo vacío»: eso ensucia la cuenta y descuadra el arrastre.

**✅ Solución (commit `679ea08`).**
- `limpiarPua()` quita los caracteres U+E000–U+F8FF y los **cuenta**. Con eso la fecha vuelve a ser legible
  («20261001») y el concepto y el tipo también; las cifras no se recuperan y **se avisa cuántos renglones
  se perdieron y qué hacer** (pegar el texto, o subir el CSV de «balance transactions» del portal).
- `extraerStripe()`, lector propio, con la regla que dio el usuario: lo que hay que **controlar** son el
  **saldo inicial y el final** y la **comisión con su IVA**; la cobranza se cuadra por el lado del CFDI en
  la conciliación bancaria. Los payouts vienen en **negativo** (salen a otro banco) y los cobros en
  positivo; cuando el signo está manda el signo, cuando no manda el TIPO.
- Un **cobro entra al saldo por su NETO**, no por el bruto: la comisión nunca llegó a la cuenta. Así cuadra
  el arrastre *y* la comisión queda como gasto aparte.
- **IVA de la comisión**: base = `total / 1.16`, IVA = la diferencia. Se guarda por mes en
  `bancos_estados_cuenta.comision_{total,base,iva}` (migración `2026-11-23b`) y se muestra al cargar. El
  desglose es **papel de trabajo**: para acreditar el IVA hace falta el CFDI que emite el cobrador.
- **Dos cuadres**: con movimientos legibles se valida el arrastre; sin ellos, la identidad del resumen
  (`inicial + actividad neta − pagos a banco = final`), que es justo lo que se pidió controlar.
- La detección exige **dos marcas** («Estado de Cuenta Stripe», o «Stripe» + comisiones/payout): la palabra
  «Stripe» sola aparece como contraparte de un SPEI en cualquier estado bancario.

**Probado.** 17 pruebas (`extractor-stripe.test.ts`), incluidas las de los glifos de uso privado, y una
corrida de punta a punta contra el PDF real de octubre 2026: detecta Stripe, saca 62,241.30 → 15,215.86,
desglosa 2,913.15 = 2,511.34 + 401.81 y cuadra.

**Límite conocido.** Del PDF con la fuente rota **no se recupera el detalle**: quedan saldos y comisión (y
los 27 renglones contados en el aviso). Para el movimiento por movimiento hace falta el CSV de Stripe, el
texto pegado, o encender `ENABLE_OCR` en el servidor.

---

## 15. Documentos que se abrían en una pestaña y no quedaban en «Descargas»

**Síntoma.** Varios documentos que genera NEXO se veían pero no se guardaban: la opinión de cumplimiento,
el documento legal de la baja, los acuses y declaraciones del SAT, la remesa y el complemento de pago se
abrían en una pestaña y, al cerrarla, había que volver a generarlos para archivarlos. Otros «descargaban»
pero el archivo a veces no aparecía.

**Causa raíz.** Dos patrones:
- `window.open(URL.createObjectURL(blob))`: eso **muestra** el documento, no lo guarda. Y si el navegador
  bloquea las ventanas emergentes, el botón parece no hacer nada.
- Descargas hechas a mano: `a.click()` **sin meter el enlace al documento** y con
  `URL.revokeObjectURL()` inmediatamente después. Firefox exige que el `<a>` esté en el DOM —si no, no
  descarga nada— y liberar el blob en el mismo instante puede abortar el archivo a medias. Ya existía
  `api.downloadFile`, que hace las dos cosas bien, pero diez sitios no lo usaban.

**✅ Solución (commit `679ea08`).** `api.verYDescargar(blob, nombre, ver)`: **siempre descarga** y además
abre la pestaña cuando la acción es «ver», así el archivo existe aunque la ventana se bloquee. Se barrieron
los sitios que abrían documentos (opinión, documento de baja, acuse IDSE, remesa, complemento de pago,
declaraciones y notificaciones del SAT) y los que descargaban a mano (notas de crédito PDF/XML, XML del
complemento, DIOT, nómina PF, diferencia cambiaria, asistencia, manifiesto, documentos legales, ZIP de
declaraciones, registro de asistencia) para que todos pasen por `downloadFile`.

**Lo que NO se tocó.** Las ventanas de **impresión** (ticket del POS, remesa en hoja, pólizas, convenio
biométrico): ahí abrir una ventana es el objetivo, no hay archivo que guardar.

**Límite conocido.** La **carpeta** la decide el navegador: ningún sitio web puede elegirla. Es «Descargas»
salvo que el usuario la haya cambiado o tenga activado «Preguntar dónde guardar cada archivo» — eso se
configura en cada equipo, no desde NEXO.

---

## 16. Cada pantalla tenía su propio estilo de pestañas

**Síntoma.** Las opciones (pestañas) se veían distintas según la pantalla: unas como pastillas verde
claro con la activa en azul —el esquema acordado—, otras subrayadas en azul, otras como bandeja gris con
la activa en blanco, otras en pastillas azul marino o violeta. El ERP se sentía como varios programas
pegados, y en algunas la opción activa casi no se distinguía.

**Causa raíz.** El helper `claseOpcion` (`utils/coloresOpciones.ts`) existía y lo usaban 28 pantallas,
pero siete se habían escrito antes o a mano. Una incluso repetía las clases literales del helper —mismo
color, escrito aparte—, que es la forma segura de desincronizarse el día que el esquema cambie.

**✅ Solución (commit `3c1b4a9`).** Barrido: todas las barras de opciones pasan por `claseOpcion` —
`Reports`, `Inventory` (bandeja gris), `AdminEmisores` (pastillas azul cielo), `ReportesFiscales` y
`ReportesEspeciales` (bandeja gris/violeta), `CuentasDuplicadas` (pastillas `primary`) y
`CodificacionRfc` (clases literales)—. Todas ganan además `role="tablist"`/`aria-selected`, anillo de
foco visible y la microinteracción del resto. **Configuración** ya sólo existe como opción en el
Checador y ahí quedó como engrane sin apariencia de botón (entrada 13).

**Lo que NO se tocó, a propósito.** Los **conmutadores y filtros** no son opciones de menú y no deben
verse como tales: Mensual/Anual del balance y del estado de resultados, «Ver: factura por factura / por
producto», las pastillas de filtro con contador de pólizas y codificación, Acumulado/Por periodo de
nómina y el orden del reporte de rotación. Pintarlos de verde los haría leer como navegación.

**Límite conocido.** Sin verificar en ejecución (login): `tsc` y build de producción. Si alguna pantalla
nueva vuelve a escribir su propia barra, el barrido se deshace — la regla es usar `claseOpcion` siempre.

---

## 17. Stripe: el acomodo del detalle (positivos por día, negativos uno por uno)

**Síntoma.** El lector de Stripe suponía tres columnas de dinero por renglón (importe · comisión · neto) y
metía el **neto** como depósito. El estado real trae **dos**: `amount` (con signo) y `fee`.

**Causa raíz.** Se dedujo el formato del encabezado del PDF en vez de preguntarlo. Con el formato real, el
depósito salía mal y el detalle no se podía cuadrar contra lo facturado.

**✅ Solución (commit `fca6747`), la regla que fijó el usuario.**
- **DEPÓSITOS**: los importes **positivos se SUMAN por DÍA** — un solo depósito por fecha, que es como
  entra la cobranza del día — y por su **importe**, no por el neto.
- **RETIROS**: los importes **negativos van UNO POR UNO** con su fecha (cada payout, cada cargo).
- **COMISIÓN**: la columna `fee` no es un importe aparte, se **retiene** del cobro. Sale del saldo como
  **un renglón por día** («Comisión Stripe retenida») y se totaliza con su IVA. No es un movimiento
  inventado: la cifra está en el documento, en su columna — y sin ese renglón el arrastre **no llegaría**
  al saldo final, porque es dinero que salió aunque el estado no lo imprima como movimiento.
- Se acepta también la fecha con **guiones** (`2026-10-03`), que es como la trae el CSV del portal; antes
  sólo se reconocía la pegada del PDF (`20261003`).
- **Regresión encontrada y tapada en el camino:** al aceptar fechas sueltas, el renglón del **resumen**
  («Resumen: Saldo inicial $62,241.30 **30 sep**) …») entraba como un movimiento de 62,241.30 y
  descuadraba todo. Dos candados: la fecha se busca sólo en la **cabeza** del renglón (un movimiento
  empieza por su fecha) y los renglones de totales se descartan por rótulo (`RX_RESUMEN_STRIPE`).

**Probado.** 19 pruebas en `extractor-stripe.test.ts` (dos cobros del mismo día que se suman en un
depósito, la comisión del día en su renglón, los negativos por separado, el arrastre al saldo final, la
fecha con guiones) y la corrida contra el PDF real, que sigue dando 62,241.30 → 15,215.86 y cuadra.

---

## 18. Las notificaciones del SAT llegaban sin contenido (se pedían como si fueran comunicados)

**Síntoma.** Al abrir un aviso del buzón («RESOLUCIÓN DE LA SOLICITUD DE DEVOLUCIÓN») sólo salían el
título, la fecha y «SERVICIO DE ADMINISTRACIÓN TRIBUTARIA». Ni el documento, ni el acuse, ni los datos del
trámite.

**Causa raíz.** Dos cosas:
- La pantalla llamaba **siempre** a `getComunicadoContenido`, también para los avisos. Un aviso **no está**
  en `comunicadosfiel`: la consulta devolvía el primer comunicado de la lista o nada, así que el modal se
  quedaba con el encabezado que ya traía del listado. **No había** función de contenido para notificaciones.
- El listado se pedía con `descargarNotificaciones:false` (correcto: bajar seis meses de PDF tardaría una
  eternidad) y `mapNotif` se quedaba con **cuatro campos** — acto, autoridad, folio, fecha — y tiraba el
  resto: medio y fecha de notificación, estatus, vencimiento, número de documento. Justo lo que hace falta
  para atender una notificación a tiempo.

**✅ Solución (commit `fca6747`).**
- `notificacionContenido(companyId, id)`: vuelve a preguntar con `descargarNotificaciones:true` a las **dos**
  bolsas (pendientes y notificadas, porque el id puede estar en cualquiera) y entrega **documento
  notificado**, **acuse** y **constancia** como archivos con su etiqueta — probando los varios nombres que
  usa el proveedor en vez de apostar a uno — más todos los campos del trámite.
- `datosPlanos()` conserva **todo** lo que mandó el SAT (menos los binarios) en `datos`, tanto en el listado
  como en el detalle. La pantalla los enseña como lista de rótulo→valor, con nombres legibles, sin tener que
  adivinar cómo se llama cada campo en el proveedor.
- El modal elige el endpoint por el **tipo** del renglón (`aviso` o `comunicado`), que ahora viaja desde el
  backend, y los documentos se abren con `abrirDoc` → quedan en **Descargas** (entrada 15).

**Límite conocido.** Sin probar contra el buzón real: hace falta e.firma vigente y plan de SatGo. Si el
proveedor nombra el documento de otra forma, el aviso saldrá **con todos sus datos pero sin PDF** — la
pantalla lo dice en esas palabras en vez de verse vacía, y agregar el alias es una línea.

---

## 19. La póliza de depreciación se generaba pero no se veía

**Síntoma.** Pólizas → Depreciaciones decía «Depreciación generada.» y nada más. Para ver **qué** se asentó
había que irse al Libro diario y buscarla.

**Causa raíz.** La pestaña sólo disparaba el generador; nunca listó nada. El control mensual se lleva ahí,
así que ahí faltaba la póliza.

**✅ Solución (commit `fca6747`).** La pestaña lista ahora **la póliza del mes** (folio, fecha, concepto,
estado e importe) y, al hacer clic en el renglón, **sus partidas** (cuenta, nombre, concepto, cargo, abono).
Se refresca sola al generar. Sin backend nuevo: reusa `GET /accounting/polizas?anio&mes` filtrando
`origen='DEPRECIACION'`. Cuando no hay, lo dice con su razón («si el mes no tiene activos depreciables, no
se genera ninguna») en vez de quedarse en blanco.

---

## 20. El bloque de depósito salía en todos los correos (y no había dónde escribir nada más)

**Síntoma.** Todo correo de cobro —y la prueba de SMTP— llevaba pegado el bloque «Datos para tu pago
(transferencia o depósito)» con el banco, la CLABE y la nota. A un cliente nuevo le sirve; a uno de años se
lo repetía cada mes. Y no había forma de añadir un párrafo propio: el cuerpo del correo era el texto fijo
del sistema y lo que se escribiera en ese envío, nada más.

**Causa raíz.** El bloque era incondicional: `sendInvoiceMail` lo armaba siempre que el caller mandara
`reference`, y `sendTestMail` lo enseñaba siempre. No existía ninguna bandera que dijera «este cliente ya
sabe dónde depositar», ni campo para un texto de la casa.

**✅ Solución (commit `80ebed6`).** Dos columnas en `companies` y dos controles donde se administran:
- `mail_incluir_deposito` — nace **APAGADA**, así que el bloque deja de salir. Se enciende por empresa
  (Datos de mi empresa → Texto de los correos, y Súper Admin → Emisor de facturas) y también **por envío**,
  en el modal de «Enviar por correo» de la factura: es dato para un cliente nuevo, no para repetírselo.
- `mail_texto_adicional` — el párrafo de la casa. La factura y el recibo de nómina conservan su cuerpo por
  omisión; esto se antepone a la firma y se escribe una sola vez. En cada envío se puede cambiar sin tocar
  la configuración.

La prueba de SMTP pasó a ser un **espejo** de lo que sale de verdad: enseña el párrafo y el bloque sólo si
están encendidos, y cuando no, lo dice con todas sus letras en vez de mostrar algo que el cliente no va a
recibir.

**Consecuencia que hay que saber.** El correo automático del cargo mensual (`issue-invoice`,
`cobro-prepago`) ya **no** lleva los datos bancarios hasta que se enciendan en la emisora.

---

## 21. El recibo de nómina se marcaba para correo y el correo nunca salía

**Síntoma.** En Nómina → CFDI se marcaba «enviar por correo» a los trabajadores y la columna «enviado»
jamás se prendía.

**Cómo diagnosticar.** `grep -rn "enviado_at" backend/src` — `nomina_recibos.enviado_at` se **leía** en tres
lados (listados, Excel, PDF) y **no lo escribía nadie**. No había ninguna ruta de envío.

**Causa raíz.** Sólo existía la mitad del flujo: `marcarEnvioPorCorreo` guardaba la decisión. El envío
«ocurre después», decía el comentario, pero ese después nunca se escribió.

**✅ Solución (commit `80ebed6`).** `envio-recibos.service` manda el recibo **TIMBRADO** con su PDF y su
XML, un correo por trabajador:
- Sólo lo timbrado. Un pre-timbre no ampara ningún pago y mandarlo invita al trabajador a guardarlo como si
  sí lo amparara.
- Un fallo **no detiene a los demás**: cada trabajador es un correo aparte y que el buzón de uno rebote no
  es razón para dejar sin recibo al resto. Lo que falló queda escrito en `enviado_error` y se ve en su
  renglón; sin eso el siguiente intento repite el error a ciegas.
- A quien ya se le mandó se **omite**, salvo que se pida reenviar.
- El **correo del trabajador** se resuelve `recibo.correo` → `empleado.email` (el recibo guarda una foto del
  correo al cierre; si el expediente se completó después, esa foto está vacía) y se puede **capturar en la
  misma pantalla**, que es donde se descubre que falta. Se escribe en los dos lados para no volver a
  capturarlo el mes que entra.
- El resultado se enseña renglón por renglón: «3 enviados» no dice a quién hay que capturarle el correo.

---

## 22. El check «ya cobré» se perdía al recargar, y no había cómo cobrar ni timbrar el complemento

**Síntoma.** En Súper Admin → Facturación, el check que habilita «Generar factura» se borraba al recargar la
pantalla. «Marcar pagado» era una palomita que no decía cuánto entró ni cuándo. Y no había ninguna forma de
emitir el complemento de pago.

**Causa raíz.** Tres cosas encadenadas:
- El check vivía en un `useState` del navegador: ni sobrevivía a un refresco ni distinguía un mes de otro.
- `marcarPagado` sólo ponía `status='PAGADO'`. Sin importe, fecha ni forma de pago no se puede emitir un
  CFDI tipo P — y esas facturas se emiten **PPD**, porque al facturar el cliente todavía no ha pagado. El
  SAT exige el complemento para toda PPD: sin él la operación sigue abierta aunque la lista diga «pagado».
- El cargo guardaba `factura_id` pero no el **consecutivo**: la lista decía «Facturado» y para saber cuál
  factura era había que irse a otra pantalla.

**✅ Solución (commit `80ebed6`).** Todo cuelga del cargo del periodo (`facturacion_mensual`):
- `listo_para_facturar` por (empresa, periodo). Se conserva dentro del mes y queda **limpio solo al cambiar
  de mes**, porque el mes nuevo es otro renglón: no hay nada que vaciar a mano ni un día en que alguien
  tenga que acordarse.
- `factura_folio`, `factura_uuid` y `emisora_id` al emitir. La lista enseña el consecutivo, el importe real
  del CFDI (con IVA y con los conceptos que se editaron), lo cobrado y el complemento.
- `cobrado_mxn`, `pago_fecha`, `pago_forma`, `pago_nota` — la pantalla de cobro captura importe, fecha y
  forma del Anexo 20; por omisión el total del CFDI con IVA, que es lo que el cliente deposita.
- `emitirComplementoPago()` timbra el CFDI tipo P **desde la misma emisora que timbró la factura** (se lee
  de la factura, no se vuelve a elegir: elegir otra produce un comprobante que el SAT rechaza), reusando
  `payments.service`. Se puede hacer en el mismo acto del cobro o después, desde el renglón.
- Arriba, el **acumulado del mes**: facturado, cobrado, por cobrar y cuántos cobros siguen **sin
  complemento** — que es la deuda con el SAT que antes no se veía.

**Límite conocido.** Sin probar contra el PAC real: el flujo de timbrado es el mismo de `payments.service`,
que ya se usa en producción, pero este camino concreto (súper admin → complemento del cargo) sólo se ha
ejercitado con `tsc` y las 191 pruebas.

---

## 23. «501 &lt;f&gt;: sender address must contain a domain» — el remitente guardado era una sola letra

**Síntoma.** Al mandar la factura F-000062 por correo, el servidor contestó
`Mail command failed: 501 <f>: sender address must contain a domain`. El remitente que salía era **`f`**: una
letra, sin arroba ni dominio.

**Cómo diagnosticar.** `grep -n "mail_from" frontend/src/components/IssuerModal.tsx`. El campo «Usuario /
correo» llevaba este `onChange`:

```tsx
onChange={e => setForm({ ...form, mail_user: e.target.value, mail_from: form.mail_from || e.target.value })}
```

**Causa raíz.** Esa línea copia el usuario al remitente **sólo mientras el remitente esté vacío**. Al teclear
la **primera letra** de `facturas@hcgm.com.mx`, `form.mail_from` todavía era `''` (falso) → `mail_from = 'f'`.
A partir del **segundo** carácter `form.mail_from` ya valía `'f'` (verdadero) y **dejaba de copiar**. El
remitente quedaba congelado en la primera letra tecleada, y así se guardó en la base.

Dos cosas lo volvieron invisible hasta que rebotó delante del cliente:
- `SMTPConfig` **nunca leía** la configuración guardada: el formulario arrancaba en blanco aunque la empresa
  ya tuviera su buzón, así que nadie podía ver que ahí decía `f`.
- No había validación: ni al guardar (se aceptó `f`) ni al enviar (se armaba el From y se mandaba al
  servidor). El único que se quejó fue el SMTP, semanas después y con un mensaje sobre `<f>`.

**✅ Solución (commit `1294246`), en las cuatro capas donde pudo detenerse.**
- **El formulario** copia el usuario al remitente mientras nadie escriba el remitente a mano (bandera
  `fromPropio`), ya **carga lo guardado** (host, puerto, SSL, usuario y remitente — la contraseña no: vive
  cifrada y no tiene por qué bajar al navegador) y enseña en vivo **desde qué dirección van a salir** los
  correos, en rojo si no es una dirección completa.
- **Al guardar**, backend y frontend rechazan un remitente sin dominio, nombrando el campo que hay que
  corregir. `PATCH /companies/:id/smtp` y `PUT /admin/emisores/:id/smtp`.
- **Al enviar**, `direccionDe()` filtra lo que no sea una dirección usable y cae al siguiente candidato
  (`mail_from` → `mail_user` → `contact_email` → `MAIL_FROM`). Acepta `Nombre <dir@dom>` y extrae la
  dirección: meterla entera produciría `"Empresa" <Nombre <dir@dom>>`, que tampoco es válido. **Con esto, el
  buzón roto vuelve a funcionar sin que nadie lo re-guarde**, porque el usuario autenticado sí es una
  dirección.
- **La prueba de SMTP** dice ahora **desde qué buzón salió** («enviado a X desde facturas@hcgm.com.mx»), que
  es la pregunta real de quien prueba: ¿está tomando mi configuración o la del despacho? Y
  `explicarErrorSmtp` traduce el 501 a «captura el remitente completo» en vez de repetir el `<f>`.

**Lección.** Un `a || b` dentro de un `onChange` que se dispara **por cada tecla** no es «usa b si a está
vacío»: es «usa b sólo en el primer carácter». Para espejear un campo hace falta una bandera de «el usuario
ya lo tocó», no la vacuidad del destino.

---

## 24. Un clic podía mandar años de recibos de nómina de golpe

**Síntoma.** (Encontrado al revisar el envío recién hecho, antes de que pasara.) Nómina → CFDI lista **todos**
los recibos de la empresa, de **todos los periodos**. «Marcar todos» + «Enviar» le habría mandado a cada
trabajador su historia completa.

**Causa raíz.** La pantalla sólo filtraba por estatus (sin timbrar / timbrados / todos). Mientras únicamente
se *marcaba*, el alcance no importaba; con el envío real, sí.

**✅ Solución (commit `1294246`).** Un **selector de periodo** (derivado de los recibos cargados, con
`periodo_id` agregado al listado) que arranca en el **más reciente** —el que se acaba de cerrar y el que se
va a mandar—. Marcar, desmarcar y enviar operan sobre lo que está en pantalla, y la confirmación **nombra el
periodo**; «Todos los periodos» existe, pero hay que elegirlo y el aviso lo dice con todas sus letras.

---

## 25. El service worker nunca se instaló en hcgm.com.mx/erp (registro desde la raíz)

**Síntoma.** Al abrir https://hcgm.com.mx/erp/ la consola traía
`A bad HTTP response code (404) was received when fetching the script`. La página cargaba bien y todos los
assets respondían 200, así que no parecía nada.

**Cómo diagnosticar.** El 404 no salía en la lista de peticiones —el registro de un service worker no es una
petición de la página— así que se buscó el registro en el HTML servido:

```
curl -s https://hcgm.com.mx/erp/ | sed -n '/<script>/,/<\/script>/p' | grep -i register
    navigator.serviceWorker.register('/sw.js').catch(function () {});
```

Y la comprobación directa:

```
/sw.js      → 404
/erp/sw.js  → 200
```

**Causa raíz.** `frontend/index.html` registraba el worker con una **ruta absoluta al dominio**: `/sw.js`. En
desarrollo funciona, porque la app vive en `/`. El build del hosting la publica bajo **`/erp/`**, donde el
archivo está en `/erp/sw.js`. El registro pedía un archivo que no existe.

Y el `.catch(function () {})` **se tragaba el error sin decir nada**: por eso siguió roto sin que nadie lo
notara. La única huella era ese mensaje de consola, que no dice qué script.

**Consecuencia.** En el sitio publicado el service worker **nunca llegó a instalarse**, y con él se perdió
justo lo que existe para evitar: *servir bundles viejos después de un despliegue*. Es el mismo síntoma —«no
veo los cambios»— que ya había costado días y que motivó poner el commit en `/health`.

**✅ Solución (commit `d2f647c`).** El registro se mudó a `main.tsx`, que es el único lugar donde se conoce
la base real de la app: `` `${import.meta.env.BASE_URL}sw.js` `` → `/sw.js` en desarrollo y `/erp/sw.js` en el
hosting. Una ruta **relativa** no habría servido: desde una ruta profunda de la SPA (`/erp/facturas`)
resolvería contra ella. El `catch` ahora deja un `console.warn` con la URL: callar el error es lo que lo
mantuvo roto.

Comprobado en el bundle construido: `const t="/erp/sw.js"`.

**Nota de diagnóstico para el futuro.** En este hosting, un `200` **no prueba que el archivo exista**: el
`.htaccess` de la SPA devuelve `index.html` para cualquier ruta desconocida. `/erp/service-worker.js` también
contestaba 200 — con `Content-Type: text/html`. Para saber si un archivo está de verdad, hay que mirar el
**Content-Type** o las primeras líneas, no el código de estado.

---

## 26. El storefront público entero contestaba «No token provided»

**Síntoma.** Abrir la imagen de un producto de la tienda —la URL que va dentro de un `<img src>`—
devolvía JSON en vez de la foto:

```
GET /api/v1/storefront/img/18dd44a2-…  →  {"success":false,"message":"No token provided"}
```

No era sólo la imagen: **toda** la tienda del comprador estaba muerta.

```
/api/v1/storefront/img/<uuid>   → 401
/api/v1/storefront/<slug>       → 401
/api/v1/no-existe-xyz-123       → 401   ← una ruta inventada
/api/v1/public/companies/x/logo → 500   ← ésta SÍ llegaba a su handler
```

**Cómo diagnosticar.** El router del storefront estaba bien: se monta **sin** `authenticateToken` y su
primera línea de comentario dice «API PÚBLICA … SIN login». El `<img>` tampoco tenía culpa: un navegador
no manda `Authorization` al pedir una imagen. La pista fue la **ruta inventada**: si algo que no existe
contesta 401 en vez de 404, el 401 no sale de ninguna ruta — sale de **antes**.

La comparación lo cerró: `/public/companies/x/logo` (montado en la línea 198) llegaba a su handler,
`/storefront/*` (línea 263) no. Lo que cambia entre una y otra es lo que hay **en medio**.

**Causa raíz.** En Express, un router montado en la **raíz** de la API recibe *todo* lo que entra a
`/api/v1`, no sólo sus propias rutas. Dos lo están —`mailerRoutes` (línea 214) y `cartaPorteRoutes`
(línea 242)— porque sus rutas cuelgan de `/invoices/:id/…` y no deben chocar con el módulo de invoices.
Y los dos abrían con:

```ts
const router = Router();
router.use(authenticateToken);   // ← corre para TODA la API, no sólo para este router
```

Así que cada petición a la API pasaba por ese `authenticateToken` **antes** de que la cadena llegara a
los routers montados después. Sin `Bearer`, 401 y se acabó: el storefront nunca fue llamado.

Lo más caro es que **ya estaba advertido en el propio `app.ts`**, cuatro líneas más arriba, para el
router de documentos legales:

> «DEBE ir ANTES de mailerRoutes, que se monta en /api/v1 (wildcard) con authenticateToken y bloquearía
> cualquier request posterior al no encontrar Bearer token.»

La advertencia se cumplió moviendo *ese* router. El storefront nació después, debajo, y volvió a caer en
lo mismo. Un comentario no protege nada: sólo avisa a quien lo lee.

**❌ Lo que NO hay que hacer.** Subir el montaje del storefront por encima de la línea 214. Funciona, y
deja la trampa armada para la siguiente ruta pública que alguien añada abajo.

**✅ Solución (commit `d488701`).** El auth de esos dos routers pasó a ir **ruta por ruta**
(`router.post('/invoices/:id/send-email', authenticateToken, …)`), que son 7 rutas en total. Un router
montado en la raíz ya no decide por los demás: lo que no casa con sus rutas **sigue su camino**.

Dos efectos de regalo: el storefront público funciona esté montado donde esté, y una ruta inexistente
vuelve a dar **404** en vez de 401 — que no es cosmético, es lo que permite distinguir «no está
desplegado» de «está protegido» cuando se diagnostica desde fuera.

**Prueba que lo sostiene.** `backend/src/app-montaje.test.ts` lee `app.ts`, saca los routers montados en
la raíz y falla si alguno trae `router.use(authenticateToken)`. Es **estructural** —no levanta servidor,
no toca base de datos— porque la regla es de montaje, no de ejecución. Comprobado que detecta la
regresión: reintroducido el `router.use` a propósito, la prueba falla.

**Nota.** El detector ignora los comentarios. La primera versión no, y acusaba a los dos archivos… por
las notas que explican precisamente por qué no se usa `router.use(authenticateToken)`.

---

## 27. La tienda sí tenía políticas: nunca hubo dónde verlas

**Síntoma.** La tienda pública se veía pelona: encabezado, rejilla de productos, botón «Agregar». Nada
más. «¿El mismo diseño de página no tiene más opciones?»

**Lo que se encontró.** La tienda **sí** tenía las cuatro políticas capturadas —se escriben en
Comercio Electrónico → Tiendas— y el API **ya las mandaba**:

```
GET /api/v1/storefront/tenis-don-chuy
  "politicas":{"envio":"En la compra de 10 te regalo el envio",
               "devolucion":"No hay devouciones)si no es por defecto)",
               "privacidad":"…","terminos":"…"}
```

En `Storefront.tsx`, `grep -n "politica|terminos|footer"` devolvía **cero**. La pantalla recibía esos
textos y los tiraba a la basura. Peor: la migración que creó la tabla lo daba por hecho desde el
principio —`-- Políticas (texto por ahora; el storefront las muestra)`—. El comentario describía una
intención, no el código.

**Causa raíz.** El storefront se construyó de arriba hacia abajo (encabezado → catálogo → carrito →
checkout → cuenta) y el **pie nunca se escribió**. Como el carrito sí funcionaba, nadie notó el hueco:
la tienda *vendía*, sólo que no decía quién vendía, cuánto costaba el envío ni qué pasaba con una
devolución. Eso es justo lo que un comprador que no te conoce busca antes de soltar su dinero.

**✅ Solución (commit `78215e5`).** Dos bloques, los dos alimentados de datos **reales**; si la tienda
no los tiene capturados, el bloque no sale —un apartado vacío es peor que no tenerlo—:

- **Barra de confianza** bajo el encabezado: quién vende, desde cuánto es el envío, si hay políticas.
- **Pie**: «Vendido y facturado por» con la razón social, el RFC, el estado y los contactos de la
  empresa dueña de la tienda; los métodos de envío con su costo; y las cuatro políticas, cada una en un
  modal que se lee sin salir de la tienda.

El vendedor es un dato **nuevo** en el API (`vendedorDeTienda`): sale de `companies`, que es el **mismo
emisor que irá en el CFDI**, así que la tienda no promete nada que el sistema no vaya a cumplir.

**Comprobado contra la tienda real** (servidor de desarrollo apuntado al backend vivo): el pie sale en
escritorio y en teléfono, el modal abre con el texto que el merchant escribió hace semanas y la consola
no tira un solo error.

**De paso, dos cosas que se vieron al comprobar.**
- `Tiendas` enseñaba la liga como `tienda.hcgm.com.mx/<slug>`, un subdominio **que no existe**. El
  merchant la copiaba a WhatsApp y no abría. Ahora enseña la que de verdad funciona, armada con
  `import.meta.env.BASE_URL` igual que el enlace del botón (ver entrada 25).
- El logo de la tienda de prueba apunta a un **artículo de revista**, no a una imagen: por eso el
  encabezado sale con el ícono roto. Es dato capturado, no código.

---

## 28. «Pagar y facturar» dejaba un borrador y el porqué sólo vivía en el log

**Síntoma.** Se hizo el ejercicio completo —pedido web → «Pagar y facturar»— y salió una **factura
borrador**. ¿Dónde quedó, y por qué no se timbró?

**Dónde quedó.** En el renglón del pedido: `ec_order.invoice_id` apunta a la factura y la pantalla
mostraba `FAC-000001 (borrador)`. La factura existe, con sus renglones y su cliente PÚBLICO EN GENERAL;
lo único que le falta es el UUID del SAT.

**Causa raíz.** `facturarPedido` crea el CFDI y lo manda timbrar. Si el PAC no responde —empresa en
PRUEBAS, CSD sin cargar, contraseña que no abre la `.key` (ver entrada de `CSD_TIMBRADO`)— se atrapa la
excepción, se deja la factura en DRAFT y **el motivo se va al log del servidor**:

```ts
} catch (e: any) {
  logger.warn(`[ec-fulfillment] … creada pero no timbró: ${e.message}`);
}
```

El merchant veía la etiqueta «(borrador)» y ningún porqué. Y el inquilino de **sólo-ecommerce** no puede
abrir la pantalla de Facturas —su sidebar es únicamente la tienda—, así que no tenía forma de
averiguarlo ni de rematar el timbrado.

**✅ Solución (commit `78215e5`).** El motivo se **guarda** (`ec_order.factura_error`, migración
`2026-11-24b_ecommerce_pedido_factura.sql`) y se enseña bajo el folio, en el mismo renglón. Junto a él,
un botón **«Timbrar»** que reintenta sólo el timbrado (`POST /ecommerce/pedidos/:id/timbrar`) sin
recapturar nada; si vuelve a fallar, actualiza el motivo. Al timbrar bien, el motivo se borra.

El borrador casi nunca es culpa del pedido: es el CSD o el ambiente. Lo que faltaba era **decirlo** y
dar dónde rematar.

---

## 29. «El inquilino de sólo-ecommerce no factura con CSD»: sí factura, y no tenía dónde cargarlo

**Síntoma.** La tienda genera CFDI por cada pedido, pero el usuario de la tienda no tiene pantalla para
sus datos fiscales ni para dar de alta a quien le compra con RFC. Su factura de prueba se quedó en
borrador (entrada 28) y no había manera de arreglarlo desde su sesión.

**Causa raíz.** Una suposición escrita en el código, en `Layout.tsx`:

```tsx
{/* Emisor (datos de la empresa que factura). El inquilino de sólo-ecommerce
    no factura con CSD: no se le ofrece este bloque. */}
{!soloEcommerce && ( … )}
```

Era cierto cuando el módulo sólo tenía tiendas y catálogo. Dejó de serlo al llegar la rebanada de
fulfillment: `facturarPedido` crea el CFDI del pedido y llama a `stampInvoice` **con el CSD de la
empresa**. El inquilino factura igual que cualquiera; lo que no tiene es por dónde.

Lo mismo con los clientes: `/customers` existe, lee el **CIF en PDF**, lee un XML de factura y captura a
mano en una ventana — pero su sidebar es únicamente la tienda, así que nunca llegaba.

**❌ Lo que NO hay que hacer.** Escribir una pantalla de emisor y un catálogo de clientes *para
e-commerce*. Serían dos copias de algo que ya existe, y el día que cambie el CFDI habría que acordarse
de las dos.

**✅ Solución (commit `__HASH__`).** Dos rutas nuevas dentro del módulo que **reusan** las pantallas de
siempre:

- `/ecommerce/emisor` → `IssuerModal`, la misma «Datos de mi empresa»: identificación fiscal, domicilio
  (lugar de expedición), contacto, logo, formato del PDF, **CSD**, manifiesto del PAC y correo, con
  lectura de CIF para autollenar.
- `/ecommerce/clientes` → `CustomersPage`, el mismo catálogo de receptores (CFF Art. 29-A), con CIF en
  PDF, XML de factura y captura a mano.

Las dos entradas salen en el submenú **sólo cuando `soloEcommerce`**: el usuario de NEXO completo ya
tiene Clientes bajo Facturas y el Emisor al pie del sidebar, y repetirlos sería menú duplicado.

`CustomersPage` acepta `contable={false}`, que esconde la columna de cuenta contable, los dos botones
que la generan y el campo del modal. No es cosmético: esas llamadas pegan a `/accounting`, que está
gateado por `requireModule('contabilidad')` — a este inquilino le contestarían **403**.

**Y en el hub**, la revisión de la vitrina gana el renglón que de verdad explica el borrador: *«Sello
digital (CSD) para facturar»*, leído de `/vigencias` (cargado y días de vigencia), con su liga a
`/ecommerce/emisor`.

**Nota de permisos.** Esto funciona porque `PUT /companies/:id` **no exige ADMIN**: el controlador deja
pasar a cualquiera cuyo `companyId` sea el de la empresa, y el usuario de la tienda es `role='USER'`.
Es comportamiento previo, no de este cambio, pero ahora se depende de él: cualquier usuario de cualquier
empresa puede cambiar los datos del emisor y subir un CSD. Si se decide restringirlo a ADMIN, el usuario
de la tienda tendrá que ser ADMIN de su empresa.

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
