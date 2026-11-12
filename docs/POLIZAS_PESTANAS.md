# Pólizas en pestañas — hub de contabilización (GDM NEXO)

> Referencia de la pantalla **Contabilidad → Pólizas** reconstruida como un hub de
> pestañas (2026-11-11). Una pestaña por tipo de movimiento, para ver y contabilizar
> cada cosa en su lugar. No duplica motor: reutiliza la vista de comprobantes, el
> modal de asiento y la pantalla consolidada de siempre.

## 1. Estructura

Ruta `contabilidad/polizas` → `PolizasHub.tsx` (reemplazó a `PolizasListaPage` como
entrada; ésta quedó como la pestaña **Libro diario**). Pestañas estilo hoja de
Excel (verde claro / azul, `claseOpcion`):

| Pestaña | Componente | Qué hace |
|---|---|---|
| **Ventas** | `DocsContabilizar modo="ventas"` | Facturas emitidas (devengo del ingreso). |
| **Compras** | `DocsContabilizar modo="compras"` | Facturas recibidas (devengo gasto/activo + IVA). |
| **Pagos de ventas** | `PagosContabilizar modo="cobros"` | Cobro que cancela la cuenta por cobrar. |
| **Pago de compras** | `PagosContabilizar modo="pagos"` | Pago que cancela el pasivo. |
| **Depreciaciones** | `DeprecPanel` | Corrida mensual de depreciación (sin cambios). |
| **Nómina** | `NominaPanel` → `NominaEmitida` / `NominaRecibida` | Dos subpestañas (ver §5). |
| **Libro diario** | `PolizasListaPage` | Todas las pólizas como hoja (ver §6). |

### Acomodo común de las pestañas de documentos
`Fecha · Folio · Nombre (cliente/proveedor) · Cuenta · [2ª cuenta donde aplique] ·
Subtotal · IVA · Total · 👁 (ver póliza) · estado`. **Sin UUID** en todas; **sin RFC**
en las de pago. Sumatorias al final. Ícono de estado diseñado a juego con los de
comprobantes (documento): sello verde = **codificada**, puntos ámbar = **pendiente**
(`IconoCodificada` / `IconoPendiente`, exportados de `DocsContabilizar`).

El **ojo** abre la póliza (reutiliza `AsientoModal` de `TablaComprobantesSat`).
El botón **«Generar pólizas / Contabilizar»** está SIEMPRE activo (aunque no haya
pendientes) y las pestañas **auto-contabilizan al abrir el periodo** (toggle
«automático»); el motor es idempotente, así que re-correr no duplica.

## 2. De dónde salen las columnas y el estado (backend)

`listarComprobantesVista` (`sat-descarga/descarga.service`) ahora devuelve también
`subtotal`, `descuento`, `cuenta_contable`, `cuenta_contable_2` y **`contabilizado`**
(predicado único `cfdiYaContabilizado('c')`, las 3 vías). El **IVA** de cada renglón se
deriva en el front: `total − (subtotal − descuento)`.

## 3. Asientos por pestaña

Las cuentas **fijas** salen de **Asignaciones del catálogo** (por agrupador); las
**variables** se capturan en combos que despliegan el catálogo. Si una cuenta variable
no se conoce, la factura queda **pendiente** (no se asienta nada incorrecto).

### Ventas (devengo) — `ventas_cfdi_v2`
`generarVentasDelMes`. Combo = cuenta del **cliente** (agrupador 105).
- Cargo **Cliente** (total) — la cuenta capturada (`cuenta_contable`) MANDA; si no, se
  resuelve por RFC (`resolverOCrearSubcuentaTercero`).
- Abono **Ingreso** (producto→401, o cuenta única de ventas).
- Abono **IVA trasladado** — PUE→208.01, PPD→209.01 (no se cambió esta regla).

### Compras (devengo) — `compras_cfdi_v1`
`generarComprasDelMes`. Dos combos: **Cuenta = proveedor** (201/205, `cuenta_contable`)
y **2ª cuenta = gasto/compra/activo/costo** (`cuenta_contable_2`, columna nueva).
- Cargo **Gasto/Compra/Activo** (subtotal). Si se captura la 2ª cuenta, TODA la factura
  va a ESA cuenta (como cuenta única por factura); si no, el motor parte por producto
  (115/601) y, si falta la cuenta del producto, queda pendiente.
- Cargo **IVA por acreditar** (119.01).
- Abono **Proveedor** (total) — la cuenta capturada manda; si no, por RFC.

### Pagos de ventas (cobro) — `cobro_cfdi_v1` + `cobro_pue_v1`
`generarCobrosPagosDelMes(dir='cobros')` procesa los **REP emitidos**; `generarCobroPue`
(+ `generarCobrosPueDelMes`) genera el cobro de las ventas **PUE** que tienen venta pero
aún no cobro (p. ej. migradas). La pestaña corre AMBOS.
- Cargo **Banco** (102.01, de Asignaciones) (total).
- Abono **Cliente** (total).
- Reclasificación del IVA: Cargo **209.01 «IVA por pagar»** / Abono **208.01 «IVA pagado»**.
- Idempotente por `COBROPUE:uuid`. **Ojo:** para que el abono caiga en la MISMA cuenta
  de cliente que la venta, conviene capturarla en el combo de Ventas.

### Pago de compras (pago) — `pago_cfdi_v1` + `pago_pue_v1`
`generarCobrosPagosDelMes(dir='pagos')` (REP recibidos) + `generarPagoPue` (compras PUE,
auto al Generar Compras).
- Cargo **Proveedor** (total).
- Abono **Banco** (102.01) (total).
- Cargo **118.01 «IVA acreditable»** / Abono **119.01 «IVA por acreditar»**.

## 4. Depreciaciones
Sin cambios. Botón que corre `generarDepreciacion(anio, mes)` (línea recta LISR 33-35:
gasto 701/702, acumulada 171/183). Idempotente.

## 5. Nómina (dos subpestañas)

- **Emitida** (`NominaEmitida`): BAJA a contabilidad las pólizas que ya genera el
  **módulo de Nómina** — corridas ordinarias (`periodosOrdinarios`/`generarPolizaPeriodo`:
  percepciones→601, subsidio→110, deducciones→216/205, neto→210, `origen='NOMINA'`) y
  finiquitos timbrados por recibo. Botón «Bajar» por corrida/finiquito y «Bajar pendientes».
- **Recibida** (`NominaRecibida`): la nómina/asimilados que **te pagan** (CFDI **tipo N**
  recibidos). Backend en `sat-descarga/nomina-pf.service`:
  `nominaRecibidaContabilizable` (lista + estado) y `generarPolizaNominaRecibida` (+ bulk),
  reusando el parser del complemento nómina 1.2. **Asiento:**
  - Cargo **Banco** (102.01) (neto).
  - Cargo **ISR retenido a favor** (agrupador 113) + otras retenciones si hay.
  - Abono **Ingreso por nómina** (700/401 según clase sueldos/asimilados).
  - Idempotente por `NOMREC:uuid`. Cuentas de Asignaciones; **pendiente con motivo** si
    faltan (ingreso o ISR a favor) — no asienta nada incorrecto.
  - **Por confirmar con el usuario:** los agrupadores exactos de «ingreso por nómina» e
    «ISR a favor» (hoy 700/401 y 113 como candidatos).

Control de **mes/año** compartido por las dos subpestañas.

## 6. Libro diario (paso 7, provisional)
`PolizasListaPage` ahora muestra las pólizas como **HOJA**: tabla plana, un renglón por
póliza, **ordenada por fecha + folio** (`Fecha · Folio · Tipo · Concepto · Importe ·
acciones`). El detalle de partidas se ve con el ojo. Conserva el motor, el editor, el
diagnóstico de cuadre y «Descontabilizar mes». **El formato fino (p. ej. un renglón por
movimiento) queda por definir con el usuario.**

## 7. Automatizaciones

- **Timbrado NEXO → contabilidad** (YA EXISTÍA, confirmado): `pac.service.postTimbradoEmitido`
  (llamado en los 3 puntos de timbrado) indexa el CFDI timbrado a la bóveda y dispara su
  póliza por `soloUuid` (I→`generarVentasDelMes`, P→`generarCobrosPagosDelMes`),
  fire-and-forget e idempotente.
- **Descarga SAT → contabilidad**: NO es server-side (la descarga es la «red de seguridad»).
  Lo cubre la **auto-contabilización de las pestañas al abrirlas**. Un hook server-side
  post-descarga queda **opcional** (riesgoso por volumen; no se hizo).

## 8. Modelo de datos nuevo
- `cfdi_recibidos.cuenta_contable_2` (migración `2026-11-11_cfdi_cuenta_contable_2.sql`):
  la 2ª cuenta (gasto/activo) de Compras. `cuenta_contable` guarda la del proveedor/cliente.
- `origen_uuid` especiales: `COBROPUE:<uuid>` (cobro de venta), `PAGOPUE:<uuid>` (pago de
  compra), `NOMREC:<uuid>` (nómina recibida), `NOMINA-PERIODO:<id>` (corrida de nómina).

## 9. Endpoints / API nuevos
- `PUT /sat-descarga/comprobantes/:id/cuenta` (acepta `cuenta2`) y `.../cuenta2`.
- `POST /accounting/polizas/generar-cobros-pue`.
- `GET /sat-descarga/pf/nomina-contabilizable`, `POST /sat-descarga/pf/nomina/:uuid/contabilizar`,
  `POST /sat-descarga/pf/nomina-contabilizar`.
- API front: `setSatCuentaContable2`, `generarCobrosPue`, `getNominaRecibidaContabilizable`,
  `contabilizarNominaRecibida`, `contabilizarNominaRecibidaMes`.

## 10. Pendientes
- Confirmar con el usuario los **agrupadores** de nómina recibida (ingreso / ISR a favor).
- **Formato final del Libro diario** (hoja): ¿un renglón por póliza (hoy) o por movimiento?
- **Hook server-side** post-descarga SAT (opcional).
- Las pestañas auto-contabilizan por periodo; falta un «contabilizar un solo renglón» si se
  quiere granularidad por factura (hoy es por lote del mes, idempotente).
