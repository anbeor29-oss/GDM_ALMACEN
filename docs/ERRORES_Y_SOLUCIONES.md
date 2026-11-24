# Errores y soluciones â€” GDM NEXO

> Registro **curado** de errores que ya nos costaron tiempo, con su causa REAL, la
> soluciÃ³n que quedÃ³ y â€”muy importanteâ€” los intentos que **NO** funcionaron, para no
> volver a diagnosticar desde cero ni repetir un arreglo que ya resultÃ³ contraproducente.
>
> Es distinto de `BITACORA.md` (diario cronolÃ³gico): aquÃ­ cada entrada es un
> **sÃ­ntoma â†’ cÃ³mo diagnosticarlo â†’ causa â†’ soluciÃ³n â†’ quÃ© NO hacer â†’ lÃ­mite conocido**.

---

## 1. Â«Network ErrorÂ» al importar (Contalink u otro proceso largo)

**SÃ­ntoma.** La pantalla de import (p. ej. Contalink â†’ Â«Subir pÃ³lizasÂ») muestra un
recuadro rojo **Â«Network ErrorÂ»**. A veces, al mismo tiempo, otras acciones fallan igual
(p. ej. **Â«No se pudo cambiar de empresa â€” Network ErrorÂ»**).

**CÃ³mo DIAGNOSTICAR (no suponer).**
1. `Network Error` de axios = **no llegÃ³ NINGUNA respuesta HTTP** (conexiÃ³n cerrada/reset),
   no es un 4xx/5xx. No es timeout del cliente: el axios de este proyecto no pone `timeout`
   (default infinito).
2. Si **tambiÃ©n** fallan acciones no relacionadas (cambiar de empresa), el **backend
   entero estÃ¡ caÃ­do**, no sÃ³lo el import.
3. Confirmarlo con el health del backend desplegado:
   ```bash
   curl -s https://gdm-almacen-backend.onrender.com/health
   ```
   Si `commit` es el esperado pero `uptime` se **reinicia** entre llamadas (y a ratos
   responde **502**), el proceso estÃ¡ en **crash-loop**: algo lo estÃ¡ matando.

**Causa raÃ­z (la que nos mordiÃ³, 2026-11-16).** El import corre miles de pÃ³lizas en UNA
peticiÃ³n (decenas de miles de consultas â†’ minutos). Mantener viva esa conexiÃ³n con un
Â«latidoÂ» que escribe al socket en un `setInterval` **TUMBA el proceso**: cuando la conexiÃ³n
ya estÃ¡ cerrada, `res.write` provoca un evento **`'error'` ASÃNCRONO del stream SIN
listener** â†’ Node lo eleva a `uncaughtException` â†’ el handler global de
`backend/src/index.ts` hace **`process.exit(1)`** â†’ se cae **TODO** el backend (por eso
morÃ­a tambiÃ©n Â«cambiar de empresaÂ»).

**âŒ Lo que NO hay que volver a hacer.**
- **NO** mantener abierta una peticiÃ³n HTTP larga para un proceso de minutos.
- **NO** escribir a `res` desde un `setInterval`/`setTimeout` (el Â«latidoÂ»
  `responderConLatido`, ya **eliminado**). Un error de socket sin manejar = `process.exit`.
- Recordar que `backend/src/index.ts` hace `process.exit(1)` en `uncaughtException`:
  **cualquier** excepciÃ³n no atrapada (no sÃ³lo la del import) tira el servidor.

**âœ… SoluciÃ³n que quedÃ³ (commit `eaa3dba`).** PatrÃ³n **trabajo en segundo plano + sondeo**:
- `backend/src/modules/accounting/import-jobs.ts`: registro en memoria.
  `correrImportEnFondo` difiere con `setImmediate` (para que el `res.json(jobId)` salga
  antes del parseo sÃ­ncrono) y envuelve el trabajo en `.then/.catch` â†’ **un error NUNCA
  escapa**, se guarda en el job, no puede tumbar el proceso.
- El POST (`/contalink/polizas`, `/contalink/catalogo`) **responde al instante con
  `{ jobId }`**; `GET /contalink/importar/:jobId` (aislado por empresa) da estado/avance.
- El front sube (0-40 %), obtiene `jobId` y **sondea** (40-99 %) hasta `listo`/`error`;
  **tolera reinicios** (reintenta) y un **404** = el job se perdiÃ³ â†’ Â«vuelve a subir, no se
  duplicaÂ» (el import es idempotente por hash `CTLK:*`).

**Regla general.** Todo proceso de mÃ¡s de ~15-20 s sobre HTTP va con **jobId + sondeo**,
nunca manteniendo la peticiÃ³n abierta ni escribiendo al socket para Â«ganar tiempoÂ».

**El patrÃ³n en segundo plano resolviÃ³ el crash del latido** (ya no se cae por `uncaughtException`
del socket): CORS, ruta de avance y bundle en vivo verificados OK; con el backend ocioso el
`uptime` crecÃ­a sin reiniciarse.

**PERO el archivo GIGANTE SÃ revienta la RAM (OOM) â€” corregido 2026-11-17.** (El supuesto previo
de Â«no es OOMÂ» era FALSO: salÃ­a de medir sÃ³lo la memoria RETENIDA tras el parseo, no el PICO
transitorio.) Al subir de verdad un libro de **todos los aÃ±os (~8 MB)**, el parseo sÃ­ncrono del
`.xls` **pasa de los 512 MB del plan starter** â†’ el OS mata el proceso â†’ crash-loop (`/health`:
`uptime` de ~113 s y luego **502**). Como el parseo corre en segundo plano (`setImmediate`), el POST
ya devolviÃ³ el `jobId`; el sondeo entonces falla y el front muestra **Â«Se perdiÃ³ la conexiÃ³nâ€¦Â»** (y
un POST durante el reinicio = **Â«Network ErrorÂ»**). Eso cuadra con las dos capturas.

**âœ… Arreglo (memoria del parseo, bajo riesgo, sin tocar la mÃ¡quina de estados):**
- `XLSX.read(..., { cellFormula:false, cellHTML:false })` â†’ mucha menos RAM por celda.
- `sheet_to_json(..., { blankrows:false })` â†’ NO materializa las filas VACÃAS (son no-ops); en un
  libro con miles de blancos entre bloques eso ahorra el grueso del arreglo.
- `delete wb.Sheets[nombre]` tras procesar cada hoja â†’ no quedan TODAS las hojas en RAM a la vez.
- **Medido:** la memoria del parseo bajÃ³ **de 14.6 MB a 7.7 MB (~mitad)** en el archivo de prueba, con
  **salida idÃ©ntica** (598 pÃ³lizas, 3 412 movs, 223 CFDI, 0 descuadres) â†’ el pico del libro grande baja
  en proporciÃ³n y debe caber en 512 MB.
- **Si aun asÃ­ un libro fuera demasiado grande:** exportarlo **por AÃ‘O** (idempotente, aditivo) o
  **subir la RAM** de Render (plan Standard) â€” eso lo resuelve para cualquier tamaÃ±o.

**Verificado (parser), idÃ©ntico antes y despuÃ©s del arreglo:** 598 pÃ³lizas, 3 412 movs, 223 CFDI,
0 descuadres.

---

## 2. CSD / timbrado â€” Â«No se pudo cargar la llave privadaÂ» (bad decrypt)

`bad decrypt` = la **contraseÃ±a NO abre la `.key`** (no es vigencia). Detalle y guÃ­a en
`docs/CSD_TIMBRADO.md` y la memoria [[csd-timbrado-llave]].

---

## 3. Codificar pÃ³lizas Â«Todo el aÃ±oÂ» â†’ `date/time field value out of range: "2026-00-01"`

**SÃ­ntoma.** Al codificar las pÃ³lizas pendientes con **Â«Todo el aÃ±oÂ»** seleccionado, Postgres truena con
`date/time field value out of range: "2026-00-01"` y no se contabiliza nada.

**Causa raÃ­z.** Con Â«Todo el aÃ±oÂ» el front mandaba `mes = 0`; en `polizas.service.ts` el helper
`iniDeMes(anio, 0)` armaba literalmente `${anio}-00-01` â†’ mes 0 no existe â†’ fecha invÃ¡lida.

**âŒ Lo que NO hay que hacer.** Parchear sÃ³lo el front (seguirÃ­a roto si cualquier otra pantalla manda
mes = 0). El arreglo va en el **helper**, que es el origen Ãºnico.

**âœ… SoluciÃ³n (commit `f7bd659`).**
- `iniDeMes`/`finDeMes`: **mes 1â€“12** = ese mes; **mes 0 o fuera de rango** = **AÃ‘O COMPLETO**
  (`${anio}-01-01` â€¦ `${anio}-12-31`). Un solo lugar, cubre todas las pantallas.
- `DocsContabilizar.tsx` pasa `todoElAnio = (mes === 0)` a `generarVentas/generarCompras` (las rutas
  `â€¦DelAnio` ya existÃ­an en el backend).

**Verificado.** `tsc` backend + frontend verde.

---

## 4. Libro diario (respaldo NEXO): Â«las pÃ³lizas de enero a septiembre 2026 no se subenÂ» (RFC saj10120859a)

**SÃ­ntoma.** Al importar el `libro-diario.xls` de saj10120859a, las pÃ³lizas de **eneâ€“sep 2026** no aparecen.

**CÃ³mo diagnosticar.** RÃ©plica FIEL del parser (`raw:true`, misma mÃ¡quina de estados) corrida sobre el
archivo real, contando pÃ³lizas y omisiones **por mes**.

**Hallazgo (el archivo NO es el problema).** El `.xls` (OLE2/BIFF8 real) parsea al **100 %**:
**240 pÃ³lizas**, Dic-2025 â†’ Nov-2026, **eneâ€“sep completas (183)**, en **orden cronolÃ³gico** (0 saltos),
con **1 sola duplicada real** (2026-01-20, Â«iva de comisiones bancariasÂ»). Ni el parser ni `crearPoliza`
descartan por mes; el `UNIQUE (company_id, origen_uuid)` es **por empresa** (no colisiona entre empresas).

**Causa raÃ­z (BD / visibilidad, no el archivo).** El faltante de eneâ€“sep es de **estado de la base**, no del
parseo: (a) el import no completÃ³ contra esa empresa, o (b) las pÃ³lizas entraron pero **falta reconstruir la
balanza** (los estados leen los **saldos de los periodos**, no las pÃ³lizas directas). Oct-Nov 2026
probablemente ya existÃ­an Â«en vivoÂ» (operaciÃ³n reciente), por eso sÃ­ se ven.

**QuÃ© hacer.** Importar respaldo â†’ en la **pantalla verde de resultados**, botÃ³n **Â«Reconstruir todos los
ejerciciosÂ»** (o Balanza de comprobaciÃ³n â†’ **Â«Reconstruir aÃ±oÂ»** 2026). Para confirmar quÃ© hay realmente,
contar pÃ³lizas por mes en la BD (consulta en `docs/DIAGNOSTICO_POLIZAS_SAJ.sql`).

**âœ… Mejora defensiva (commit `9911e40`).** `fechaDeCelda()` en `contalink-import.service.ts` acepta la
cabecera Â«FechaÂ» como **serial de Excel, Date o texto** (ISO / DD-MM-AAAA). ANTES sÃ³lo se aceptaba nÃºmero:
si un export la escribÃ­a como Date o texto, **TODAS** las pÃ³lizas se caÃ­an como Â«sin fecha vÃ¡lidaÂ» y no
entraba nada. (En este archivo venÃ­a numÃ©rica, asÃ­ que no era la causa aquÃ­, pero blinda el caso.)

**LÃ­mite conocido.** Si Oct-Nov ya existÃ­an en vivo, re-importar el respaldo los **duplicarÃ­a** (la
idempotencia CTLK sÃ³lo coteja contra imports CTLK previos, no contra pÃ³lizas en vivo). Revisar duplicados
por mes tras el import si aplica.

---

## 5. Â«Eneâ€“sep 2026 no carganÂ» (AABA020418BW2): pÃ³lizas FANTASMA (encabezado sin renglones)

**SÃ­ntoma.** La balanza anual 2026 de ALEJANDRO AYALA BARBA muestra **ENEâ€“SEP en 0** y solo
OCTâ€“NOVâ€“DIC con saldo. Al re-importar el libro diario dice **Â«0 creadas Â· 183 ya estabanÂ»** y la
reconstrucciÃ³n integral solo toca **Â«3 mesesÂ»**. (Antes se pensÃ³ â€”entrada #4â€” que era solo falta de
reconstruir; el dato real lo dio la combinaciÃ³n Â«ya estabanÂ» + Â«3 mesesÂ» + balanza 0.)

**Causa raÃ­z.** Las 183 pÃ³lizas de eneâ€“sep **existen como ENCABEZADO (`journal_entries`) pero SIN
renglones (`journal_lines`)** â€” una importaciÃ³n previa a medias creÃ³ la cabecera y no las partidas.
Entonces:
- El candado de idempotencia contaba por `origen_uuid` (sin mirar renglones) â†’ **Â«ya estabanÂ»** â†’
  nunca se re-creaban.
- La balanza/`reconstruirIntegral` se derivan de `journal_lines` (`alimentarAnioDesdePolizas` hace
  `JOIN journal_lines`) â†’ esas pÃ³lizas **no existen** para la balanza â†’ eneâ€“sep en 0 y solo 3 meses
  reconstruidos (Dic-2025, Oct, Nov, que sÃ­ tienen renglones).

**âŒ Lo que NO sirve.** Solo Â«Reconstruir aÃ±oÂ» (no hay renglones que sumar). Re-importar el archivo
completo (decÃ­a Â«ya estabanÂ» y no sanaba; ademÃ¡s duplicarÃ­a oct-nov si ya existen en vivo).

**âœ… SoluciÃ³n (commit de esta fecha).** El importador **SANA** las fantasma:
- La idempotencia ahora solo cuenta pÃ³lizas CTLK **que tienen renglones**
  (`AND EXISTS (journal_lines)`), asÃ­ una fantasma NO se considera Â«ya importadaÂ».
- Antes de re-crear cada pÃ³liza, un `DELETE â€¦ WHERE NOT EXISTS (journal_lines)` **borra la fantasma**
  (nunca toca una con renglones) para evitar chocar con el Ã­ndice Ãºnico `(company_id, origen_uuid)`.
- El reporte aÃ±ade Â«N sanada(s)Â». Tras re-importar â†’ **Â«Reconstruir todos los ejerciciosÂ»**.
- Para no duplicar oct-nov (que ya estaban en vivo), se entregÃ³ un **archivo filtrado solo eneâ€“sep**
  (`libro-diario-AABA-ene-sep-2026.xlsx`, generado del respaldo; verificado: 183 pÃ³lizas, 0 omitidas).

**DiagnÃ³stico BD.** `docs/DIAGNOSTICO_POLIZAS_SAJ.sql` (parametrizable por RFC) â€” y para ver fantasmas:
`SELECT count(*) FROM journal_entries je WHERE je.company_id=â€¦ AND je.origen_uuid LIKE 'CTLK:%' AND NOT EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.entry_id=je.id);`

**âœ… CONFIRMADO funcionando (2026-11-18).** La pantalla Â«Periodos contablesÂ» del cliente mostrÃ³ **Â«0 cerradosÂ»** y
ene-sep en **Â«Sin saldosÂ»** â†’ NO era periodos cerrados, eran **fantasmas** (encabezado sin renglones). Lo que lo
resolviÃ³, SIN desplegar: en el Web Shell de Render, `DELETE FROM journal_entries â€¦ AND NOT EXISTS (journal_lines)`
(borra los 183 encabezados vacÃ­os) â†’ re-importar `libro-diario-AABA-ene-sep-2026.xlsx` (ahora dice Â«183 creadasÂ», ya
no Â«ya estabanÂ») â†’ **Â«Reconstruir todos los ejerciciosÂ»** â†’ ene-sep con saldos. El auto-saneo del importador (commit
`62288e6`) hace lo mismo al re-importar, una vez desplegado.

**LÃ­mite conocido.** No se hallÃ³ POR QUÃ‰ la 1.Âª importaciÃ³n dejÃ³ cabeceras sin renglones (crearPoliza es
transaccional); el saneo es idempotente y cubre el caso venga de donde venga.

---

## 6. Â«Al timbrar sale un error y se BORRA la pantallaÂ» (pantalla en blanco)

**SÃ­ntoma.** El usuario da Timbrar, aparece un error y la **pantalla queda en BLANCO** (no se puede leer el error).

**Causa raÃ­z.** DOS cosas encadenadas: (1) la app **no tenÃ­a ErrorBoundary**, asÃ­ que un error durante el RENDER
desmontaba TODO el Ã¡rbol de React y dejaba la pÃ¡gina vacÃ­a; (2) el crash concreto era el **modal recordatorio de Uso
CFDI** (`TimbrarRecordatorio`, commit `7f9778d`): leÃ­a el catÃ¡logo SAT como `.data` y llamaba `.find()` â†’
`TypeError: o.find is not a function`. El catÃ¡logo de `api.getCatalog('usoCfdi')` viene en **`.data.entries`** (cada
entrada: `catalog_key` + `description`), NO en `.data`.

**CÃ³mo diagnosticar.** Con el ErrorBoundary puesto, el error se LEE (ya no es blanco): `o.find is not a function` en
`tH` (ErpPrivado). DevTools â†’ Console tambiÃ©n lo muestra.

**âœ… SoluciÃ³n (commits `d3c566e` + `aaf8c3c`).**
- **ErrorBoundary** (`components/ErrorBoundary.tsx`) envuelve el Router en `App.tsx`: ante cualquier crash de render
  muestra el error + detalle + botones (Copiar/Reintentar/Recargar) en vez de blanco. **Red de seguridad general.**
- Fix del modal: `const usos = Array.isArray((usosResp)?.data?.entries) ? â€¦ : []` y `u.catalog_key === uso`.
  El `Array.isArray` evita que vuelva a tronar aunque cambie la forma.
- `handleStamp` escribe el error COMPLETO (status+data) en la consola; blindado el acceso a `result.data`.

**âŒ Lo que NO hay que hacer.** Dejar `.find()` directo sobre `response.data` de un catÃ¡logo sin verificar que es
arreglo (la forma es `{ success, data: { entries: [...] } }`, no un arreglo plano). Y no tener ErrorBoundary: un
error de render = pantalla en blanco imposible de diagnosticar.

**LÃ­mite conocido.** El ErrorBoundary SÃ“LO atrapa errores de RENDER; los de promesas (fetch/timbrado) van por try/catch.

---

## 7. Facturas PUE salÃ­an Â«PendientesÂ» e INFLABAN la cobranza

**SÃ­ntoma.** En el reporte de facturas (Excel/Historial) y en el menÃº de Facturas, folios PUE (p. ej. 295 y 300)
aparecÃ­an en rojo como Â«PendienteÂ» con saldo = total, aunque ya estaban pagadas. La cobranza se veÃ­a inflada.

**Causa raÃ­z.** El saldo se calculaba `total âˆ’ pagos âˆ’ notas de crÃ©dito` para TODA factura. Una **PUE** (Pago en Una
ExhibiciÃ³n) se liquida con su forma de pago real **al timbrar** y **no lleva complemento de pago**, asÃ­ que nunca
registra un `payment` â†’ su saldo quedaba en el total completo. SÃ³lo la **PPD** (Parcialidades/Diferido) lleva
complemento por cada pago y sÃ­ es cuenta por cobrar. Ver [[pue-ppd-cobranza-regla]].

**CÃ³mo diagnosticar.** Una factura con `payment_method LIKE 'PUE%'`, timbrada y no cancelada, mostrando saldo > 0.
Los reportes de cobranza (`reports.service`) ya excluÃ­an PUE; el desajuste estaba en el **listado de facturas**
(`getInvoices`) y en el **historial** (`historial-facturas.service`).

**âŒ Lo que NO hay que hacer.** Calcular el saldo de una PUE como `total âˆ’ pagos`: nunca habrÃ¡ pagos registrados, asÃ­
que siempre darÃ¡ el total. No mezclar PUE con PPD en los controles de cobranza.

**âœ… SoluciÃ³n (commit `7145a8e`).**
- `getInvoices` (invoices.service): el saldo y el pagado ahora llevan `CASE WHEN payment_method LIKE 'PUE%'` â†’
  `balance = 0`, `paid_total = i.total`, y se expone la bandera `es_pue`.
- `Invoices.tsx`: el badge de Estado muestra **Â«PagadaÂ»** cuando la factura es PUE + timbrada + no cancelada
  (el saldo ya llega en 0 desde el backend).
- `historial-facturas.service`: en el mapeo, una PUE no cancelada se marca `PAGADA` (verde) con saldo 0.
- `reports.service` ya excluÃ­a PUE (sin cambios).

**LÃ­mite conocido.** La regla se basa en `payment_method`. Si una factura PUE se capturÃ³ con mÃ©todo vacÃ­o/incorrecto,
no se detecta como PUE; el mÃ©todo debe venir correcto del alta/timbrado.

---

## 8. PÃ³lizas â†’ NÃ³mina (emitida): corridas de un mes no aparecÃ­an (se filtraban por dÃ­a de PAGO)

**SÃ­ntoma.** En **Contabilidad â†’ PÃ³lizas â†’ NÃ³mina â†’ NÃ³mina emitida**, al elegir un mes concreto (p. ej. **julio 2026**)
la tabla salÃ­a vacÃ­a (Â«Sin corridas de nÃ³minaÂ») y el botÃ³n **Â«Bajar pendientesÂ»** quedaba deshabilitado, aunque la
nÃ³mina de todo el aÃ±o ya estaba generada/timbrada. En **Â«Todo el aÃ±oÂ»** sÃ­ aparecÃ­an.

**Causa raÃ­z.** El filtro de mes del frontend tomaba el mes de **`fecha_pago`** (y si no, de `fecha_fin`). La
provisiÃ³n de nÃ³mina es **devengo**: pertenece al mes que **cubre** la corrida, no al dÃ­a en que se paga. Si a una
corrida de julio se le fijÃ³ `fecha_pago` en los primeros dÃ­as de agosto (pago el 5 de agosto), caÃ­a en **agosto** y
julio quedaba vacÃ­o. Mezclaba fecha de **caja** con mes **contable**.

**CÃ³mo diagnosticar.** Cambiar el selector de mes a **Â«Todo el aÃ±oÂ»**: si ahÃ­ aparecen las corridas pero en el mes
concreto no, el problema es el criterio de mes, no los datos ni el aislamiento de empresa. El endpoint
`/nomina/poliza-periodos` no filtra por fecha (devuelve todo); el filtro vivÃ­a sÃ³lo en `PolizasHub.tsx`.

**âŒ Lo que NO hay que hacer.** Clasificar el mes contable de una provisiÃ³n de nÃ³mina por `fecha_pago`. La fecha de
pago es caja; el devengo lo marca el periodo (`fecha_inicio`/`fecha_fin`, o el `numero` del mes para MENSUAL).

**âœ… SoluciÃ³n (commit `1950b14`).**
- `PolizasHub.tsx` (NominaEmitida): nuevo `mesPeriodo(p)` â†’ para **MENSUAL** usa `numero` (1â€“12); para lo demÃ¡s, el
  mes de **`fecha_fin`** (cierre del periodo), con respaldo `fecha_inicio`/`fecha_pago`. El filtro `enPeriodo` ahora
  empareja `anio` + `mesPeriodo`, sin usar `fecha_pago`.
- La columna Â«FechaÂ» de la fila muestra `fecha_fin` (devengado) en vez del dÃ­a de pago, para que concuerde con el mes.
- Â«NÃ³mina recibidaÂ» no cambia: filtra en el backend por su propia fecha de CFDI (otra semÃ¡ntica).

**LÃ­mite conocido.** Una corrida SEMANAL que cierra el primer dÃ­a del mes siguiente (p. ej. semana que termina el 1
de agosto) se archiva en ese mes de cierre. Es una convenciÃ³n consistente (el periodo cierra en agosto); si se
quisiera por inicio, se cambiarÃ­a a `fecha_inicio`.

---

## 9. PÃ³lizas â†’ NÃ³mina (emitida) seguÃ­a vacÃ­a: la nÃ³mina se timbrÃ³ FUERA del mÃ³dulo de NÃ³mina

**SÃ­ntoma.** Tras el arreglo #8, **NÃ³mina emitida** seguÃ­a en Â«Sin corridas de nÃ³minaÂ» y Â«Bajar pendientesÂ»
deshabilitado, aunque la nÃ³mina de todo 2026 estaba timbrada. La **NÃ³mina recibida** sÃ­ aparecÃ­a.

**Causa raÃ­z.** La pestaÃ±a sÃ³lo leÃ­a las corridas del **mÃ³dulo de NÃ³mina** (`nomina_periodos` + `nomina_recibos`).
Esta empresa timbra su nÃ³mina en **otro sistema**: no hay corridas en el mÃ³dulo; sus recibos sÃ³lo existen en la
**bÃ³veda de XML** (`cfdi_recibidos`, `direccion='emitidos'`, `tipo_comprobante='N'`), que llena la descarga del SAT.
La recibida sÃ­ salÃ­a porque Ã©sa siempre leyÃ³ la bÃ³veda. AdemÃ¡s, `/nomina/*` exige el mÃ³dulo de NÃ³mina
(`requireModule('nomina')`) y si falla, la tabla mostraba Â«Sin corridasÂ» **sin enseÃ±ar el error**.

**âŒ Intento que NO resolviÃ³ (registrado).** El #8 (mes por periodo devengado, no por `fecha_pago`) es correcto y se
queda, pero sÃ³lo arregla empresas que SÃ usan el mÃ³dulo. AquÃ­ no habÃ­a corridas que filtrar.

**âŒ Lo que NO hay que hacer.**
- Reconstruir las corridas DENTRO del mÃ³dulo (crear periodos/recibos/trabajadores desde el XML): crear un trabajador
  exige confirmaciÃ³n explÃ­cita (importar-xml.service) y alterarÃ­a acumulados de ISR, PTU, aguinaldo y la revisiÃ³n anual.
- Contabilizar la bÃ³veda sin candados: los recibos que timbrÃ³ el propio mÃ³dulo TAMBIÃ‰N estÃ¡n en la bÃ³veda (su pÃ³liza
  de corrida no lleva los UUID) y los respaldos CPQ/CTLK pueden traer ya la provisiÃ³n â†’ se duplicarÃ­a el gasto.
- Poner las rutas bajo `/nomina`: quien timbra fuera puede no tener el mÃ³dulo.

**âœ… SoluciÃ³n (commit `da30148`).**
- Backend `sat-descarga/nomina-emitida-xml.ts` (puro, con pruebas Jest) + `nomina-emitida-xml.service.ts`: lee los
  emitidos tipo N de la bÃ³veda cuyo **FechaFinalPago** cae en el periodo (mismo criterio devengado que el #8), los
  agrupa en **corridas** (tipo de nÃ³mina + periodo + fecha de pago) y arma la MISMA pÃ³liza de provisiÃ³n que la corrida
  del mÃ³dulo, con las cuentas de AsignaciÃ³n de cuentas â†’ NÃ³mina (percepciones 601 / subsidio 110 / deducciones
  216-205-213 / neto 210). El concepto se reconoce por su **clave SAT** (el catÃ¡logo de NEXO estÃ¡ indexado asÃ­); 011 â†’
  FONACOT, 009 â†’ INFONAVIT; lo que no tiene concepto propio cae al Â«cajÃ³nÂ» (039 / 004), rotulado y avisado.
- Rutas `GET /sat-descarga/nomina-emitida/corridas` y `POST /sat-descarga/nomina-emitida/contabilizar` (ADMIN).
- `crearPoliza` acepta `cfdis` opcional: liga los UUID en `journal_entry_cfdi` en la MISMA transacciÃ³n.
- Candados: excluye los UUID de `nomina_recibos`; Â«ya contabilizadoÂ» = `cfdiYaContabilizado` (3 vÃ­as); `origen_uuid`
  = `NOMXML:<md5 de los UUID>` (doble clic choca); dedupe por UUID; sÃ³lo emisor = RFC de la empresa; el neto del
  detalle debe ser el Total del CFDI; red Â«posible duplicadoÂ» (otra pÃ³liza en las fechas con el mismo neto abonado
  fuera de caja/bancos o el mismo total de percepciones) â†’ sale del bloque, se fuerza una por una confirmando.
- Frontend `PolizasHub.tsx`: Â«Bajar pendientesÂ» SIEMPRE activo (baja corridas del mÃ³dulo y luego busca y baja la
  bÃ³veda); tabla Â«NÃ³mina emitida en la bÃ³veda de XMLÂ» con faltantes, posible duplicado, conceptos sin concepto propio
  y vista previa de la pÃ³liza (ojo); avisos de recibos sin XML, que no cuadran o de otro RFC.

**LÃ­mite conocido.** La pÃ³liza lleva la **fecha de pago** (igual que la corrida del mÃ³dulo): una nÃ³mina de julio
pagada en agosto se lista en julio pero su pÃ³liza queda en agosto. Todos los Â«otros pagosÂ» van a la cuenta del
subsidio (como en el mÃ³dulo). La red de duplicado empata importes exactos: un respaldo que agrupÃ³ la nÃ³mina por mes
no se detecta (revisar antes de bajar esos meses).

---

## 10. Subcuentas de cliente/proveedor nacÃ­an con el agrupador del MAYOR (105 / 201)

**SÃ­ntoma.** En la **balanza (Reportes NIF)** aparecÃ­an terceros creados por el motor de pÃ³lizas con el agrupador
del rubro: `11025001 LUIS AMADOR TORALES DURON` con **105** y `21005001 PEDRO MARTINEZ HERNANDEZ` con **201**,
en vez de `105.01` y `201.01`.

**Causa raÃ­z.** En `resolverOCrearSubcuentaTercero` (catalogo-terceros.service) el INSERT de la subcuenta copiaba
`control.codigo_agrupador`. Y `cuentaControl` busca el control por el agrupador **especÃ­fico Y por su padre**
(`IN ('105.01','105')`) justamente porque *el mayor del respaldo suele traer el agrupador padre* â€” asÃ­ que el
tercero heredaba **105 / 201**. La regla del propio proyecto es la contraria y estÃ¡ declarada en el mapeador:
`{ /CLIENTES/, agrupador: '105', hijos: '105.01' }` y `{ /PROVEEDORES/, agrupador: '201', hijos: '201.01' }` â€”
el **mayor** lleva el rubro, los **hijos** el especÃ­fico.

**Por quÃ© importa (no es cosmÃ©tico).** Media app filtra por el agrupador ESPECÃFICO, asÃ­ que esos terceros quedaban
invisibles: `listarSubcuentasTercero` (pantalla de subcuentas), **`saldosPorCliente` â†’ cuentas por cobrar desde la
contabilidad**, `capturarTercerosEnCatalogo`, el enlace `customers.cuenta_contable` y hasta `reorganizarTerceros`
(filtra `['105.01','105.02','201.01','201.02']`, o sea *la herramienta de reparaciÃ³n tampoco los veÃ­a*). AdemÃ¡s
el `ya`-existe de la propia funciÃ³n busca por `codigo_agrupador = ANY(['105.01','105.02'])`, de modo que si el
control elegido cambiaba, el tercero no se encontraba y se **duplicaba**. En la balanza sÃ­ salÃ­an porque los
estados financieros suman por PREFIJO (`suma('105')`), por eso se veÃ­a ahÃ­ y en ningÃºn otro lado.

**CÃ³mo diagnosticar.** En la balanza, una subcuenta de tercero (con nombre de persona/empresa) cuyo agrupador sea
`105` o `201` pelÃ³n. En SQL: `tercero_rfc IS NOT NULL AND codigo_agrupador IN ('105','201')`.

**âŒ Lo que NO hay que hacer.**
- Â«PromoverÂ» a 105.01/201.01 toda cuenta con agrupador 105/201: el **mayor** (1-10-25-000) debe conservar el de
  rubro. Por eso la correcciÃ³n exige `tercero_rfc IS NOT NULL` â€” un control nunca lo tiene.
- Pisar un agrupador especÃ­fico ya puesto (p. ej. `105.02` capturado a mano): puede ser deliberado.

**âœ… SoluciÃ³n (commit `6cd7ead`).**
- `resolverOCrearSubcuentaTercero`: el INSERT usa el agrupador **especÃ­fico** (`agrup`, que sale del tipo + RFC:
  `XEXXâ€¦` â†’ extranjero), no el del control. Al **ligar** una cuenta del respaldo, sÃ³lo se le pone el especÃ­fico si
  venÃ­a vacÃ­o o con el del rubro; uno especÃ­fico ya puesto no se pisa.
- Nueva `normalizarAgrupadorTerceros(companyId)`: corrige las que ya nacieron mal
  (`tercero_rfc IS NOT NULL AND codigo_agrupador IN ('105','201')` â†’ `.01`/`.02` segÃºn el RFC).
- Se engancha donde el usuario puede ejecutarla: en el botÃ³n **Â«Asignar agrupadorÂ»** del CatÃ¡logo de cuentas
  (`POST /accounting/cuentas/asignar-agrupador`), que corre justo despuÃ©s de la herencia del padre â€”que es la que
  deja el 105â€”; tambiÃ©n al inicio de `reorganizarTerceros` y dentro de `generarSubcuentasDeComprobantes`.

**LÃ­mite conocido.** SÃ³lo corrige terceros con `tercero_rfc`. Las hojas del respaldo sin RFC que quedaron con
`105`/`201` no se tocan (no se puede distinguirlas del mayor sin adivinar): Ã©sas se ligan al pasar el motor, o se
capturan a mano. **Â«Reorganizar tercerosÂ» sigue OCULTO** en el CatÃ¡logo (`false &&`, decisiÃ³n del 2026-11-11), asÃ­
que la vÃ­a real es Â«Asignar agrupadorÂ».

---

## 11. Alta de cuentas: el cÃ³digo no respetaba la MÃSCARA ni rellenaba huecos

**SÃ­ntoma.** Al dar de alta una subcuenta, la pantalla prellenaba el cÃ³digo con
**`<cÃ³digo del padre>` + punto** (`1-10-25-000.`), que no es un cÃ³digo vÃ¡lido de ninguna mÃ¡scara. El usuario pidiÃ³
la regla explÃ­cita: *Â«no nada mÃ¡s pongas el nÃºmero, acuÃ©rdate que tienen un formatoâ€¦ pero primero revisa si puedes
rellenar los huecos de la serie de clientes o proveedoresÂ»*.

**Causa raÃ­z.** La regla de numeraciÃ³n sÃ³lo existÃ­a para TERCEROS (`codigoSiguienteTercero`, que sÃ­ usa mÃ¡scara y sÃ­
rellena huecos). El alta general (`crearCuenta` + `ModalNuevaCuenta`) no tenÃ­a ninguna: validaba que el cÃ³digo
colgara del padre y que no se duplicara, pero aceptaba cualquier formato y no proponÃ­a nada.

**La regla (mascara-cuenta.ts).** Un catÃ¡logo mexicano numera con una mÃ¡scara de segmentos de ancho fijo
(`#-##-##-###` â†’ `1-10-25-001`), y el PRIMER segmento es el RUBRO: 1 activo Â· 2 pasivo Â· 3 capital Â· 4 ingresos Â·
5/6 costos y gastos. De ahÃ­ las dos reglas:
1. **Formato** â€” el hijo de `1-10-25-000` es `1-10-25-001`, nunca `1-10-25-000.1` ni `1-10-25-000-001` (un segmento
   de mÃ¡s). El hijo conserva los segmentos del padre y sÃ³lo numera el suyo, asÃ­ que el rubro queda garantizado por
   construcciÃ³n: un pasivo NO puede colgar de un activo.
2. **Huecos** â€” se ocupa el PRIMER nÃºmero libre (001, 002, 003â€¦), no el siguiente al mayor: un alta nueva rellena el
   hueco que dejÃ³ una cuenta dada de baja y la serie sÃ³lo crece cuando ya no hay huecos.

**âŒ Lo que NO hay que hacer.** Imponer la mÃ¡scara a un catÃ¡logo HEREDADO con numeraciÃ³n propia: se romperÃ­a el alta
de quien importÃ³ su catÃ¡logo. La regla sÃ³lo se aplica cuando el PADRE ya estÃ¡ en la mÃ¡scara.

**âœ… SoluciÃ³n (commit `97a667e`).**
- `mascara-cuenta.ts`: mÃ³dulo PURO con la regla (`siguienteCodigoHijo` rellena huecos, `normalizarAMascara`,
  `conMascara`, `cuelgaDeEnMascara`, `rubroDe`) + 16 pruebas Jest.
- `crearCuenta`: con el padre en la mÃ¡scara, **genera** el cÃ³digo si no se escribiÃ³ ninguno y **normaliza** el que
  se escriba (da igual `11025001`, `1-10-25-001` o `1.10.25.001`), para que el catÃ¡logo no acabe con tres formatos
  del mismo nÃºmero. Sin mÃ¡scara utilizable se respeta lo capturado (comportamiento anterior).
- `GET /accounting/cuentas/siguiente-codigo?parentId=` + `sugerirCodigoHijo()`.
- `ModalNuevaCuenta`: propone el cÃ³digo correcto al abrir y explica de dÃ³nde saliÃ³; ya no prellena Â«padre + puntoÂ».
- Clientes/proveedores ya cumplÃ­an la regla (`codigoSiguienteTercero`): se verificÃ³, no se tocÃ³.

**LÃ­mite conocido.** Escribir sÃ³lo el Ãºltimo segmento (`001`) se interpreta como `0-01-00-000` y falla el candado de
Â«cuelga del padreÂ» â€” es ambiguo a propÃ³sito; el formulario ya propone el cÃ³digo completo. Queda duplicado el helper
`anchosDeMascaraCat` en catalogo.service (ruta de importaciÃ³n), pendiente de unificar con el mÃ³dulo nuevo.

---

## 12. Checador: Â«Permission deniedÂ» en la cÃ¡mara y pestaÃ±as atoradas en Â«Cargandoâ€¦Â»

**SÃ­ntoma.** (a) Enrolar rostro, Abrir kiosco y Campo mostraban un cuadro negro con **Â«Permission deniedÂ»** en inglÃ©s;
(b) las pestaÃ±as ConfiguraciÃ³n, Kioscos y Registro se quedaban en **Â«Cargandoâ€¦Â»** para siempre; (c) el kiosco y el
modo campo ocupaban toda la pantalla **sin ningÃºn control para volver**.

**Causa raÃ­z.**
- (a) Las tres pantallas hacÃ­an `catch (e) { setError(e.message) }` y pintaban el mensaje CRUDO del navegador. Ese
  texto es para el programador: no dice la causa (son 5 distintas con salidas distintas) ni ofrece reintentar. La
  causa que mÃ¡s se esconde: `getUserMedia` sÃ³lo funciona en **contexto seguro** (https:// o localhost); abierta por
  http:// o por IP de la red local el navegador **ni siquiera pregunta**, y el error igual sale como Â«permiso
  denegadoÂ», que es mentira.
- (b) `if (!f) return <p>Cargandoâ€¦</p>` sin rama de error: si la peticiÃ³n fallaba, el estado nunca se llenaba.
- (c) SÃ³lo habÃ­a un engrane gris de 20 px arriba a la derecha, sin etiqueta: nadie lo encontraba.

**âŒ Lo que NO hay que hacer.** Mostrar `e.message` de una API del navegador a quien estÃ¡ parado frente a la tableta;
y dejar una pantalla completa sin salida (heurÃ­stica #3 de Nielsen: control y libertad del usuario).

**âœ… SoluciÃ³n (commit `233f7b3`).**
- `components/CamaraAviso.tsx`: `revisarEntornoCamara()` comprueba contexto seguro y disponibilidad de la API ANTES
  de pedir la cÃ¡mara; `diagnosticarCamara(e)` mapea `NotAllowedError` / `NotFoundError` / `OverconstrainedError` /
  `NotReadableError` a causa + pasos concretos en espaÃ±ol; `<CamaraAviso>` los pinta con `role="alert"`, botÃ³n
  Reintentar de 44 px y un `<details>` con el detalle tÃ©cnico para soporte. Tonos claro y oscuro, ambos AA.
- `components/BotonSalirPantalla.tsx`: salida fija arriba-izquierda, 44Ã—44 px, foco visible. En el KIOSCO va con
  confirmaciÃ³n (equipo compartido: no debe salirse del modo registro por un roce); en campo, directa.
- Las tres pantallas de cÃ¡mara reintentan de verdad (el efecto depende de `intento`, ya no hay que recargar).
- `TabConfig`: rama `q.isError` con la causa y botÃ³n Reintentar.
- Barra del Checador: pestaÃ±as y accesos de cÃ¡mara **separados en dos grupos** (unas cambian el contenido, los otros
  abren pantalla completa), con `role="tablist"`/`aria-selected`, foco visible y microinteracciÃ³n. Mismo esquema de
  color (`claseOpcion`), como pide [[opciones-menu-colores]].

**LÃ­mite conocido.** No se pudo verificar en ejecuciÃ³n: las pantallas estÃ¡n detrÃ¡s del login y no se usan las
credenciales del usuario. Compila y empaqueta; **falta probar en la tableta real**. Si el Â«Permission deniedÂ» venÃ­a
de http://, el aviso ahora lo dirÃ¡ â€” pero la soluciÃ³n de fondo es servir el checador por https.

---

## 13. Checador: el consentimiento biomÃ©trico se otorgaba con una PALOMITA (sin prueba de la firma)

**SÃ­ntoma.** Para liberar el enrolamiento facial bastaba marcar una casilla (Â«El trabajador firmÃ³ el
consentimientoÂ»). Nada obligaba a imprimir el convenio, ni a que el trabajador lo firmara, ni quedaba constancia de
nada. AdemÃ¡s el engrane de Â«AdministraciÃ³nÂ» de las pantallas de cÃ¡mara iba al MISMO lugar que el botÃ³n Salir â€”dos
controles para lo mismo, y uno de ellos prometiendo configuraciÃ³n que no dabaâ€”.

**Causa raÃ­z.** El rostro es un dato personal **SENSIBLE** (art. 3 fr. VI LFPDPPP) y la ley pide consentimiento
**expreso y por escrito**. Una palomita en pantalla no prueba nada el dÃ­a de una queja ante el INAI: no identifica
quiÃ©n la marcÃ³, ni que el trabajador haya leÃ­do o firmado algo. El orden real es fÃ­sico (imprimir â†’ firmar en papel
â†’ archivar la prueba) y el sistema no lo imponÃ­a.

**CÃ³mo diagnosticar.** `SELECT aceptado, documento IS NOT NULL FROM checador_consentimiento` â€” si hay `aceptado =
true` con `documento` nulo, ese enrolamiento no tiene prueba de la firma detrÃ¡s.

**âŒ Lo que NO hay que hacer.** Dejar que una casilla de la UI sea la Ãºnica evidencia de un consentimiento de dato
sensible. Y confiar en Â«Â¿se imprimiÃ³?Â» como prueba: que el navegador abra el diÃ¡logo de impresiÃ³n no significa que
alguien haya firmado.

**âœ… SoluciÃ³n (commit `fa3c821`).** El candado del enrolamiento pasa a ser la **evidencia**:
1. **Imprimir** el convenio (el texto ya existÃ­a en `ConsentimientoBiometrico.tsx`) â†’ `impreso_at`.
2. **Firma autÃ³grafa** en papel, por duplicado â€” fuera del sistema.
3. **Foto del convenio firmado** â†’ `checador_consentimiento.documento` (data-URL, mismo patrÃ³n que la foto del
   trabajador y la de entregas de equipo). **Esa foto, y sÃ³lo esa, libera el rostro.**
- `enrolarRostros` rechaza si no hay foto (Â«Falta la FOTO del convenio FIRMADOâ€¦Â») y si el consentimiento fue
  revocado, con mensajes que dicen quÃ© hacer.
- `setConsentimiento` se volviÃ³ una actualizaciÃ³n **por partes** (`impreso` / `documento` / `aceptado` / `notas`):
  antes era un upsert que pisaba `metodo` y `notas` en cada llamada, asÃ­ que marcar Â«impresoÂ» borraba lo demÃ¡s â€”y
  un PUT sin `aceptado` lo ponÃ­a en `false` (`!!undefined`)â€”. Otorgar sin foto se rechaza; **revocar siempre se
  puede** (es derecho del trabajador) y al revocar se bloquea el enrolamiento, conservando el convenio como
  constancia de lo que se firmÃ³.
- `pages/nomina/ConsentimientoFirmado.tsx`: los 3 pasos numerados con su palomita, en la pantalla de Enrolar y en
  Checador â†’ Empleados. Dos formas de tomar la foto: con la cÃ¡mara ya abierta (laptop, sosteniendo la hoja) y con
  `capture="environment"`, que en celular/tableta abre la cÃ¡mara **trasera** â€”la buena para un papelâ€”. La imagen se
  reduce a 1600 px y ~1.4 MB en el navegador; el backend rechaza arriba de ~2 MB.
- El botÃ³n de captura apagado ahora **dice por quÃ©** lo estÃ¡ (heurÃ­stica #1 de Nielsen).
- `components/AvisoCarga.tsx`: un solo componente para Â«no se pudo cargar XÂ» + Reintentar, usado en ConfiguraciÃ³n,
  Kioscos y Registro (del dÃ­a e historial). Las tablas enseÃ±aban Â«AÃºn no hay kioscosÂ» / Â«Sin registrosÂ» cuando lo
  que pasaba era que el servidor no contestaba: **afirmar que no hay datos cuando no se sabe**. El error va antes
  del vacÃ­o.
- Las 3 opciones de cÃ¡mara pasan a **verde fuerte relleno** (`claseOpcionCamara`, green-700) para distinguirlas de
  las pestaÃ±as de configuraciÃ³n; con eso el rÃ³tulo Â«Abrir cÃ¡mara:Â» saliÃ³ sobrando. Se quitÃ³ el engrane redundante
  de Kiosco, Campo, Enrolar y Registro (todos iban al mismo `/checador` que Salir/Regresar).
- **ConfiguraciÃ³n saliÃ³ de la fila de pastillas** (commit `a39dea2`): no es trabajo del dÃ­a a dÃ­a â€”se ajusta una
  vez y se olvidaâ€”, asÃ­ que no debe competir con las pestaÃ±as que sÃ­ se usan a diario. Va como **engrane sin
  apariencia de botÃ³n** (ni relleno ni borde; el fondo sÃ³lo asoma al pasar el cursor) a la **derecha** de la barra,
  que es donde se busca un engrane. Sigue siendo `role="tab"`, asÃ­ que su estado activo se ve con azul **+
  subrayado + fondo tenue**: color solo no basta (WCAG 1.4.1).
- Contrastes medidos, no supuestos: green-600 con texto blanco de 14 px da **3.3:1** y NO pasa AA; green-700 da
  5.0:1. Igual emerald-600 (3.8:1) â†’ emerald-700 (5.5:1) en los botones, y emerald-500 â†’ emerald-600 en la
  palomita de cada paso (3:1 para objetos grÃ¡ficos).

**LÃ­mite conocido.** Sin verificar en ejecuciÃ³n (login) y el frontend no tiene corredor de pruebas: sÃ³lo `tsc` de
backend y frontend + build de producciÃ³n. **Falta probarlo en la tableta real.** Consecuencia a tener presente: a
quien ya tenÃ­a `aceptado = true` por la palomita vieja **no se le podrÃ¡ re-enrolar** hasta subir la foto de su
convenio firmado; los rostros YA enrolados siguen checando normal (la identificaciÃ³n no se tocÃ³). El despliegue va
**primero backend y luego frontend**: con el backend viejo, un PUT sin `aceptado` apagarÃ­a el consentimiento.

---

## 14. Estado de cuenta de Stripe: cifras invisibles y comisiÃ³n sin IVA desglosado

**SÃ­ntoma.** Al cargar el estado de cuenta de Stripe (cobrador de pagos) no salÃ­a ningÃºn movimiento y el
documento parecÃ­a ilegible, aunque abierto en un visor se ve perfecto. Y la **comisiÃ³n** â€”que Stripe cobra
con IVA incluido y descuenta del depÃ³sitoâ€” no aparecÃ­a en ninguna parte: se quedaba dentro del neto, asÃ­
que ni el gasto ni el IVA acreditable existÃ­an para la contabilidad.

**CÃ³mo diagnosticar.** Volcar el texto del PDF e imprimir los **cÃ³digos de carÃ¡cter**, no el texto:
`[...linea].map(c => c.charCodeAt(0))`. Si salen valores de **57344 a 63743** (U+E000â€“U+F8FF), el PDF
escribe con una fuente cuyo subconjunto de glifos no trae mapa a Unicode.

**Causa raÃ­z.** DOS cosas distintas:
- El PDF de Stripe escribe la tabla con una fuente **sin `ToUnicode`**: cada cifra llega como un carÃ¡cter
  del **Ã¡rea de uso privado**. La fecha Â«2026-10-01Â» llegaba como `2026Â·10Â·01` con los guiones en U+E088
  (506 glifos en el estado de octubre), y las cifras de los importes llegaban enteras en esa Ã¡rea â€” por eso
  sÃ³lo se veÃ­an los Â«$Â» sueltos. El renglÃ³n no empataba con ningÃºn patrÃ³n y **el detalle se perdÃ­a en
  silencio**: nada avisaba. Los **saldos y los totales** sÃ­ se leen, porque van en la fuente normal.
- Stripe no es un banco y no se habÃ­a modelado: no tenÃ­a lector propio, asÃ­ que caÃ­a en el genÃ©rico.

**âŒ Lo que NO hay que hacer.** Deducir quÃ© dÃ­gito es cada glifo de uso privado: el orden del subconjunto
depende de cÃ³mo se generÃ³ el PDF, y **una cifra adivinada en contabilidad es peor que una cifra ausente**.
Tampoco meter movimientos en cero para Â«no dejarlo vacÃ­oÂ»: eso ensucia la cuenta y descuadra el arrastre.

**âœ… SoluciÃ³n (commit `679ea08`).**
- `limpiarPua()` quita los caracteres U+E000â€“U+F8FF y los **cuenta**. Con eso la fecha vuelve a ser legible
  (Â«20261001Â») y el concepto y el tipo tambiÃ©n; las cifras no se recuperan y **se avisa cuÃ¡ntos renglones
  se perdieron y quÃ© hacer** (pegar el texto, o subir el CSV de Â«balance transactionsÂ» del portal).
- `extraerStripe()`, lector propio, con la regla que dio el usuario: lo que hay que **controlar** son el
  **saldo inicial y el final** y la **comisiÃ³n con su IVA**; la cobranza se cuadra por el lado del CFDI en
  la conciliaciÃ³n bancaria. Los payouts vienen en **negativo** (salen a otro banco) y los cobros en
  positivo; cuando el signo estÃ¡ manda el signo, cuando no manda el TIPO.
- Un **cobro entra al saldo por su NETO**, no por el bruto: la comisiÃ³n nunca llegÃ³ a la cuenta. AsÃ­ cuadra
  el arrastre *y* la comisiÃ³n queda como gasto aparte.
- **IVA de la comisiÃ³n**: base = `total / 1.16`, IVA = la diferencia. Se guarda por mes en
  `bancos_estados_cuenta.comision_{total,base,iva}` (migraciÃ³n `2026-11-23b`) y se muestra al cargar. El
  desglose es **papel de trabajo**: para acreditar el IVA hace falta el CFDI que emite el cobrador.
- **Dos cuadres**: con movimientos legibles se valida el arrastre; sin ellos, la identidad del resumen
  (`inicial + actividad neta âˆ’ pagos a banco = final`), que es justo lo que se pidiÃ³ controlar.
- La detecciÃ³n exige **dos marcas** (Â«Estado de Cuenta StripeÂ», o Â«StripeÂ» + comisiones/payout): la palabra
  Â«StripeÂ» sola aparece como contraparte de un SPEI en cualquier estado bancario.

**Probado.** 17 pruebas (`extractor-stripe.test.ts`), incluidas las de los glifos de uso privado, y una
corrida de punta a punta contra el PDF real de octubre 2026: detecta Stripe, saca 62,241.30 â†’ 15,215.86,
desglosa 2,913.15 = 2,511.34 + 401.81 y cuadra.

**LÃ­mite conocido.** Del PDF con la fuente rota **no se recupera el detalle**: quedan saldos y comisiÃ³n (y
los 27 renglones contados en el aviso). Para el movimiento por movimiento hace falta el CSV de Stripe, el
texto pegado, o encender `ENABLE_OCR` en el servidor.

---

## 15. Documentos que se abrÃ­an en una pestaÃ±a y no quedaban en Â«DescargasÂ»

**SÃ­ntoma.** Varios documentos que genera NEXO se veÃ­an pero no se guardaban: la opiniÃ³n de cumplimiento,
el documento legal de la baja, los acuses y declaraciones del SAT, la remesa y el complemento de pago se
abrÃ­an en una pestaÃ±a y, al cerrarla, habÃ­a que volver a generarlos para archivarlos. Otros Â«descargabanÂ»
pero el archivo a veces no aparecÃ­a.

**Causa raÃ­z.** Dos patrones:
- `window.open(URL.createObjectURL(blob))`: eso **muestra** el documento, no lo guarda. Y si el navegador
  bloquea las ventanas emergentes, el botÃ³n parece no hacer nada.
- Descargas hechas a mano: `a.click()` **sin meter el enlace al documento** y con
  `URL.revokeObjectURL()` inmediatamente despuÃ©s. Firefox exige que el `<a>` estÃ© en el DOM â€”si no, no
  descarga nadaâ€” y liberar el blob en el mismo instante puede abortar el archivo a medias. Ya existÃ­a
  `api.downloadFile`, que hace las dos cosas bien, pero diez sitios no lo usaban.

**âœ… SoluciÃ³n (commit `679ea08`).** `api.verYDescargar(blob, nombre, ver)`: **siempre descarga** y ademÃ¡s
abre la pestaÃ±a cuando la acciÃ³n es Â«verÂ», asÃ­ el archivo existe aunque la ventana se bloquee. Se barrieron
los sitios que abrÃ­an documentos (opiniÃ³n, documento de baja, acuse IDSE, remesa, complemento de pago,
declaraciones y notificaciones del SAT) y los que descargaban a mano (notas de crÃ©dito PDF/XML, XML del
complemento, DIOT, nÃ³mina PF, diferencia cambiaria, asistencia, manifiesto, documentos legales, ZIP de
declaraciones, registro de asistencia) para que todos pasen por `downloadFile`.

**Lo que NO se tocÃ³.** Las ventanas de **impresiÃ³n** (ticket del POS, remesa en hoja, pÃ³lizas, convenio
biomÃ©trico): ahÃ­ abrir una ventana es el objetivo, no hay archivo que guardar.

**LÃ­mite conocido.** La **carpeta** la decide el navegador: ningÃºn sitio web puede elegirla. Es Â«DescargasÂ»
salvo que el usuario la haya cambiado o tenga activado Â«Preguntar dÃ³nde guardar cada archivoÂ» â€” eso se
configura en cada equipo, no desde NEXO.

---

<!-- Plantilla para una entrada nueva:
## N. <sÃ­ntoma corto>
**SÃ­ntoma.** â€¦
**CÃ³mo diagnosticar.** â€¦
**Causa raÃ­z.** â€¦
**âŒ Lo que NO hay que hacer.** â€¦
**âœ… SoluciÃ³n (commit `xxxxxxx`).** â€¦
**LÃ­mite conocido.** â€¦
-->

