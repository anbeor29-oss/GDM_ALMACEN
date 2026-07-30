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
