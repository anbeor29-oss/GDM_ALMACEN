# GDM NEXO — Contabilidad, Depreciaciones y Estados Financieros
### Plan de trabajo y bosquejo de diseño

> Base: `GDM_NEXO_ana_contable.md` (análisis de arquitectura) y `Catalogo_cTAS.md`
> (Anexo 24, RMF 2026). Este documento **corrige** el análisis donde ya quedó
> rebasado por el código actual, y aterriza el "cómo" de pólizas, depreciaciones
> y estados financieros.

---

## 0. Antes de nada: tres correcciones al análisis

El análisis se hizo sobre un ZIP anterior. Verifiqué contra la base de datos y el
código de hoy. **Tres de sus dictámenes ya no aplican, y seguir uno de ellos al
pie de la letra construiría tablas duplicadas.**

| El análisis dice | Realidad hoy | Consecuencia |
|---|---|---|
| «Nómina cálculo — **NO EN ESTE ZIP**» | Nómina está **completa**: `nomina_empleados`, `nomina_periodos`, `nomina_recibos`, `nomina_creditos`, `nomina_entregas`, `nomina_cuotas_imss`. Motor de ISR/IMSS, subsidio, finiquito, timbrado, reportes y **cuota patronal desglosada por rama**. | La póliza de nómina **no hay que calcularla**: los números ya existen. Es la póliza más fácil de las automáticas, no la más difícil. |
| «Tesorería: falta banco, movimientos, conciliación» → crear `bank_accounts`, `bank_statement_imports`, `bank_statement_lines`, `bank_reconciliations` | Ya existen `bancos_cuentas`, `bancos_estados_cuenta`, `bancos_movimientos`, con extracción de PDF, control mes a mes, saldo encadenado y CSV puente. | ⚠️ **No crear esas cuatro tablas.** Son las que ya construimos con otro nombre. Duplicarlas partiría el saldo bancario en dos verdades. |
| `nomina_imports` como base de la nómina | `nomina_imports` es **sólo la ingesta de CFDI de nómina de terceros** (XML recibidos). La nómina propia vive en `nomina_recibos`. | La póliza de nómina se genera desde `nomina_recibos`, **no** desde `nomina_imports`. Son dos cosas distintas que se llaman parecido. |

**Lo que el análisis sí acierta y confirmé:** no existe nada de contabilidad,
eventos, producción ni activos fijos. `accounting_accounts`, `journal_entries`,
`journal_lines`, `business_events`, `production_orders`, `fixed_assets`: **cero
de siete**. Ahí sí hay que construir desde el suelo.

### Y una discrepancia de orden, a propósito

El análisis propone construir el **Motor de Eventos primero** (Fase B) y la
contabilidad después (Fase C). **Propongo el orden inverso.**

Razón: el motor de eventos no tiene dónde asentar nada hasta que existan cuentas
y pólizas, y **una póliza automática no se puede validar sin poder leer una
balanza**. Construir el motor primero significa meses de trabajo antes de que
algo sea verificable — y en contabilidad, lo que no se puede cuadrar no se puede
confiar.

Con el catálogo y las pólizas manuales primero, **desde la Fase 2 hay una
contabilidad que funciona**, aunque se capture a mano. Después cada automatismo
se compara contra lo que un contador habría hecho a mano. Eso es lo que hace
auditable al motor.

---

## 1. Qué obliga realmente el SAT (y qué no)

Es el punto que más se malinterpreta, y el propio Anexo 24 lo dice:

> «El contribuyente **NO adopta** el catálogo del SAT: mantiene su propio
> catálogo y lo mapea al código agrupador.»

Es decir:

```
CATÁLOGO PROPIO DE LA EMPRESA          CÓDIGO AGRUPADOR SAT
1102-001  Bancrea cta. 1234      ──►   102.01  Bancos nacionales
1102-002  BBVA cta. 5678         ──►   102.01  Bancos nacionales
4101-001  Venta de mercancía     ──►   401.01  Ventas gravadas contado
```

**Varias cuentas propias apuntan al mismo agrupador. Es normal y correcto.**

Por eso el diseño lleva **dos columnas separadas**:

- `codigo` — la clave interna, la que ve el usuario, con los niveles que quiera
  (1, 2, 3, 4, 5… sin límite).
- `codigo_agrupador` — la equivalencia SAT, sólo para el XML del buzón.

Confundirlas es el error clásico: amarra el catálogo de la empresa a una
numeración que el SAT puede cambiar, y obliga a re-numerar toda la contabilidad
cuando publiquen un Anexo 24 nuevo.

### Los tres archivos que de verdad se entregan

| Archivo | Cuándo | Nuestro alcance |
|---|---|---|
| **A. Catálogo de cuentas** | Al inicio y cuando cambie | Fase 8 |
| **B. Balanza de comprobación** | **Mensual**, primeros 3 días del 2º mes siguiente | Fase 8 |
| C. Pólizas del periodo | Sólo bajo requerimiento (auditoría, devolución, compensación) | Fase 8 |
| D–H | Bajo requerimiento / referencia | Después |

Los cuatro últimos son a solicitud. **El que corre cada mes con fecha fatal es la
balanza.** Todo el diseño debe apuntar a que la balanza salga sola.

---

## 2. Bosquejo — PÓLIZAS

### 2.1 El modelo

Dos tablas, y son casi todo el sistema:

```
journal_entries  (la póliza — el encabezado)
├── id, company_id
├── tipo            INGRESO | EGRESO | DIARIO      ← los 3 del Anexo 24
├── folio, fecha, concepto
├── periodo_id      → accounting_periods
├── estado          BORRADOR | ASENTADA | REVERSADA
├── event_id        → business_events  (NULL si es manual)
├── regla_id, regla_version                        ← con qué regla se generó
└── reversa_de_id   → journal_entries

journal_lines    (las partidas)
├── entry_id, orden
├── account_id      → accounting_accounts
├── cargo, abono    NUMERIC(14,2)   ← uno de los dos es 0, nunca ambos
├── concepto
└── dimensiones opcionales:
    party_id, product_id, warehouse_id, cost_center_id,
    invoice_id, payment_id, purchase_order_id, nomina_recibo_id, uuid_cfdi
```

**Las dimensiones son lo que convierte la contabilidad en algo consultable.**
Sin ellas, «601.01 Sueldos y salarios $482,000» es un número muerto. Con
`nomina_recibo_id`, ese renglón se abre hasta el recibo de cada trabajador.

### 2.2 Reglas no negociables

1. **`SUM(cargo) = SUM(abono)` en cada póliza**, verificado en la base de datos
   con un `CONSTRAINT TRIGGER DEFERRABLE`, no en TypeScript. Una póliza
   descuadrada no debe poder existir ni por un instante dentro de una
   transacción.
2. **Una póliza asentada no se borra ni se edita: se reversa.** La reversa es
   otra póliza, con los mismos renglones invertidos y `reversa_de_id` apuntando
   al original. Es el mismo principio del Kardex inmutable que NEXO ya respeta.
3. **Un periodo cerrado no admite pólizas.** El cierre es un candado, no una
   sugerencia.
4. **Idempotencia**: `UNIQUE (company_id, event_id, regla_id)` — un evento no
   puede generar dos pólizas. Es la única defensa real contra la doble
   contabilización, y tiene que estar en el índice, no en un `if`.
5. **Toda cifra llega al documento.** Póliza → evento → operación → CFDI/XML.

### 2.3 Cómo nace una póliza automática

```
OPERACIÓN            EVENTO                    REGLA              PÓLIZA
factura timbrada  →  INVOICE_STAMPED       →  ventas_cfdi_v1  →  journal_entry
pago recibido     →  PAYMENT_RECEIVED      →  cobranza_v1     →  journal_entry
recepción compra  →  PURCHASE_RECEIVED     →  compras_v1      →  journal_entry
nómina cerrada    →  PAYROLL_CLOSED        →  nomina_v1       →  journal_entry
mes corrido       →  DEPRECIATION_RUN      →  depreciacion_v1 →  journal_entry
```

La regla **no está en el módulo**. Vive en `accounting_mappings`, que traduce
(tipo de evento + tipo de producto + tasa de impuesto) → cuenta. Cambiar la
cuenta de ventas es cambiar un renglón de configuración, no recompilar el módulo
de facturación.

### 2.4 Las pólizas, concretas

Aquí es donde el bosquejo se vuelve útil. Los códigos son del Anexo 24.

---

#### A · Venta CFDI de contado (PUE) — $10,000 + IVA

```
105.01  Clientes nacionales                 11,600.00
    401.01  Ventas gravadas tasa gral. contado          10,000.00
    208.01  IVA trasladado COBRADO                       1,600.00
```

Costo de lo vendido, en la misma póliza (el costo lo da el Kardex que ya existe):

```
501.01  Costo de venta                       6,200.00
    115.0x  Inventario                                   6,200.00
```

#### B · Venta a crédito (PPD) — la diferencia que importa

```
105.01  Clientes nacionales                 11,600.00
    401.02  Ventas gravadas tasa gral. crédito          10,000.00
    209.01  IVA trasladado NO COBRADO                    1,600.00
```

**208 contra 209 es la distinción de flujo de efectivo del IVA mexicano.** El IVA
se causa cuando se cobra, no cuando se factura. Ponerlo en 208 desde la factura
es pagarle al SAT un impuesto que todavía no se cobra.

NEXO ya sabe cuál es cuál: lo dice `metodo_pago` en la factura. La regla lo lee.

#### C · Cobro del PPD (complemento de pago)

```
102.01  Bancos nacionales                   11,600.00
    105.01  Clientes nacionales                         11,600.00

209.01  IVA trasladado NO cobrado            1,600.00
    208.01  IVA trasladado COBRADO                       1,600.00
```

Ese segundo par es el traslado. **Sin él, el IVA a pagar del mes sale mal**, y es
justo lo que un motor mal hecho se salta.

#### D · Recepción de compra

```
115.0x  Inventario                           8,000.00
119.01  IVA acreditable POR PAGAR            1,280.00
    201.01  Proveedores nacionales                       9,280.00
```

#### E · Pago a proveedor (desde la remesa que ya existe)

```
201.01  Proveedores nacionales               9,280.00
    102.01  Bancos nacionales                            9,280.00

118.01  IVA acreditable PAGADO               1,280.00
    119.01  IVA acreditable POR PAGAR                    1,280.00
```

Mismo principio del lado del gasto: el IVA se acredita cuando se paga.
**118/119 es el espejo de 208/209.**

#### F · Nómina — devengo

Todos estos números **ya los calcula el motor**. La póliza sólo los coloca.

```
601.01  Sueldos y salarios                  (percepciones ordinarias)
601.07  Prima vacacional                    (por concepto SAT)
601.12  Aguinaldo
110.01  Subsidio al empleo por aplicar      (si se entregó subsidio)
    216.01  ISR retenido por sueldos                 recibos.isr
    216.11  IMSS retenido a trabajadores             recibos.imss
    210.01  Provisión de sueldos por pagar           recibos.neto
```

`110.01 Subsidio al empleo por aplicar` es la cuenta que casi siempre se olvida:
el subsidio entregado al trabajador **no es un gasto de la empresa, es un saldo a
favor contra el ISR a enterar**. Mandarlo a gasto infla el costo de nómina y
pierde el acreditamiento.

#### G · Nómina — carga social patronal

Sale de `imss-patronal.service.ts`, rama por rama:

```
601.26  Cuotas al IMSS              (EM cuota fija + excedente + dinero +
                                     pensionados + IV + guarderías + RT)
601.27  Aportaciones al INFONAVIT   (5% sobre SBC, tope 25 UMA)
601.28  Aportaciones al SAR         (retiro 2%)
601.29  Impuesto estatal sobre nóminas
    211.01  Provisión IMSS patronal
    211.02  Provisión SAR
    211.03  Provisión INFONAVIT
    212.01  Provisión impuesto estatal sobre nómina
```

#### H · Nómina — pago

```
210.01  Provisión de sueldos por pagar
216.01  ISR retenido            (al enterarse)
211.01  Provisión IMSS patronal (al pagar el SUA)
    102.01  Bancos nacionales
```

**La provisión y el pago son dos pólizas distintas, en fechas distintas.** Es la
razón de ser de las cuentas 210 y 211: la nómina se devenga el día 15 y se paga
el 17; el IMSS se devenga en agosto y se paga en septiembre. Juntarlas en una
sola póliza destruye el pasivo y el estado de flujo de efectivo.

---

## 3. Bosquejo — DEPRECIACIONES

### 3.1 La decisión que define todo: dos libros

**Depreciación contable ≠ deducción fiscal.** No es un matiz, son dos cálculos
con base distinta, tasa distinta y actualización distinta:

| | Libro CONTABLE (NIF C-6) | Libro FISCAL (LISR 31–37) |
|---|---|---|
| Base | Costo de adquisición − valor residual | MOI (monto original de la inversión) |
| Tasa | **Vida útil estimada** por la empresa | **% máximo de ley**, fijo |
| Actualización | No | **Sí — factor de INPC (Art. 31)** |
| Tope | No | Sí en automóviles (Art. 36-II) |
| Va a | Gasto `701.01-11` / Acum. `171.01-18` | Cuenta de orden `810.01/810.02` |

Un mismo activo produce dos cifras diferentes cada mes, **y ambas son
correctas**. Mezclarlas es el error que hace que el estado de resultados y la
declaración anual nunca cuadren, y nadie sepa cuál está mal.

Por eso el modelo tiene `fixed_asset_books`, no un campo de depreciación dentro
del activo:

```
fixed_assets
├── codigo, descripcion, product_id?, proveedor_id?, cfdi_uuid
├── fecha_adquisicion, fecha_inicio_uso, moi
├── tipo_activo        ← determina las cuentas 152..170 y 171.xx
└── estado             ACTIVO | BAJA | VENDIDO

fixed_asset_books          (una fila por activo POR LIBRO)
├── asset_id, libro        CONTABLE | FISCAL
├── base_depreciable, valor_residual
├── metodo                 LINEA_RECTA | ...
├── tasa_anual_pct, meses_vida_util
└── acumulada_inicial      ← saldos de arranque

fixed_asset_depreciation   (el corrido — una fila por activo/libro/mes)
├── asset_id, libro, anio, mes
├── importe, acumulada_al_cierre
├── factor_actualizacion   (sólo FISCAL)
└── entry_id               → la póliza que lo asentó
    UNIQUE (asset_id, libro, anio, mes)   ← no se deprecia dos veces
```

Ese `UNIQUE` es la pieza clave. **Correr el proceso dos veces en el mismo mes es
el accidente más común de los sistemas de activos**, y el índice lo hace
imposible en lugar de improbable.

### 3.2 Tasas fiscales (LISR Art. 34 y 35)

| Activo | Cuenta | % anual |
|---|---|---|
| Edificios | 152 / 171.01 | 5% |
| Maquinaria y equipo (general) | 153 / 171.02 | 10% |
| Automóviles y camiones | 154 / 171.03 | 25% |
| Mobiliario y equipo de oficina | 155 / 171.04 | 10% |
| Equipo de cómputo | 156 / 171.05 | 30% |
| Equipo de comunicación | 157 / 171.06 | 10% |

⚠️ **A confirmar contigo antes de sembrar la tabla:** el tope de deducción de
automóviles (Art. 36-II) y el de vehículos eléctricos/híbridos. Son montos que se
actualizan y no quiero sembrar una cifra vieja en el catálogo.

Y una regla que hay que respetar: **la depreciación fiscal se calcula por meses
completos de uso**, contados desde el mes en que se empezó a utilizar el bien —
no desde la fecha de la factura. Por eso `fecha_inicio_uso` va aparte de
`fecha_adquisicion`.

### 3.3 La póliza mensual

```
701.05  Depreciación contable de equipo de cómputo    2,916.67
    171.05  Depreciación acum. de equipo de cómputo            2,916.67
```

Y en el libro fiscal, cuentas de orden (no tocan resultados):

```
810.01  Deducción de inversión                        3,208.33
    810.02  Contra cuenta de deducción de inversión            3,208.33
```

Una sola póliza mensual por empresa, con un renglón por tipo de activo — no una
póliza por activo. Cien activos no deben producir cien pólizas.

### 3.4 Baja y venta

```
102.01  Bancos                              (precio de venta)
171.05  Depreciación acumulada              (se cancela toda)
704.xx  Pérdida en venta de activo fijo     (si la hay)
    156.01  Equipo de cómputo                        (el MOI completo)
    704.23  Ganancia en venta de activos             (si la hay)
```

---

## 4. Bosquejo — ESTADOS FINANCIEROS

### 4.1 Principio: **no se guardan, se derivan**

Un saldo almacenado que no coincide con la suma de sus pólizas es peor que no
tener saldo: se ve confiable y miente. Todo sale de `journal_lines`.

`account_balances` existirá **sólo como caché**, con un comando de reconstrucción
y una verificación que compare caché contra suma real. Si difieren, manda la
suma.

### 4.2 Balanza de comprobación — la obligatoria

Por cuenta y por mes:

```
saldo_inicial + cargos − abonos = saldo_final     (según naturaleza)
```

Verificaciones que la balanza debe pasar **antes** de poder enviarse:

- Σ cargos = Σ abonos del periodo.
- Saldo final del mes anterior = saldo inicial de éste, **cuenta por cuenta**.
- Ninguna cuenta con saldo contrario a su naturaleza sin justificación.
- Toda cuenta con movimiento tiene `codigo_agrupador`.

Ese tercer punto es el mismo principio de la rejilla de bancos: **el hueco es el
dato**. Una cuenta de activo con saldo acreedor no es un error de captura que se
descubre en la anual — se descubre el mismo mes.

### 4.3 Estado de situación financiera y de resultados

Se arman del `account_type` y `nif_class` de cada cuenta:

```
ACTIVO       100.01 corto plazo (101–121)   ┐
             100.02 largo plazo (151–190)   ├─ Situación financiera
PASIVO       200.01 / 200.02 (201–260)      │
CAPITAL      300 (301–306)                  ┘

INGRESOS     400 (401–403)                  ┐
COSTOS       500 (501–505)                  ├─ Resultados
GASTOS       600 (601–612)                  │
RIF          700 (701–704)                  ┘

ORDEN        800 (801–899)   ← fuera de ambos estados
```

**Las cuentas de orden (800) no entran a ningún estado financiero.** Son
memoranda fiscal: CUFIN, CUCA, deducción de inversión, pérdidas por amortizar.
Si aparecen en el balance, éste no cuadra.

### 4.4 Estado de flujo de efectivo — ya es posible

Es la ganancia menos obvia del módulo de bancos que acabamos de construir:
`bancos_movimientos` tiene el movimiento real del banco, mes a mes, cuadrado
contra el saldo del estado de cuenta. Con eso el flujo de efectivo se puede
**conciliar contra el banco**, en vez de sólo derivarse de la contabilidad.

Y ahí aparece la **conciliación bancaria** de verdad:

```
bancos_movimientos  (lo que el BANCO dice)
        ↕  emparejamiento
journal_lines de 102.01  (lo que la EMPRESA dice)
        ↓
diferencias: cheques en tránsito, depósitos no correspondidos,
             comisiones no registradas, cargos no reconocidos
```

### 4.5 Sobre la herramienta EDOSFINANCIEROS

Ya tienes una herramienta de estados financieros a 5 niveles con clasificador
propio. **No la voy a reinventar sin preguntarte** — ver decisión 4 abajo.

---

## 5. Plan de trabajo

Estimaciones de esfuerzo, no de calendario.

### FASE 1 · Catálogo de cuentas *(≈2 sem)*

- Migración `accounting_core`: `accounting_fiscal_years`, `accounting_periods`,
  `accounting_accounts`.
- Tabla de referencia `sat_codigos_agrupadores`, sembrada del Anexo 24 (los
  ~700 códigos del documento que anexaste).
- Pantalla de catálogo: árbol, alta, mapeo al agrupador.
- **Catálogo semilla** derivado de lo que GDM NEXO ya opera (bancos, clientes,
  proveedores, inventario, ventas, nómina, IVA) — para no arrancar en blanco.
- Validaciones: sólo las cuentas de último nivel reciben movimientos; el
  agrupador debe existir; naturaleza congruente con el tipo.

### FASE 2 · Pólizas manuales + saldos iniciales *(≈2 sem)*

- `journal_entries`, `journal_lines`, el trigger de cuadre.
- Captura de póliza, reversa, cierre de periodo.
- **Póliza de apertura**: el arranque real de la contabilidad.
- Permisos: grupo de trabajo `CONTABILIDAD` + capacidades
  `contabilidad:capturar`, `contabilidad:asentar`, `contabilidad:cerrar`.

> **Al terminar esta fase ya hay contabilidad funcionando**, aunque se capture a
> mano. Todo lo demás es automatización de algo que ya se puede verificar.

### FASE 3 · Balanza y estados financieros *(≈2 sem)*

Balanza mensual, situación financiera, resultados, auxiliares por cuenta,
exportación a Excel con el estilo de la casa.

### FASE 4 · Motor de eventos + ventas y cobros *(≈3 sem)*

`business_events` + `event_processing_log` + `event_failures`.
Primeras reglas: `INVOICE_STAMPED`, `PAYMENT_RECEIVED`, `POS_SALE_COMPLETED`,
`CREDIT_NOTE_STAMPED`. **Es el volumen más alto: si el motor aguanta ventas,
aguanta todo.**

### FASE 5 · Compras, pagos e inventario *(≈2 sem)*

`PURCHASE_RECEIVED`, `SUPPLIER_PAYMENT_MADE`, costo de ventas desde el Kardex,
ajustes de inventario físico.

### FASE 6 · Nómina *(≈1 sem)*

La más corta, porque **los números ya están calculados**. Es mapeo de conceptos
SAT a cuentas 601.xx y colocación.

### FASE 7 · Activos fijos y depreciación *(≈3 sem)*

Los dos libros, el corrido mensual idempotente, altas/bajas/ventas, y la carga
de los activos existentes con su depreciación acumulada a la fecha de arranque.

### FASE 8 · XML del Anexo 24 *(≈2 sem)*

Catálogo y balanza en XML contra los XSD del SAT, con validación previa al envío.

### FASE 9 · Producción *(≈4 sem)*

Recetas/BOM, órdenes, `PRODUCTION_ISSUE`/`PRODUCTION_RECEIPT` sobre
`applyMovement()`, merma, costo estándar vs real.

### Después

Motor NIF versionado · Motor fiscal (separado del contable) · Auditoría
financiera (`financial_audit_chain`) · Inteligencia financiera.

---

## 6. Migraciones, en orden

```
2026-XX_accounting_core.sql            años, periodos, cuentas
2026-XX_sat_codigos_agrupadores.sql    catálogo Anexo 24 (referencia)
2026-XX_journal.sql                    pólizas, partidas, trigger de cuadre
2026-XX_accounting_mappings.sql        evento → cuenta
2026-XX_business_events.sql            eventos + log + fallas
2026-XX_fixed_assets.sql               activos, libros, corrido
2026-XX_production_core.sql            recetas, órdenes
2026-XX_financial_audit.sql            cadena de trazabilidad
```

Módulos nuevos: `accounting/`, `events/`, `integration/`, `fixed-assets/`,
`production/`.

---

## 7. Reglas heredadas del análisis que sí se respetan

1. No duplicar clientes, proveedores ni productos en contabilidad — sólo
   referenciarlos.
2. No crear un inventario contable paralelo.
3. Nada modifica existencias fuera de `inventory.applyMovement()`.
4. Ninguna operación se contabiliza dos veces.
5. Toda póliza automática lleva `event_id` **y la versión de la regla**.
6. Las pólizas no se borran: se reversan.
7. Contabilidad y fiscal, separados.
8. **Y una nueva: tesorería no se reconstruye. Ya existe.**

---

## 8. Decisiones tomadas — 20/08/2026

### 1. Alcance: **interna primero, buzón después**

Se construye para gestión y control. El `codigo_agrupador` se captura desde el
día uno pero **no bloquea**: una cuenta puede vivir sin él mientras se afina.
La Fase 8 (XML del Anexo 24) se conserva en el plan pero baja de prioridad.

> La columna se llena desde el principio de todos modos. Volver a mapear 400
> cuentas dos años después, ya con movimientos encima, es un trabajo que nadie
> hace bien.

### 2. Numeración: **la del SAT como base, con empate posterior a otros catálogos**

El catálogo semilla se numera con la del Anexo 24 (101, 102.01, 401.01…), y más
adelante se empatan catálogos ya formados de otras empresas o del despacho.

**Esto cambia el modelo.** No basta una columna `codigo_agrupador`: hace falta
una tabla de equivalencias **de varios catálogos a la vez**.

```
accounting_account_equivalences
├── account_id       → accounting_accounts   (la cuenta de NEXO)
├── catalogo         SAT | DESPACHO | EMPRESA_X | EDOSFINANCIEROS | ...
├── codigo_externo
├── descripcion_externa
└── UNIQUE (account_id, catalogo)
```

Con eso, `codigo` y `codigo_agrupador` **siguen siendo columnas separadas aunque
hoy valgan lo mismo**. Es lo que permite el empate sin re-numerar: el día que un
catálogo ajeno traiga «1102-001 Bancrea», se registra como una equivalencia más,
no como una migración del catálogo entero.

> Fusionarlas hoy porque coinciden es el atajo que cierra la puerta al empate.

### 3. Saldos iniciales: **cargar la balanza del sistema anterior**

Se construye un **cargador de balanza** que produce la póliza de apertura, con
las mismas defensas del extractor de bancos: cuadre obligatorio (Σ deudor =
Σ acreedor), cuentas que no existen se reportan **antes** de asentar nada, y
nada se carga a medias.

📌 **Pendiente tuyo:** pásame la balanza (Excel, PDF o TXT) y su fecha de corte.
Sin verla no puedo escribir el cargador — el formato manda.

### 4. EDOSFINANCIEROS: **NEXO alimenta, ella presenta**

NEXO genera y cuadra la **balanza**; EDOSFINANCIEROS sigue armando los estados a
5 niveles con su clasificador. Se construye el puente y **no se duplica la
presentación**.

Esto reduce la Fase 3: NEXO hace balanza, auxiliares por cuenta y el archivo
puente. Situación financiera y resultados **dentro de** NEXO quedan como vista de
control, no como el entregable formal.

---

## 9. Plan ajustado a las decisiones

| Fase | Cambio respecto a la sección 5 |
|---|---|
| 1 · Catálogo | **+** `accounting_account_equivalences`. Semilla con numeración SAT. |
| 2 · Pólizas | **+** cargador de balanza anterior → póliza de apertura *(depende del archivo)* |
| 3 · Balanza | **−** presentación de estados a 5 niveles. **+** puente a EDOSFINANCIEROS |
| 8 · XML Anexo 24 | Baja de prioridad; se conserva para cuando se decida enviar |

Las fases 4 a 7 y 9 quedan igual.

---

*Documento de diseño. Nada de esto está codificado todavía.*
