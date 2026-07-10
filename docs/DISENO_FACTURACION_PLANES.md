# Módulo Facturación y Consumo — diseño

> **ESTADO: ✅ IMPLEMENTADO (las 5 fases)** — commits `e5a6e47` (F1),
> `56730cb` (F2), `7f4cec4` (F3), `7473c6e` (F4), F5 en el commit que
> acompaña esta edición.
>
> Para activar en producción, configurar en Render → Backend → Environment:
> `PLATFORM_COMPANY_RFC=<RFC de HCGM>` y `ENABLE_BILLING_CRON=true`.

Propuesta del nuevo módulo SUPER_ADMIN que se agrega después de
**Paquetes fiscales**. Cubre 3 escenarios:

1. Plan **iguala** — renta mensual + cap de timbres, **rollover** del sobrante.
2. Plan **renta** — sin cap, se factura el consumo real.
3. Plan **FLEX** — **prepago** por bloques de 30 timbres con recompra automática.

## 1. Estado actual (lo que ya existe)

| Objeto | Función |
|---|---|
| `stamp_packages` | Catálogo de planes (PKG_100/200/500/FLEX) con `monthly_stamps`, `monthly_fee_mxn`, `extra_stamp_mxn`. |
| `companies.stamp_package_code` | Paquete asignado a cada empresa. |
| `companies.billing_period_start` | Fecha del ciclo actual (día 1 del mes en curso). |
| `stamp_usage` | Bitácora inmutable — 1 fila por CFDI timbrado con `billing_period`, `was_extra` y `extra_charge_mxn`. |
| `v_stamp_usage_current` | Vista con `used_current_month`, `remaining`, `percent_used`. |

Lo que **falta** para cerrar el modelo de facturación:

- Contador de **timbres acumulados** (rollover) para plan iguala.
- Registro de **facturación mensual** (una fila por mes por empresa) con el desglose renta + extras.
- **Bolsa prepago** para plan FLEX con recompra.
- **Alertas por correo** al agotarse el saldo prepago o cerca del cap.
- **Job** que corre el día 1 de cada mes y genera los cargos.

---

## 2. Reglas de negocio por plan

### 2.1 Plan iguala (con cap + rollover)

Empresa contrata PKG_100 ($399 con 100 timbres/mes).

```
Mes 1:  timbra 70    → factura $399 · rollover 30 al mes 2
Mes 2:  cap efectivo = 100 + 30 = 130. Timbra 90 → factura $399 · rollover 40
Mes 3:  cap efectivo = 100 + 40 = 140. Timbra 150 → factura $399 + 10 × $2.50 = $424
```

**Política**:
- Rollover **infinito** (no expira) mientras el plan esté activo.
- Al cambiar de plan, el saldo acumulado se **cancela** (o se conserva? — decisión de negocio).
- Cancelar un CFDI **no** devuelve el timbre (SAT ya lo cobró al PAC).

### 2.2 Plan renta (sin cap, pago por uso)

Empresa contrata plan renta ($0 fijo, $2.50/timbre por ejemplo).

```
Mes 1:  timbra 70  → factura 70 × $2.50 = $175
Mes 2:  timbra 200 → factura 200 × $2.50 = $500
```

**Política**:
- No hay rollover, no hay cap.
- La renta base es $0 (o mínima, según convenio).
- Se cobra el consumo mensual exacto.

### 2.3 Plan FLEX (prepago, recompra por bloques de 30)

Empresa compra prepago sin renta.

```
Compra bloque #1 de 30 timbres   → saldo prepago = 30
Timbra 25                        → saldo = 5   → correo automático "quedan 5"
Timbra 3                         → saldo = 2   → correo "quedan 2, recarga urgente"
Timbra 2                         → saldo = 0   → BLOQUEA timbrado hasta recarga
Compra bloque #2 de 30           → saldo = 30
```

**Política**:
- El sistema **bloquea** el timbrado cuando el saldo llega a 0 (con mensaje "Sin timbres — contacta al administrador").
- Correo automático cuando saldo < N (configurable, default 5).
- Precio por bloque: 30 × $4.99 + IVA = ~$174 MXN.
- El pago **debe estar registrado** antes de acreditar el bloque (evita fraude).

---

## 3. Modelo de datos (migraciones nuevas)

### 3.1 Rollover del plan iguala

Nueva columna en `companies` (o tabla `company_stamp_balance` si se prefiere separar).
Opción simple: columna directa.

```sql
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS carried_over_stamps INT DEFAULT 0;
```

Fórmula del cap efectivo del mes en curso:
```
cap_efectivo = stamp_packages.monthly_stamps + companies.carried_over_stamps
```

Al cierre de mes: `carried_over_stamps += max(0, monthly_stamps - used_current_month)`.

### 3.2 Facturación mensual

Nueva tabla `monthly_invoicing`:

```sql
CREATE TABLE monthly_invoicing (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    billing_period     DATE NOT NULL,               -- YYYY-MM-01
    package_code       VARCHAR(16) NOT NULL,
    stamps_included    INT NOT NULL,
    stamps_used        INT NOT NULL,
    stamps_extra       INT NOT NULL DEFAULT 0,
    stamps_rolled_over_from_prev INT DEFAULT 0,
    stamps_rolling_to_next       INT DEFAULT 0,
    monthly_fee_mxn    NUMERIC(8,2) NOT NULL,
    extra_charge_mxn   NUMERIC(8,2) NOT NULL DEFAULT 0,
    total_mxn          NUMERIC(8,2) NOT NULL,
    status             VARCHAR(16) NOT NULL DEFAULT 'PENDING',
                                                    -- PENDING | INVOICED | PAID | CANCELLED
    invoice_folio      VARCHAR(32),                 -- folio de la CFDI que emitimos al cliente
    generated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    paid_at            TIMESTAMP,
    UNIQUE (company_id, billing_period)
);
CREATE INDEX ON monthly_invoicing (billing_period);
CREATE INDEX ON monthly_invoicing (company_id, status);
```

Una fila por empresa por mes. Sirve para:
- Reporte histórico de facturación.
- Origen del CFDI que HCGM emite al cliente (self-billing).
- Auditoría de rollover.

### 3.3 Bolsa prepago del plan FLEX

Nueva tabla `prepaid_stamp_balance`:

```sql
CREATE TABLE prepaid_stamp_balance (
    company_id       UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    balance          INT NOT NULL DEFAULT 0,
    low_threshold    INT NOT NULL DEFAULT 5,        -- correo al llegar aquí
    zero_notified_at TIMESTAMP,                     -- para no spamear
    low_notified_at  TIMESTAMP,
    updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
```

Y bitácora de compras:

```sql
CREATE TABLE prepaid_stamp_purchases (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    stamps_bought     INT NOT NULL,                 -- típico 30
    unit_price_mxn    NUMERIC(6,2) NOT NULL,        -- $4.99 default
    total_mxn         NUMERIC(8,2) NOT NULL,
    payment_method    VARCHAR(20),                  -- transferencia | efectivo | tarjeta
    payment_reference VARCHAR(64),
    granted_by        UUID REFERENCES users(id),
    granted_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
```

---

## 4. Endpoints nuevos (SUPER_ADMIN)

### Consumo y facturación

```
GET  /admin/billing/current-month          → lista de empresas con estado del mes en curso
GET  /admin/billing/history?year=2026      → matriz por mes por empresa
POST /admin/billing/close-month            → cierra el mes: calcula rollover + genera monthly_invoicing
                                            (idempotente, solo la primera vez del mes)
GET  /admin/billing/company/:id/history    → detalle histórico de una empresa
PATCH /admin/billing/:id/mark-paid         → marca un cargo como PAID
```

### Prepago FLEX

```
GET  /admin/prepaid/balances               → todas las empresas FLEX con saldo actual
POST /admin/prepaid/:companyId/recharge    → suma un bloque al saldo (registra compra)
                                            body: { stamps_bought, unit_price_mxn, payment_reference }
PATCH /admin/prepaid/:companyId/threshold  → ajusta low_threshold
```

### Validación de timbrado

En `stampInvoice` del `pac.service`, ANTES de llamar al PAC:

```
if (company.plan === FLEX) {
  if (prepaid_balance < 1) throw ValidationError('Sin timbres prepago');
}
// después de timbrar exitoso:
if (company.plan === FLEX) {
  UPDATE prepaid_stamp_balance SET balance = balance - 1
  if (balance <= low_threshold && !low_notified_at) → mail alerta
  if (balance == 0) → mail bloqueo + notified_at
}
```

---

## 5. UI SUPER_ADMIN

### Nuevo menú (después de "Paquetes fiscales")

```
🧾 Paquetes fiscales           (ya existe)
💰 Facturación y consumo       ← NUEVO
🛒 Compras prepago             ← NUEVO (subitem o vista aparte)
```

### 5.1 Facturación y consumo — vista principal

Tabla con filtro por mes:

| RFC | Empresa | Plan | Cap+Roll | Usados | Extras | Renta | Extra $ | Total | Estado |
|---|---|---|---|---|---|---|---|---|---|
| EKU… | Escuela Kemper | PKG_200 | 200+40=240 | 180 | 0 | $699 | $0 | $699 | PENDING |
| GHC… | Grupo HCGM | PKG_100 | 100+15=115 | 130 | 15 | $399 | $37.50 | $436.50 | INVOICED |
| SAJ… | Servicios Jomar | FLEX | prepago 27 | 3 | — | — | — | — | (prepago) |

Botones:
- **Cerrar mes** (naranja, big) — corre el job manualmente (o esperar al día 1).
- **Ver histórico** por empresa — modal con tabla mes por mes.
- **Marcar pagado** por fila — cambia estado a PAID.
- **Descargar CFDI** que HCGM emitió al cliente (link al invoice_folio).

### 5.2 Compras prepago

Tabla:

| RFC | Empresa | Saldo | Umbral aviso | Última recarga | Compras totales | Acciones |
|---|---|---|---|---|---|---|
| SAJ… | Servicios Jomar | **3** ⚠ | 5 | 2026-06-15 (30) | 90 | [+ Recargar] |

Botón **Recargar** abre modal:
```
Timbres a agregar: [ 30  ]
Precio unitario:   [ $4.99 ]
Total:             $149.70 + IVA
Referencia pago:   [                   ]  (folio SPEI, etc.)
Método:            [ ▼ Transferencia   ]

[ Cancelar ]  [ Registrar recarga ]
```

Historial: link "Ver compras" abre lista de `prepaid_stamp_purchases`.

---

## 6. Jobs automáticos

### Job 1 — Cierre mensual (`monthly-close.job.ts`)

Corre el **día 1 de cada mes a las 03:00** (cron o Render Cron Jobs).

Para cada empresa NO FLEX:
1. Cuenta timbres usados en el mes anterior.
2. Calcula `stamps_extra = max(0, used - (cap + roll_previo))`.
3. Calcula `roll_nuevo = max(0, (cap + roll_previo) - used)`.
4. Inserta `monthly_invoicing` con desglose.
5. Actualiza `companies.carried_over_stamps = roll_nuevo`.
6. Envía correo al cliente con el CFDI de cobro (opcional en fase 2).

Es **idempotente**: usa `ON CONFLICT (company_id, billing_period) DO NOTHING`.

### Job 2 — Alerta prepago (`prepaid-alert.job.ts`)

Corre cada **hora**. Para cada empresa FLEX:
- Si `balance == 0` y `zero_notified_at IS NULL` → correo urgente + set flag.
- Si `balance <= low_threshold` y `low_notified_at IS NULL` → correo aviso + set flag.
- Al recargar (balance > threshold+5) → limpiar los flags para volver a poder notificar.

### Job 3 — Recordatorio de mensualidad (opcional)

Cada día 10 del mes, correos automáticos a empresas con `monthly_invoicing.status='INVOICED'` y sin `paid_at`.

---

## 7. Correos automáticos (templates)

Usan el módulo `mailer.service` existente. Tres tipos:

### `prepaid_low`
```
Asunto: Timbres prepago casi agotados — {rfc}
Cuerpo: Actualmente te quedan {balance} timbres del bloque de {last_purchase}.
        Para no interrumpir tu operación, comunícate con nosotros para recargar.
        Facturación: facturas@hcgm.com.mx · WhatsApp: [número]
```

### `prepaid_zero`
```
Asunto: URGENTE — Timbrado detenido, sin saldo prepago
Cuerpo: El timbrado ha sido bloqueado. Recarga para continuar operando.
```

### `monthly_bill`
```
Asunto: Cargo del mes {YYYY-MM} — {business_name}
Cuerpo: Renta plan {PKG_XXX}: ${monthly_fee}
        Extras ({stamps_extra} × ${extra_stamp_mxn}): ${extra_charge_mxn}
        ─────────────────────────
        TOTAL: ${total_mxn}
        (Adjunto: CFDI emitida por HCGM)
```

---

## 8. Fases de implementación

**Fase 1 — Datos y contadores** (foundational, 1 día)
- 2 migraciones: rollover en `companies` + tabla `prepaid_stamp_balance`.
- Ampliar `v_stamp_usage_current` para incluir `carried_over_stamps` y `cap_efectivo`.
- Backend: helper `getCompanyEffectiveCap(companyId)` reutilizable.

**Fase 2 — UI SUPER_ADMIN de consumo** (½ día)
- Página "Facturación y consumo" (read-only + botón cerrar mes).
- Modal "Ver histórico".

**Fase 3 — Prepago FLEX** (1 día)
- Migración `prepaid_stamp_balance` + `prepaid_stamp_purchases`.
- Endpoint recarga.
- Validación en `stampInvoice` (bloqueo si saldo = 0).
- Página "Compras prepago" con modal de recarga.

**Fase 4 — Job cierre mensual** (½ día)
- Script `monthly-close.job.ts` + Cron en Render.
- Endpoint `POST /admin/billing/close-month` para dispararlo manualmente.
- Tabla `monthly_invoicing` con historia.

**Fase 5 — Correos** (½ día)
- Job `prepaid-alert.job.ts` que corre cada hora.
- Templates HTML + integración con `sendInvoiceMail`.

**Total estimado**: ~3.5 días de trabajo. Se puede hacer por fases sin
bloquear producción — cada fase entrega valor por sí sola.

---

## 9. Decisiones de negocio confirmadas

### ✅ 9.1 Ciclo de cierre

- **Corte del consumo**: último día natural del mes (30 o 31 según el mes; febrero: 28/29).
- **Emisión de CFDI de cobro**: día **1 del mes siguiente**, con la información ya consolidada.
- El job `monthly-close.job.ts` corre a las **00:15 del día 1** para calcular todo antes de que los usuarios abran el ERP en la mañana.

### ✅ 9.2 Cambio de plan a mitad de mes — prorrateo por días

Cuando una empresa cambia de plan durante el mes, el ciclo se parte en dos y cada tramo se factura proporcional a los días vividos en cada plan.

**Ejemplo — cambio del 15 de junio (mes de 30 días):**

```
Del 1 al 14 en PKG_100 ($399, 100 timbres):
  Días vividos:  14 / 30
  Renta prorrateada:  $399 × 14/30 = $186.20
  Cap prorrateado:    100 × 14/30 = 46.67 timbres (redondeo hacia arriba = 47)

Del 15 al 30 en PKG_200 ($699, 200 timbres):
  Días vividos:  16 / 30
  Renta prorrateada:  $699 × 16/30 = $372.80
  Cap prorrateado:    200 × 16/30 = 106.67 timbres (redondeo hacia arriba = 107)

Total mes de junio:
  Renta total:  $186.20 + $372.80 = $559.00
  Cap efectivo: 47 + 107 = 154 timbres (más rollover previo si lo había)
```

**Extras**: si el consumo excede el cap efectivo del tramo respectivo, cada
timbre extra se cobra al `extra_stamp_mxn` del **plan vigente al momento del
timbrado** (se lee de `stamp_usage.package_code_at_stamp` que ya guardamos).

**Regla de redondeo**: al calcular el cap prorrateado, siempre redondeamos
**hacia arriba** (favorece al cliente). La renta no se redondea (usa 2 decimales).

**Rollover previo del plan viejo**: se **conserva íntegro** al cambiar de plan
— no se prorratea. El sobrante acumulado sigue disponible para el nuevo cap.
(Alternativa que descartamos: convertir a crédito monetario — muy complejo
contablemente.)

### ✅ 9.3 Job de cierre y emisión

- Nombre: `monthly-close.job.ts`
- Cron: `15 0 1 * *` (00:15 del día 1 de cada mes)
- Idempotente: si ya existe `monthly_invoicing` para `(company_id, billing_period=YYYY-MM-01 anterior)`, no hace nada.
- Detecta automáticamente si hubo cambio de plan mid-month leyendo el historial de `stamp_usage.package_code_at_stamp` — si hay más de un código en el mes, aplica prorrateo por días.

---

## 10. Decisiones pendientes → CERRADAS

### ✅ 10.1 CFDI de cobro — HCGM lo emite desde el mismo ERP (dogfooding)

Aprovechamos toda la infraestructura del ERP para el negocio de HCGM: al cerrar
el mes, el sistema emite y timbra las facturas contra cada cliente
automáticamente.

**Requisitos previos**:
- HCGM debe estar registrada como empresa en el ERP (con su propio RFC).
- HCGM debe tener su CSD subido al vault de SW.
- Cada empresa cliente debe existir como `customer` en la lista de clientes de HCGM (se crea automáticamente la primera vez).

**Flujo automático del job `monthly-close`**:
```
Para cada empresa cliente C:
  1. Calcula monthly_invoicing (renta + extras + prorrateo si aplica)
  2. Si total > 0:
       a. Asegura que exista customer en HCGM con el RFC de C
          (upsert con datos fiscales — CIF SAT si es la primera vez)
       b. Crea invoice tipo I en HCGM contra ese customer con:
             concepto: "Servicio de facturación electrónica — <YYYY-MM>"
             ClaveProdServ: 81112000 (Servicios de facturación)
             Cantidad: total_mxn como valor unitario (no timbres)
             IVA 16% trasladado
       c. Timbra con SW (misma ruta /v3/cfdi33/issue/json/v4)
       d. Guarda UUID en monthly_invoicing.invoice_folio + invoice_id
       e. Envía correo automático al contact_email del cliente con PDF + XML
```

**Fallback**: si el timbrado falla (PAC caído, sin timbres, cliente sin
correo), se registra en `monthly_invoicing.status = 'PENDING'` con el mensaje
de error y el super-admin puede reintentar desde la UI (botón "Timbrar CFDI de
cobro" por fila).

**Ventajas**:
- Consistencia total entre el negocio y el producto (dogfooding).
- El cliente recibe un CFDI válido que puede deducir.
- HCGM tiene reporte de ingresos automático (sus propios reportes de cobranza).

### ✅ 10.2 Precio prepago FLEX — $4.99 fijo

Precio uniforme para simplificar. Si en el futuro se quieren precios
especiales por cliente, se puede agregar una columna
`companies.override_flex_price NUMERIC(6,2)` que sobreescriba al default.
Por ahora hardcoded `4.99` en `stamp_packages` (ya está así).

### ✅ 10.3 Umbral de aviso — 5 timbres fijo

Constante en el código: `PREPAID_LOW_THRESHOLD = 5`.
Cuando `prepaid_stamp_balance.balance <= 5` y aún no se ha notificado en este
ciclo, se dispara el correo `prepaid_low`.

Se limpia el flag de "notificado" cuando el saldo vuelva a subir por encima
de `threshold + 5` (evita spam si el cliente sigue timbrando alrededor de 5).

### ✅ 10.4 Comportamiento al saldo 0 — Bloqueo total

Simple, sin ambigüedades. En `pac.service.stampInvoice`, antes de invocar al
PAC:

```typescript
if (company.stamp_package_code === 'PKG_FLEX') {
  const bal = await getPrepaidBalance(company.id);
  if (bal < 1) {
    throw new ValidationError(
      'Sin saldo prepago. Contacta al administrador para recargar tu plan.'
    );
  }
}
```

Correo `prepaid_zero` se envía una sola vez cuando el saldo llega a 0.
Se limpia el flag al recargar.

---

## 11. Todas las decisiones — resumen ejecutivo

| # | Decisión | Valor |
|---|---|---|
| 1 | Corte de consumo | Día 30/31 (último del mes) |
| 2 | Emisión CFDI | Día 1 del mes siguiente (job 00:15) |
| 3 | Cambio de plan mid-month | Prorrateo por días, cap redondeado ↑ |
| 4 | Rollover al cambiar de plan | Se conserva íntegro |
| 5 | Extras al cambiar de plan | Al precio del plan vigente al timbrar |
| 6 | CFDI a cliente | HCGM emite y timbra desde el ERP (dogfooding) |
| 7 | Precio prepago | $4.99 fijo para todos |
| 8 | Umbral aviso prepago | 5 timbres fijo |
| 9 | Comportamiento saldo 0 | Bloqueo total con mensaje |
| 10 | Cancelar CFDI devuelve timbre | No (SAT ya lo cobró) |

---

## 12. Plan de trabajo — ready para arrancar

Con estas 10 decisiones, la implementación queda bien definida. Sugerencia
de orden:

**Antes de arrancar** (10 min):
- Registrar HCGM como empresa en el ERP con su RFC real.
- Subir CSD de HCGM al vault SW.
- Verificar que HCGM tenga `contact_email` cargado para el reply-to.

**Fase 1** (foundational, ~1 día):
- Migración `2026-07-09_billing_module.sql` con:
  - Columna `carried_over_stamps` en `companies`
  - Tabla `monthly_invoicing`
  - Tabla `prepaid_stamp_balance`
  - Tabla `prepaid_stamp_purchases`
  - Vista `v_stamp_usage_current` ampliada con cap efectivo
- Helper `getCompanyEffectiveCap(companyId)` y `getPrepaidBalance(companyId)`.
- Validación pre-timbrado en `pac.service.stampInvoice` (bloqueo FLEX).

**Fase 2** (~½ día): UI SUPER_ADMIN read-only (ver estado del mes).

**Fase 3** (~1 día): Prepago — modal de recarga + validación + UI compras.

**Fase 4** (~1 día): Job `monthly-close.job.ts` con:
- Cálculo de prorrateo por días (helper reutilizable).
- Emisión automática del CFDI HCGM → cliente.
- Envío automático por correo con PDF + XML.
- Endpoint `POST /admin/billing/close-month` para dispararlo manual.

**Fase 5** (~½ día): Jobs de correos automáticos (prepago low/zero,
recordatorio pago).

**Total ~4 días de trabajo**. Se puede hacer por fases sin bloquear
producción — cada fase entrega valor.

Cuando quieras arrancar, dime "adelante Fase 1" y comenzamos.
