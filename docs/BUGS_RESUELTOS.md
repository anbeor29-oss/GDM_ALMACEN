# Bitácora de bugs resueltos — pruebas pre-producción

Documento de referencia para futuros desarrolladores o para diagnóstico de
regresiones. Cada entrada tiene:

- **Síntoma** — qué veía el usuario
- **Causa** — por qué pasaba
- **Fix** — qué cambió
- **Commit** — hash para localizar el diff

Orden cronológico inverso (más reciente arriba).

---

## Administración — borrado de empresa

### 🐛 «Eliminar empresa completa» revienta con FK de `stamp_usage`
- **Síntoma**: al borrar una empresa de pruebas: `update or delete on table "invoices" violates foreign key constraint "stamp_usage_invoice_id_fkey" on table "stamp_usage"`.
- **Causa**: la rutina de **borrado total** (`admin-companies.routes` `full-delete`) borraba `invoices` sin limpiar antes sus hijos con FK RESTRICT `stamp_usage` y `cfdi_validations`. El `wipe-operations v2` ya lo hacía bien, pero el full-delete (y el viejo `reset-operations`) se quedaron con el orden incompleto.
- **Fix**: antes de `DELETE FROM invoices`, borrar `stamp_usage` y `cfdi_validations` (por `invoice_id`), más `pos_sale_items`/`pos_sales` en el full-delete. Aplicado en las dos rutinas.
- **Commit**: `pendiente` (2026-09-08)

## Contabilidad — numeración, cuadre y fechas

### 🐛 Los clientes caían en `1-10-02-###` en vez de `1-10-25-###` (una cuenta suelta "se hacía de mayor")
- **Síntoma**: al generar subcuentas de terceros, los clientes se colgaban de una cuenta suelta `1-10-02-074` que acumulaba movimientos como si fuera el control, en lugar del mayor real de clientes `1-10-25-000`.
- **Causa**: el mayor de clientes `1-10-25-000` trae el agrupador **padre `105`**, y sus terceros el específico `105.01`. `cuentaControl` buscaba **sólo** `105.01`, así que no veía el mayor y tomaba como "control" la primera hoja que tuviera `105.01`.
- **Fix**: buscar el control por `105.01` **O** su padre `105` (`agrupador.split('.')[0]`), igual proveedores `201.01`/`201`; preferir el mayor «redondo» (`…-000`) y el que ya tiene más terceros. Las cuentas mal ubicadas ya creadas se corrigen con fusión manual (Cambio de cuenta → «Fusionar (borra la origen)», commit `b906ad0`).
- **Commit**: `e5460a1`

### 🐛 Se inventaban códigos de tercero (`11002074-001`) en vez de ligar la cuenta del respaldo
- **Síntoma**: aparecían subcuentas duplicadas con un segmento de más (`1-10-25-001-076`) junto a la real del respaldo (`1-10-25-076`).
- **Causa**: cuando una cuenta del respaldo no se reconocía como tercero **porque le faltaba el agrupador del SAT**, el sistema inventaba un código nuevo en vez de ligar la cuenta existente.
- **Fix**: «Generar subcuentas» ahora rellena el agrupador faltante heredándolo del padre (`asignarAgrupadorFaltante`) en vez de renumerar; con el agrupador puesto, el enlace encuentra la cuenta real del respaldo y la liga por su número. No se deduce el agrupador por el número de cuenta (los catálogos difieren del SAT): sólo se señalan las que les falta. `MASCARA_DEFAULT='#-##-##-###'` cuando la empresa no fijó máscara.
- **Commit**: `a0718a3` (máscara por defecto en `6fa73bb`)

### 🐛 `non-integer constant in ORDER BY` → se omitían TODAS las pólizas de venta/compra
- **Síntoma**: no se generaba ninguna póliza de venta ni de compra en empresas sin máscara de cuenta.
- **Causa**: `cuentaControl` construía un `ORDER BY` con una constante booleana suelta (`ORDER BY (FALSE)`) cuando el ancho de máscara era 0; Postgres lo rechaza.
- **Fix**: armar el `ORDER BY` por partes (sólo columnas/expresiones válidas) y usar `MASCARA_DEFAULT`.
- **Commit**: `c58dffe`

### 🐛 Calendario de descarga SAT todo gris (ningún día marcado)
- **Síntoma**: el calendario de cobertura de XML salía completamente gris aunque había XML descargados.
- **Causa**: una columna `::date` de node-postgres regresa un objeto **Date** de JS, no un string. `String(date).slice(0,10)` daba `"Wed Jan 02"`, que nunca casa con las claves `YYYY-MM-DD` del calendario.
- **Fix**: `TO_CHAR(COALESCE(fecha_emision,fecha_timbrado),'YYYY-MM-DD')` en las tres queries de cobertura. Además calendario combinado (emitidos+recibidos) con conteo por día.
- **Commit**: `7a5e1cc` (combinado en `6fa73bb`)

### 🐛 Conciliación: `invalid input syntax for type date: 'Tue Jan 02'`
- **Síntoma**: «Contabilizar» un movimiento del estado de cuenta reventaba con ese error.
- **Causa**: mismo origen que el calendario — `contabilizar` usaba `String(m.fecha)` sobre un objeto Date de node-postgres.
- **Fix**: `TO_CHAR(bm.fecha,'YYYY-MM-DD') AS fecha_ymd` y usar ese string para la póliza.
- **Commit**: `78bfd30`

### 🐛 Nómina: sólo 3 expedientes de 6 trabajadores
- **Síntoma**: al importar el respaldo de nómina, la mitad de los trabajadores no generaba expediente.
- **Causa**: la zona se importaba como `'frontera'`, que viola el `CHECK` `nomina_empleados_zona_ck` (el valor válido es `'frontera_norte'`) → los empleados de esa zona se rechazaban.
- **Fix**: mapear a `'frontera_norte'`. Aparte: percepciones/deducciones negativas violaban el `CHECK` de montos (totales ≥ 0); se voltean al lado correcto.
- **Commit**: `78bfd30`

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
