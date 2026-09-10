# Códigos del SAT que deben coincidir (motores de Contabilidad)

Los motores contables **no adivinan** la cuenta: la buscan por su **agrupador del
Anexo 24** (`codigo_agrupador`) o por su **código** con esa máscara. Si la cuenta con
ese agrupador no existe en el catálogo de la empresa, el motor **omite** la partida y
lo dice (no inventa la cuenta). Por eso, para que "se activen" las cédulas y las
pólizas automáticas, el catálogo debe tener cuentas con estos agrupadores.

> La cuenta se localiza por el agrupador (3 dígitos antes del punto). Da igual la
> numeración interna de la empresa: lo que importa es el `codigo_agrupador`.

---

## 1. Activo fijo y depreciación / amortización (LISR 33–35, NIF C-6/C-8)

La **cédula de activo fijo** se activa cuando la cuenta de activo tiene un agrupador
**151–182**. La regla (tasa, gasto y acumulada) sale de `depreciacion.data.ts`:

| Agrupador activo | Rubro | Tasa máx. | Gasto | Acumulada |
|---|---|---|---|---|
| 151 | Terrenos | — (no se deprecia) | — | — |
| 152 | Edificios y construcciones | 5% | 701.01 | 171.01 |
| 153 | Maquinaria y equipo | 10% | 701.02 | 171.02 |
| 154 | Automóviles, camiones, transporte | 25% | 701.03 | 171.03 |
| 155 | Mobiliario y equipo de oficina | 10% | 701.04 | 171.04 |
| 156 | Equipo de cómputo | 30% | 701.05 | 171.05 |
| 157 | Equipo de comunicación | 10% | 701.06 | 171.06 |
| 158 | Activos biológicos | 25% | 701.07 | 171.07 |
| 159 | Obras en proceso | — (no se deprecia) | — | — |
| 160 | Otros activos fijos | 10% | 701.08 | 171.08 |
| 161–169 | Ferrocarriles, embarcaciones, aviones, troqueles, energía renovable, etc. | 6–100% | 701.09–701.11 / 701.02 | 171.x |
| 170 | Adaptaciones y mejoras | 5% | 701.01 | 171.01 |
| 173–182 | **Diferidos/intangibles** (se AMORTIZAN) | 5–15% | **702.0x** | **183.0x** |

- **Cargo** al gasto **701.x** (depreciación) / **702.x** (amortización).
- **Abono** a la **acumulada** complementaria: subcuenta bajo **171** (tangibles) /
  **183** (intangibles). Si la subcuenta por rubro no existe, se **crea al vuelo**
  bajo su mayor 171/183.
- Terrenos (151), obra en proceso (159) y crédito mercantil (180) **se registran
  pero no generan póliza**.
- Póliza mensual **idempotente** (una por mes y activo).

---

## 2. Pólizas de VENTA (CFDI emitido, tipo I)

Una por factura, **partida por producto**. Reglas (`generarVentasDelMes`):

| Concepto | Cuenta (agrupador) | Lado |
|---|---|---|
| Cliente | **105.01** (subcuenta del tercero, al vuelo) | cargo TOTAL |
| Ingreso por producto | **401.xx** (mapa producto→cuenta) | abono NETO (importe − descuento) |
| IVA trasladado | **208.01** si PUE · **209.01** si PPD | abono IVA |
| ISR que te retiene el cliente | **113.02** (ISR a favor) | cargo |
| IVA que te retiene el cliente | **113.01** (IVA a favor) | cargo |

- Cada **ClaveProdServ** necesita su cuenta **401** asignada (mapa producto→cuenta);
  sin ella, esa factura se **omite** con aviso.
- **208 vs 209** = flujo del IVA: se causa al **cobrar**. PUE va directo a 208; PPD
  entra en 209 y pasa a 208 con el complemento de pago.

## Complementos de pago (venta)
Al cobrar un PPD: **cargo 209.01** (IVA no cobrado) → **abono 208.01** (IVA cobrado);
**cargo 102.01** (banco) → **abono 105** (cliente).

---

## 3. Pólizas de COMPRA (CFDI recibido) — y el motor de PASIVOS

Una por factura recibida, **partida por producto** (`generarComprasDelMes`). Aquí es
donde **nace el pasivo**: el abono al proveedor es la cuenta por pagar.

| Concepto | Cuenta (agrupador) | Lado |
|---|---|---|
| Gasto / inventario por producto | **115** (inventario) / **601** (gasto) según mapa | cargo NETO |
| IVA acreditable | **119.01** (IVA acreditable por pagar) | cargo IVA |
| **Proveedor (PASIVO)** | **201.xx** (subcuenta del tercero, al vuelo) | **abono TOTAL** |
| ISR que retienes al proveedor | **216.05/04/03/01/216** | abono (por enterar) |
| IVA que retienes al proveedor | **216.10 / 216** | abono (por enterar) |

- El **pasivo por CFDI** = el abono a la subcuenta de **201** (cuentas por pagar), más
  las **retenciones por enterar** en **216** (también pasivo). El IVA acreditable
  vive en **119** hasta que se paga (pasa a **118** con el complemento de pago).
- Sin cuenta **119.01** / **201** / **216** el motor **omite** la partida y lo avisa.

## Complementos de pago (compra)
Al pagar un PPD: **cargo 118.01** (IVA acreditable pagado) → **abono 119.01**;
**cargo 201** (proveedor) → **abono 102.01** (banco).

---

## 4. Tarjeta de crédito (pasivo) — ver también BITÁCORA 2026-09-09
Compra con CFDI → gasto + **119.01** IVA acreditable / **abono a la tarjeta** (201/205);
intereses → cuenta de intereses configurada; el pago sale del banco.

---

## 5. Balanza de comprobación desde pólizas

`alimentarDesdePolizas(empresa, año, mes)` (botón **«Actualizar desde pólizas»** /
**«Reconstruir año»**) hace exactamente lo que esperas:

1. **Revisa TODAS las pólizas del mes calendario** (`journal_entries.fecha` entre el
   1º y el último día del periodo), agrupando por cuenta la suma de cargos y abonos.
2. **Saldo inicial** de cada cuenta = **saldo final del mes anterior** (enlaza la serie).
3. **Saldo final** = inicial + cargos − abonos, **según la naturaleza** (deudora suma
   cargos − abonos; acreedora al revés).
4. El **trigger de BD** garantiza que cada póliza cuadre (Σcargos = Σabonos), así que
   la balanza siempre cuadra; si el **balance** no cuadra es por cuentas sin agrupador
   que no llegan a un rubro del estado (lo detecta `/contabilidad/validacion`).
5. Un periodo **CERRADO** no se recalcula sin reabrirlo (base del cierre mensual/anual).

**Requisito para el 100%:** que el catálogo tenga las cuentas con los agrupadores de
arriba (401, 105, 208/209, 113 · 115/601, 119, 201, 216, 118 · 151–182, 701/702,
171/183 · 102). Si falta alguno, esa partida no se contabiliza y el motor lo dice.
