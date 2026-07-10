# Bitácora de bugs resueltos — pruebas pre-producción

Documento de referencia para futuros desarrolladores o para diagnóstico de
regresiones. Cada entrada tiene:

- **Síntoma** — qué veía el usuario
- **Causa** — por qué pasaba
- **Fix** — qué cambió
- **Commit** — hash para localizar el diff

Orden cronológico inverso (más reciente arriba).

---

## Cancelación

### 🐛 `SW no encuentra el CFDI en su vault (404)` al reintentar cancelar
- **Síntoma**: cancelar factura timbrada con SW real rebotaba con 404 incluso después de haber cancelado NC y pagos vigentes.
- **Causa**: endpoint incorrecto. Se estaba llamando a `/v4/cfdi33/cancel/{rfc}` — una mezcla mal formada. Los válidos son `/cfdi33/cancel/{rfc}` (legacy) y `/v4/cfdi/cancel/{rfc}` (recomendado, sin "33").
- **Fix**: corregir a `/v4/cfdi/cancel/{rfc}` + parsear `data.uuid = { "<UUID>": "<código>" }` para distinguir aceptación (201/202) de rechazo (205) + logging detallado.
- **Commit**: `1a40cf3`

### 🐛 Cancelación local exitosa pero SW seguía reportando vigente
- **Síntoma**: después de "Cancelar solo localmente", el ERP marcaba `CANCELLED` pero swpanel.mx seguía mostrando la factura vigente.
- **Causa**: el bypass local intencionalmente NO llamaba al PAC. No había forma de re-enviar la cancelación al PAC sin tocar la BD manualmente.
- **Fix**: `pac.service.cancelInvoice` detecta `isResendToPAC` cuando la factura ya está `CANCELLED` con `pac_id=SW_SAPIEN` y `forceLocal=false`. Salta validación de dependientes y solo notifica al PAC. Frontend: el ícono naranja aparece también para facturas canceladas (tooltip "Reintentar en el PAC").
- **Commit**: `1a40cf3`

### 🐛 `Cancelación fallida: Request failed with status code 404`
- **Síntoma**: al cancelar cualquier factura desde el ERP, SW rebotaba con 404.
- **Causa**: `pac.service.cancelInvoice` mandaba `rfcEmisor = 'ABC010101ABC'` (comentado como *placeholder*). SW buscaba ese RFC inexistente en su vault.
- **Fix**: leer `companies.rfc` real desde la BD antes de invocar al PAC.
- **Commit**: `7c7edae`

### 🐛 Botón "Cancelar" oculto para pagos sin UUID
- **Síntoma**: complementos de pago que quedaron en estado sin UUID (MOCK antiguo) no mostraban botón Cancelar en el modal Historia → factura padre imposible de cancelar por círculo vicioso.
- **Causa**: el botón vivía dentro de `{r.uuid && (...)}`. Sin UUID no aparecía.
- **Fix**: mover Cancelar fuera del bloque condicional del UUID. PDF y XML siguen requiriendo UUID, pero Cancelar aplica siempre.
- **Commit**: `09c56cc`

### 🐛 Panel de facturas no se actualiza tras cancelar pago/NC
- **Síntoma**: cancelar un pago actualizaba el status de la factura padre en BD, pero la lista seguía mostrando saldo cero.
- **Causa**: los subqueries de `paid_total` y `balance` en `listInvoices` (y otros 7 lugares del código) no filtraban `document_status = 'CANCELLED'`. El monto de un pago cancelado seguía descontándose del saldo.
- **Fix**: `AND document_status != 'CANCELLED'` en:
  - `invoices.service.listInvoices`
  - `invoices.routes /dashboard/summary`
  - `credit-notes.service.getInvoiceBalance` (reduce)
  - `credit-notes.service.createCreditNote` (validación)
  - `payments.service.sumPaidForInvoice`
  - `payments.service` update customer balance
  - `reports.service.getReceivables`
  - `pdf-payment.service` (saldo anterior)
- **Commit**: `ac9c04e`

---

## Cálculos de saldo y status

### 🐛 Factura no pasaba a PAID cuando pago + NC cubrían el total
- **Síntoma**: FAC-000006 (total $5,204.16) con NC $260.21 + pago $4,943.95 (saldo real $0) seguía en `PARTIAL_PAYMENT`.
- **Causa**: `payments.service.createPayment` calculaba `nuevoStatus = pagos_acum >= total ? PAID : PARTIAL_PAYMENT`. Ignoraba las NC.
- **Fix**: `cubierto = pagos_acum + NC_aplicadas`. Si `cubierto >= total - 0.01` → `PAID`. Además migración one-shot `2026-07-08_recompute_invoice_paid_status.sql` que corrige facturas afectadas.
- **Commit**: `2b80226`

### 🐛 `ImpSaldoAnt`/`ImpSaldoInsoluto` del complemento de pago no descontaban NC
- **Síntoma**: PDF y XML del complemento de pago mostraban insoluto igual al monto de la NC ya aplicada.
- **Causa**: `saldoAnterior = total − pagos_previos` — sin NC.
- **Fix**: `saldoAnterior = max(0, total − pagos_previos − NC_aplicadas)`. XML y PDF alineados.
- **Commit**: `58034b2`

---

## PDF, XML y timbrado

### 🐛 `NO. CERTIFICADO — pendiente —` en NC y complemento de pago
- **Síntoma**: la factura mostraba el certificado real, pero NC y pago decían "pendiente".
- **Causa**: el XML de NC y pago se genera **localmente** (no viene de SW real), y no incluía el atributo `NoCertificado` del root `<cfdi:Comprobante>` ni los nodos `<cfdi:Emisor>` / `<cfdi:Receptor>`. El helper `extractTimbreData(xml)` no encontraba nada.
- **Fix**: ambos servicios cargan `companies` y `customers` en la misma transacción y arman el XML con esos atributos. Fallback al cert sandbox `00001000000506430009` si el CSD del emisor no está en BD.
- **Commit**: `266a916`

### 🐛 QR SAT ausente y sellos falsos en el bloque timbre
- **Síntoma**: los PDFs mostraban sellos generados por regex (no reales) y no incluían el QR de verificación SAT.
- **Causa**: `drawTimbreFiscal` fabricaba las cadenas Base64 a partir del UUID. Nunca se leían los sellos reales del XML timbrado ni se generaba QR.
- **Fix**: nuevos helpers `extractTimbreData(xml)` y `buildQrSatPng()`. `drawTimbreFiscal` acepta `xml` + `qrPng` y renderiza el QR (90×90pt) a la derecha con leyenda "Verificar en portal SAT". URL Anexo 20: `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=<UUID>&re=<RFC_E>&rr=<RFC_R>&tt=<TOTAL_padded>&fe=<8ULTIMOS_SELLOCFD>`.
- **Commit**: `b93e597`

### 🐛 `La fecha de emisión no se encuentra en el rango permitido`
- **Síntoma**: SW rechazaba el timbrado con fecha ~6h adelantada.
- **Causa**: `fmtFechaSAT` usaba `d.getHours()` que devuelve la hora local del proceso. En Render eso es UTC. SW valida contra hora de México (UTC-6/-5 con DST).
- **Fix**: `d.toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' })` que devuelve `YYYY-MM-DD HH:MM:SS` en la zona correcta. Reemplazar espacio por 'T' para el formato ISO del Anexo 20.
- **Commit**: `dd436e9`

### 🐛 Cliente veía "MODO SIMULACIÓN" aunque el backend timbraba con SW real
- **Síntoma**: la factura recibía UUID real pero el toast decía "PAC MOCK".
- **Causa**: el controller y el frontend hardcodeaban `provider: 'MOCK'` y el mensaje "MODO SIMULACIÓN".
- **Fix**: `pac.controller.stamp` devuelve `provider` real y `is_mock` boolean via `pacService.listProviders()`. Frontend renderiza mensaje distinto según `is_mock`. Endpoint `/pac/providers` incluye `env_pac_provider`, `env_sw_env`, `env_sw_token_present` para diagnóstico.
- **Commit**: `0f67969`

### 🐛 `XmlCFDI no proporcionado o viene vacío` al timbrar por primera vez
- **Síntoma**: SW rebotaba con XML vacío.
- **Causa**: el flujo XML clásico esperaba `invoice.xml_content`, pero nunca se generaba antes. Además el token JWT pegado en Render tenía saltos de línea/prefijo/`...` porque se copió del ejemplo tal cual.
- **Fix**: nuevo serializer `buildCFDIJson()` que arma el JSON CFDI 4.0 desde BD y `SWSapienProvider.stampFromJson()` que POSTea a `/v3/cfdi33/issue/json/v4`. Además guía de setup para pegar el JWT sin corrupción.
- **Commit**: `ab3bd70`

---

## Persistencia y schema

### 🐛 Modal "Saldo" atorado en `Cargando…`
- **Síntoma**: modal Balance y complemento de pago no cargaban, quedaban en estado infinito.
- **Causa**: la query de `getInvoiceBalance` seleccionaba `folio, serie, payment_method, pac_timestamp, xml_content` de `payments`, pero esas columnas no existían en el schema base. La query truena con `42703 column does not exist` y el frontend se queda esperando.
- **Fix**: migración `2026-07-07_payments_missing_columns.sql` con 5 `ADD COLUMN IF NOT EXISTS`.
- **Commit**: `d22be5d`

### 🐛 Checkbox "XML" del complemento de pago siempre deshabilitado
- **Síntoma**: en el SendMailModal, el XML del pago aparecía en gris.
- **Causa**: el endpoint `/balance` devolvía `uuid AS payment_uuid` (con alias) — el frontend buscaba `p.uuid` y siempre veía `undefined`.
- **Fix**: quitar el alias. `SELECT uuid FROM payments` directo.
- **Commit**: `266a916`

---

## Otras correcciones

### 🐛 Cliente MOCK cancelado en producción da 404
- **Síntoma**: cancelar una factura antigua (timbrada con MOCK antes de conectar SW) rebotaba con 404.
- **Causa**: SW busca el UUID en su vault. Como la factura fue timbrada localmente con MOCK, SW no la conoce.
- **Fix**: `pac.service.cancelInvoice` detecta `invoice.pac_id === 'MOCK'` y salta el PAC — solo marca `CANCELLED` en BD.
- **Commit**: `ac9c04e`

### 🐛 Mailer aborta el correo entero si un adjunto falla
- **Síntoma**: si el XML de una NC no estaba timbrado, `sendInvoiceMail` cancelaba todo. Usuario recibía 0 adjuntos.
- **Causa**: `buildAttachments` hacía `throw` al primer error y no capturaba individualmente.
- **Fix**: cada adjunto se procesa en `try/catch`. Errores se acumulan en `skipped`. Backend devuelve `{ attached, skipped }`. Frontend muestra en el toast.
- **Commit**: `b93e597`

---

## Notas para futuro

- Muchos de estos bugs comparten un mismo patrón: **campos calculados que no consideran comprobantes cancelados**. Al agregar nuevas subqueries de `paid`/`credited`, siempre incluir `AND document_status != 'CANCELLED'` (pagos) y `AND status != 'CANCELLED'` (NC).
- El **XML de NC y pago se genera localmente** (no viaja al PAC en este momento). Cualquier cambio a los atributos del Anexo 20 debe hacerse en `credit-notes.service.createCreditNote` y `payments.service.createPayment`. Si en el futuro se conectan al PAC real, migrar a la ruta JSON de SW como se hizo para la factura.
- SW sandbox tiene bugs conocidos de propagación al vault. Ante un 404 real en producción, verificar primero en swpanel.mx si el UUID existe. El bypass local es útil pero deja desincronización.
