# Complemento de Pago 2.0 — las tres formas del nodo de impuestos

Cómo se arma el JSON que va a SW Sapien (`/v3/cfdi33/issue/json/v4`) según los
impuestos de la factura que se está pagando. La estructura del comprobante es
idéntica en los tres casos; **lo único que cambia es `ObjetoImpDR`, el nodo
`ImpuestosDR`/`ImpuestosP` y los campos de `Totales`.**

## La envoltura, que es igual siempre

```json
"Complemento": { "Any": [ { "pago20:Pagos": { "Version": "2.0", ... } } ] }
```

Dos detalles que no se deducen de la documentación pública del SAT, porque son
del convertidor de SW:

- el arreglo intermedio se llama **`Any`** — se traduce a `<cfdi:Complemento>`
  con hijos arbitrarios, igual que el `xs:any` del XSD;
- la llave del complemento va **con el prefijo del namespace**: `pago20:Pagos`,
  no `Pagos` a secas.

Sin el prefijo, SW no identifica el complemento y **lo descarta en silencio**: el
comprobante sale tipo `P` sin complemento, SW responde 200 y el rechazo llega del
SAT como `CFDI140230`. Es un error engañoso, porque parece que el complemento no
se envió cuando en realidad se envió mal nombrado.

El comprobante que lo envuelve, en los tres casos:

| Campo | Valor | Por qué |
|---|---|---|
| `TipoDeComprobante` | `P` | |
| `Moneda` | `XXX` | En un tipo P los importes viven en el complemento, no en el comprobante |
| `SubTotal` / `Total` | `"0"` | Misma razón |
| `Exportacion` | `01` | No es exportación |
| `ClaveProdServ` | `84111506` | Clave fija del SAT para "pago" |
| `ClaveUnidad` | `ACT` | Idem |
| `ObjetoImp` (concepto) | `01` | El **concepto** nunca es objeto de impuesto, aunque el documento relacionado sí lo sea |
| `UsoCFDI` | `CP01` | Único válido para tipo P |

No lleva `FormaPago` ni `MetodoPago` ni nodo `Impuestos`.

### La fecha

`Fecha` es la de **emisión**, en hora del lugar de expedición
(`America/Mexico_City`), nunca UTC — el SAT sólo acepta una ventana de 72 horas
hacia atrás y unos minutos hacia adelante. `FechaPago`, dentro del complemento,
es cuándo pagó el cliente y **sí** puede ser pasada. Son campos distintos; usar
la misma fecha para los dos produce comprobantes con fecha vieja.

Se formatean con `fmtFechaSAT()` de `backend/src/modules/cfdi/build-cfdi-json.service.ts`.

---

## Caso A — traslado de IVA 16% (lo que emitimos hoy)

Factura normal con IVA trasladado. El monto cobrado **viene con IVA incluido**, así
que hay que despejar la base.

```json
"pago20:Pagos": {
  "Version": "2.0",
  "Totales": {
    "MontoTotalPagos": "116.00",
    "TotalTrasladosBaseIVA16": "100.00",
    "TotalTrasladosImpuestoIVA16": "16.00"
  },
  "Pago": [{
    "FechaPago": "2026-07-29T12:00:00",
    "FormaDePagoP": "03",
    "MonedaP": "MXN",
    "TipoCambioP": "1",
    "Monto": "116.00",
    "DoctoRelacionado": [{
      "IdDocumento": "daca5d85-b8cd-463b-a056-b021fe33c2f9",
      "Serie": "B", "Folio": "2",
      "MonedaDR": "MXN",
      "MetodoDePagoDR": "PPD",
      "NumParcialidad": "1",
      "ImpSaldoAnt": "1624.00",
      "ImpPagado": "116.00",
      "ImpSaldoInsoluto": "1508.00",
      "EquivalenciaDR": "1",
      "ObjetoImpDR": "02",
      "ImpuestosDR": {
        "TrasladosDR": [{
          "BaseDR": "100.00", "ImpuestoDR": "002",
          "TipoFactorDR": "Tasa", "TasaOCuotaDR": "0.160000",
          "ImporteDR": "16.00"
        }]
      }
    }],
    "ImpuestosP": {
      "TrasladosP": [{
        "BaseP": "100.00", "ImpuestoP": "002",
        "TipoFactorP": "Tasa", "TasaOCuotaP": "0.160000",
        "ImporteP": "16.00"
      }]
    }
  }]
}
```

**El redondeo importa.** El SAT valida `BaseDR × 0.16 == ImporteDR` a dos
decimales. Hay que calcular el impuesto **sobre la base ya redondeada**:

```js
const baseIVA = Math.round((montoPago / 1.16) * 100) / 100;
const ivaPago = Math.round(baseIVA * 0.16 * 100) / 100;
```

Calcularlo sobre la base sin redondear desajusta un centavo en muchos montos y el
comprobante se rechaza.

---

## Caso B — sin impuestos

Factura exenta o no objeto de impuesto. `ObjetoImpDR` es `01` y **no va ningún
nodo de impuestos** — ni `ImpuestosDR` ni `ImpuestosP`. `Totales` lleva sólo
`MontoTotalPagos`.

```json
"pago20:Pagos": {
  "Version": "2.0",
  "Totales": { "MontoTotalPagos": "1.00" },
  "Pago": [{
    "FechaPago": "2026-07-29T00:00:00",
    "FormaDePagoP": "03",
    "MonedaP": "MXN",
    "TipoCambioP": "1",
    "Monto": "1.00",
    "DoctoRelacionado": [{
      "IdDocumento": "daca5d85-b8cd-463b-a056-b021fe33c2f9",
      "Serie": "SW N8N Examples", "Folio": "087",
      "MonedaDR": "MXN",
      "MetodoDePagoDR": "PUE",
      "NumParcialidad": "1",
      "ImpSaldoAnt": "500.00",
      "ImpPagado": "1.00",
      "ImpSaldoInsoluto": "499.00",
      "EquivalenciaDR": "1",
      "ObjetoImpDR": "01"
    }]
  }]
}
```

Poner `ObjetoImpDR: "01"` **y** un nodo `ImpuestosDR` es inválido: se contradicen.
Ese era el defecto que traíamos antes de corregir el caso A.

---

## Caso C — puras retenciones

Servicios donde el cliente retiene el impuesto y no hay traslado: honorarios con
IVA retenido, arrendamiento, fletes con retención. El pago que **entra a caja es
el neto**, ya descontada la retención, pero el complemento declara la **base
completa**.

```json
"pago20:Pagos": {
  "Version": "2.0",
  "Totales": {
    "MontoTotalPagos": "100.00",
    "TotalRetencionesIVA": "10.67"
  },
  "Pago": [{
    "FechaPago": "2026-07-29T12:00:00",
    "FormaDePagoP": "03",
    "MonedaP": "MXN",
    "TipoCambioP": "1",
    "Monto": "100.00",
    "DoctoRelacionado": [{
      "IdDocumento": "daca5d85-b8cd-463b-a056-b021fe33c2f9",
      "Serie": "B", "Folio": "3",
      "MonedaDR": "MXN",
      "MetodoDePagoDR": "PPD",
      "NumParcialidad": "1",
      "ImpSaldoAnt": "300.00",
      "ImpPagado": "100.00",
      "ImpSaldoInsoluto": "200.00",
      "EquivalenciaDR": "1",
      "ObjetoImpDR": "02",
      "ImpuestosDR": {
        "RetencionesDR": [{
          "BaseDR": "100.00",
          "ImpuestoDR": "002",
          "TipoFactorDR": "Tasa",
          "TasaOCuotaDR": "0.106667",
          "ImporteDR": "10.67"
        }]
      }
    }],
    "ImpuestosP": {
      "RetencionesP": [{
        "ImpuestoP": "002",
        "ImporteP": "10.67"
      }]
    }
  }]
}
```

Puntos que distinguen este caso:

- `ObjetoImpDR` es **`02`** (sí objeto de impuesto), como en el caso A. Sólo el
  caso B usa `01`.
- El nodo es **`RetencionesDR`**, sin `TrasladosDR`.
- **`RetencionesP` sólo lleva `ImpuestoP` e `ImporteP`.** No lleva `BaseP`,
  `TipoFactorP` ni `TasaOCuotaP` — a diferencia de `TrasladosP`, que sí los pide.
  Es una asimetría del esquema, no un descuido.
- En `Totales` va `TotalRetencionesIVA` (o `TotalRetencionesISR` /
  `TotalRetencionesIEPS`). **Estos campos no tienen contraparte de base**: no
  existe `TotalRetencionesBaseIVA`, sólo el importe.
- `Monto` y `ImpPagado` son la **base**, no el neto depositado. Si el cliente
  depositó $89.33 tras retener $10.67, el complemento sigue diciendo `100.00`.

### Claves de impuesto

| Clave | Impuesto |
|---|---|
| `001` | ISR |
| `002` | IVA |
| `003` | IEPS |

### Tasas de retención usuales

| Supuesto | Impuesto | Tasa |
|---|---|---|
| IVA retenido a persona física por servicios profesionales | `002` | `0.106667` (dos terceras partes del 16%) |
| ISR retenido por servicios profesionales | `001` | `0.100000` |
| IVA retenido en autotransporte terrestre de carga | `002` | `0.040000` |
| ISR retenido por arrendamiento | `001` | `0.100000` |

La tasa se escribe con **seis decimales**. `0.106667` es la retención de dos
terceras partes del IVA; ponerla como `0.106700` o `0.11` hace que la validación
`BaseDR × TasaOCuotaDR == ImporteDR` no cuadre.

---

## Puede haber traslados y retenciones a la vez

Los casos A y C no son excluyentes: una misma factura puede trasladar IVA 16% y
tener IVA retenido. En ese caso `ImpuestosDR` lleva **los dos arreglos**,
`TrasladosDR` y `RetencionesDR`, y `Totales` lleva tanto
`TotalTrasladosBaseIVA16`/`TotalTrasladosImpuestoIVA16` como
`TotalRetencionesIVA`.

## Estado actual del código

`backend/src/modules/payments/payments.service.ts` implementa **sólo el caso A**,
con la tasa 16% fija, porque así son todas nuestras facturas hoy. Para cubrir B y
C hay que leer los impuestos reales de los conceptos de la factura y elegir la
forma correspondiente. No está hecho: es un cambio de comportamiento que conviene
meter cuando aparezca la primera factura que lo necesite, no antes.

---

## Caso D — pago al RFC genérico (público en general)

Cuando la factura se emitió al público en general, el complemento se emite al
mismo receptor genérico. La estructura del complemento no cambia; lo que cambia
son los datos del `Receptor`.

```json
"Receptor": {
  "Rfc": "XAXX010101000",
  "Nombre": "PUBLICO GENERAL",
  "DomicilioFiscalReceptor": "75700",
  "RegimenFiscalReceptor": "616",
  "UsoCFDI": "CP01"
}
```

Cuatro reglas que el SAT valida en conjunto y que se rompen fácil por separado:

| Campo | Valor obligado | Nota |
|---|---|---|
| `Rfc` | `XAXX010101000` | Nacional. Extranjero es `XEXX010101000` |
| `Nombre` | `PUBLICO GENERAL` | Exacto, en mayúsculas y **sin acento** en "PUBLICO" |
| `RegimenFiscalReceptor` | `616` | "Sin obligaciones fiscales". Es el único que admite el genérico |
| `DomicilioFiscalReceptor` | el del **emisor** | No hay domicilio del receptor: se repite `LugarExpedicion` |

`UsoCFDI` sigue siendo `CP01`, como en cualquier tipo P.

Que `DomicilioFiscalReceptor` sea el código postal del emisor es
contraintuitivo pero es lo correcto: al público en general no se le conoce
domicilio, y el SAT pide que ese campo coincida con el lugar de expedición.

**Nuestro validador de RFC lo rechaza a propósito como proveedor**
(`validarRfcSat()` en `backend/src/utils/validators.ts`), porque un genérico no
sirve para registrar a quién le compramos. Como **receptor** de venta sí es
válido: son dos usos distintos del mismo dato y no hay que unificar esa
validación.

---

## Un pago puede liquidar varias facturas

`DoctoRelacionado` es un arreglo, y el caso normal en cobranza es que un depósito
cubra varias facturas. Cada elemento lleva su propio `IdDocumento`,
`NumParcialidad`, saldos e `ImpuestosDR`:

```json
"Monto": "6778.00",
"DoctoRelacionado": [
  { "IdDocumento": "b7c8d2bf-...", "Serie": "FA", "Folio": "N0000216349",
    "NumParcialidad": "2", "ImpSaldoAnt": "6777.41",
    "ImpPagado": "6777.41", "ImpSaldoInsoluto": "0.00", ... },
  { "IdDocumento": "94f4e541-...", "Serie": "FA", "Folio": "SI000032690",
    "NumParcialidad": "1", "ImpSaldoAnt": "9610.81",
    "ImpPagado": "0.59",    "ImpSaldoInsoluto": "9610.22", ... }
]
```

Dos cosas que se derivan de ahí:

- **`NumParcialidad` es por factura, no por pago.** En el ejemplo, un mismo pago
  es la parcialidad 2 de una factura y la 1 de otra.
- **`Monto` del pago debe cuadrar con la suma de los `ImpPagado`.** Aquí
  `6777.41 + 0.59 = 6778.00`.

Y `ImpuestosP` / `Totales` son la **suma de todos los documentos** del pago, no
los de uno: `5842.60 + 0.51 = 5843.11` de base.

### Los decimales de ImpuestosDR

El ejemplo escribe `BaseDR: "5842.600000"` e `ImporteDR: "934.816000"` — **seis
decimales**, no dos. Es válido y a veces necesario: el SAT valida
`BaseDR × TasaOCuotaDR == ImporteDR`, y con importes que no son múltiplos
redondos la igualdad sólo cuadra si se conserva la precisión. Nótese que
`934.816` redondeado a dos decimales sería `934.82`, pero `Totales` declara
`934.90` porque suma las dos facturas antes de redondear.

En cambio `MontoTotalPagos`, `Monto`, `ImpPagado`, `ImpSaldoAnt` e
`ImpSaldoInsoluto` van con **dos decimales**: son dinero, no bases de cálculo.

## Estado actual del código, ampliado

`payments.service.ts` emite hoy **un solo `DoctoRelacionado`**, porque la pantalla
registra el pago contra una factura a la vez. Para cobrar un depósito que cubre
varias hay que cambiar también la interfaz, no sólo el XML: es un cambio de
alcance mayor que el resto de los casos de este documento.
