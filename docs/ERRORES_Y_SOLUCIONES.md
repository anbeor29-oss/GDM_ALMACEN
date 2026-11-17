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

<!-- Plantilla para una entrada nueva:
## N. <síntoma corto>
**Síntoma.** …
**Cómo diagnosticar.** …
**Causa raíz.** …
**❌ Lo que NO hay que hacer.** …
**✅ Solución (commit `xxxxxxx`).** …
**Límite conocido.** …
-->
