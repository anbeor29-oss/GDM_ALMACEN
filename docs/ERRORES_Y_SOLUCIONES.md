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

**CONFIRMADO funcionando (2026-11-17).** Con el fix desplegado se verificó en vivo:
- `GET /health`: **uptime de 10 h sin reiniciarse** en `eaa3dba` → ya no hay crash-loop.
- **Preflight CORS** del POST desde `https://hcgm.com.mx`: permitido.
- La ruta `GET /contalink/importar/:jobId` existe (401 sin token = registrada).
- El **bundle del frontend en vivo** trae el código nuevo (`contalink/importar`, `esperarImportacion`).
Por tanto un «Network Error» posterior es de ANTES del despliegue (crash-loop) o un **caché viejo
del navegador** → **hard refresh (Ctrl+F5)** y re-probar.

**Sobre el archivo GIGANTE — NO es OOM (supuesto corregido 2026-11-17).** Medido: 768 KB añade
~15 MB al parsear; **8 MB ≈ 150 MB**, muy por debajo de los 512 MB. Con las 10 h sin caerse, el
`.xls` grande **NO revienta la RAM ni tumba el proceso**: entra, sólo tarda minutos en el bucle de
BD (la barra de avance se mueve). Si algún libro fuera REALMENTE enorme, exportarlo **por AÑO**
(idempotente, aditivo) — **no** hace falta un importador por lotes.

**Verificado (parser).** Con el archivo real del usuario (768 KB): **598 pólizas, 3 412 movimientos,
223 CFDI en 107 ms, 0 descuadres**.

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
