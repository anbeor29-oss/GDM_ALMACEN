# Motores de contabilidad — GDM NEXO

Inventario de los "motores" (servicios) del módulo contable y de lo que hace cada uno.
Ruta: `backend/src/modules/accounting/` salvo donde se indique. Actualizado 2026-09-08.

## 1. Catálogo y terceros
- **catalogo.service** — El catálogo de cuentas: siembra con el Anexo 24, alta/edición
  (número, nombre, moneda, agrupador), árbol, borrar/tombstone, `asignarAgrupadorFaltante`
  (hereda del padre), `proponerAgrupadoresDelCatalogo`/`aplicarAgrupadoresPropuestos`
  (por nombre vs Anexo 24, a confirmar), **importar/exportar Excel del catálogo**,
  `revisarCatalogo` (errores de estructura).
- **catalogo-terceros.service** — Subcuentas de cliente/proveedor (terceros):
  `resolverOCrearSubcuentaTercero`, `cuentaControl` (105.01/201.01 o su padre 105/201),
  numeración `1-10-25-0XX`, `generarSubcuentasDeComprobantes`. Respeta el número del
  respaldo; rellena agrupador en vez de renumerar.
- **mapeador-sat.service** — Empata un catálogo AJENO con el Anexo 24 **por nombre +
  herencia del padre**, con grado de confianza (`proponerMapeo`). Lo usan "Proponer
  agrupador" y el análisis de respaldo.

## 2. Pólizas (el libro diario)
- **polizas.service** — Motor de pólizas (journal): listar, póliza manual, **editar**,
  borrar, y **generar** ventas/compras/cobros-pagos del mes. El **cuadre lo garantiza un
  trigger de BD** (`poliza_cuadra`, DEFERRABLE): no se guarda una póliza descuadrada.
- **ventas-cuentas.service** / **compras-cuentas.service** — Asignación de cuenta por
  producto/clave SAT y armado de las pólizas de venta/compra (ventas→401, compras→115/601,
  IVA 119.01/208/209).
- **activos-fijos.service** — Activo fijo y depreciación (línea recta, LISR 33-35), póliza
  mensual idempotente (gasto 701/702, acumulada 171/183).

## 3. Periodos, balanza y estados
- **periodos.service** — Ejercicios y periodos: activar (12 meses), `contextoDelPeriodo`,
  `balanzaDelPeriodo`, `auxiliarDeCuenta`, **`alimentarDesdeBalanza`** (carga la balanza del
  respaldo → saldos iniciales/apertura), **`alimentarDesdePolizas`** (deriva la balanza del
  mes desde las pólizas, **arrastrando** las cuentas sin movimiento), cerrar/reabrir.
- **estados-financieros.service** — Estados NIF a partir de los saldos ya agrupados:
  situación financiera (B-6), resultado integral (B-3), **flujo de efectivo** (B-2,
  indirecto), cambios en el capital (B-4), razones, análisis horizontal, `juegoCompleto`.
- **balanza-lector.service** — Lee una balanza EXTERNA (Excel/PDF), marca hojas y analiza
  el cuadre (paso previo a cargar apertura).

## 4. Diagnóstico y mantenimiento
- **validacion-contable.service** — **Cuadre contable**: valida póliza por póliza
  (cargos=abonos), la balanza, el balance ↔ estado de resultados, y el **localizador** de
  descuadre (secciones + cuentas fuera de rubro). Exporta `enRubro`/`seccionDe`.
- **reportes-especiales.service** — **Balanza especial** y **situación especial**:
  agrupadas por dígito agrupador del SAT y por cuenta, con "fuera de rubro", para hallar el
  error.
- **nif-motor.service** + **nif-reglas.data** — Motor de **reglas NIF** (C-3 estimación de
  incobrables, C-4 inventarios, C-6 depreciación, A-5 ecuación contable, B-6 sin clasificar,
  etc.): evalúa una balanza y devuelve hallazgos (cumple/no cumple/revisar).
- **cambio-cuenta.service** — Reasignar partidas (MIG-TEMPORAL → cuenta real, por rango de
  fechas), **fusionar** cuentas (mueve partidas, reengancha hijos, borra la origen),
  `candidatasDuplicadas`, `auxiliarDeCuentaRango`, `partidasDeCuenta`.

## 5. Importación y reportes
- **contpaqi-import.service** — Importa el **respaldo CONTPAQi** (catálogo, pólizas,
  terceros, CFDI); **exige e.firma** (salvo "sólo catálogo"); al terminar dispara la
  descarga masiva de XML del SAT.
- **contpaqi-txt.service** — Importa los **TXT de ancho fijo de CONTPAQi** (latin1): el
  **catálogo** (crea cuentas ligando por el padre explícito, naturaleza por la letra y
  agrupador SAT validado contra el Anexo 24) y las **pólizas** (mapea por código, idempotente
  por UUID, cuadra por el trigger de BD). Camino de arranque cuando NO se tiene el respaldo
  completo. Importa DE `catalogo.service`, nunca al revés.
- **reportes-export.service** — **Excel y PDF** de balanza, auxiliar, situación, resultados,
  flujo, capital, razones, el **reporte anual** (12 columnas) y el **catálogo**.

## 6. Relacionados (otros módulos)
- **treasury/conciliacion-contable.service** — Conciliación **banco ↔ contabilidad**:
  sugerir por importe/fecha, cotejar contra la 102 asentada, contabilizar/descontabilizar.
- **sat-descarga/** — Descarga masiva de XML del SAT: credencial e.firma (bóveda cifrada),
  trabajos, calendario de cobertura. (Enciende con `ENABLE_SAT_DESCARGA_CRON=true`.)
- **nomina/nomina-import.service** — Importa la nómina del respaldo NomiPaq y arma su
  contabilización.

---
*Cómo se conectan:* respaldo → catálogo + terceros + pólizas → `alimentarDesdePolizas`
deriva la balanza del periodo → `estados-financieros` arma los estados → `validacion` y
`reportes-especiales` diagnostican → `cambio-cuenta` corrige → `reportes-export` entrega.
