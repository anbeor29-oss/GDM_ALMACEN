# POS — Lector de código de barras + impresora de tickets (plan)

> Decisión del usuario (2026-10-06): **USB para ambos**. Lector USB y **impresora USB**, sin cámara
> y sin agente local salvo como respaldo. Trabajo en **dev**; a producción sólo con visto bueno.

## Qué hay hoy

- **Pantalla:** `frontend/src/pages/PointOfSale.tsx`. Carrito + ventas del día + cobro (descuenta
  inventario) + factura individual o global diaria.
- **Ticket:** YA se imprime, a 58 mm, con `window.print()` sobre una ventana nueva (`imprimirTicket`).
- **Búsqueda de producto:** `api.getProducts(1,8,search)` → `products.service.ts` busca por
  `name / sku / clave_sat` (línea del `WHERE`), **no por barcode**.
- **Código de barras:** la columna **`products.barcode VARCHAR(64)` YA EXISTE** con índice
  `idx_products_barcode (company_id, barcode)` (migración `2026-07-10_inventory_core.sql`). Pero:
  - el alta/edición de producto (`frontend/src/pages/Products.tsx`) **no la captura**;
  - la búsqueda **no la usa** (el placeholder de `Inventory.tsx` ya la promete, pero no está cableada).

Conclusión: esto es **cablear lo que falta**, no construir de cero.

## El lector (USB) — sin complicaciones

Un lector USB se comporta como **teclado** (keyboard-wedge): "teclea" el código y da Enter. **No
necesita drivers ni permisos.** Se captura en el front con un listener que detecta una ráfaga de
teclas terminada en Enter y la trata como escaneo. Sirve con casi cualquier lector USB del mercado.

## La impresora (USB) — advertencia técnica importante

Imprimir directo a una térmica USB **desde el navegador** tiene un matiz en Windows:

- **WebUSB** puede hablar con dispositivos USB, **pero** en Windows una impresora instalada como
  "impresora USB" queda tomada por el driver del sistema (`usbprint.sys`) y WebUSB **no puede
  reclamar** la interfaz (habría que reemplazar el driver con WinUSB/Zadig — inviable para el usuario).
- **Web Serial** sí funciona si la térmica expone un **puerto COM** (USB-serie), que es lo más común
  en impresoras de ticket genéricas y en muchas Epson/Star.

Por eso la estrategia es una **cadena de intentos**, no un solo camino:

1. **Web Serial** (`navigator.serial.requestPort`) si la impresora da puerto COM → ESC/POS directo,
   sin diálogo, con corte de papel y cajón.
2. **WebUSB** (`navigator.usb.requestDevice`) si el SO no la tomó.
3. **Fallback `window.print()`** a la impresora USB **ya instalada** en Windows (silencioso con modo
   kiosco / impresora por defecto). Es lo que hay hoy, pulido.

> "Buscar impresora" en web **no** es listar en silencio las impresoras del sistema (privacidad): es
> un **selector de dispositivo** con permiso del usuario (Chrome/Edge, HTTPS, un gesto). Se elige una
> vez y se recuerda por caja.

Para impresión 100 % silenciosa **garantizada** a una USB instalada en Windows, el camino sólido es un
**agente local (QZ Tray)** — queda como **opción 2C** si el cliente lo pide. Recomendación práctica:
probar primero si la térmica del cliente da **COM** (Web Serial), que cubre la mayoría.

---

## Fases

### Fase 0 — Dato del producto (~½ día)
- Exponer **código de barras** en el alta/edición de producto (`frontend/src/pages/Products.tsx`).
- Backend: agregar `barcode` al `WHERE` de búsqueda en `products.service.ts` (hoy `name/sku/clave_sat`).
  Arreglar el placeholder de `Inventory.tsx` que ya lo promete.
- **Tablas:** `products` — **sin cambio de columna** (ya tiene `barcode`). *Opcional:* índice único
  parcial `UNIQUE (company_id, barcode) WHERE barcode IS NOT NULL`, con migración que primero detecte
  duplicados; si los hay, se queda el índice no único actual y el choque se resuelve en pantalla.

### Fase 1 — Escaneo en el POS (~1–2 días)
- Backend: endpoint exacto `GET /pos/scan?code=…` → **un** producto por barcode exacto (fallback a SKU
  exacto), con precio y existencia del almacén.
- Front (`PointOfSale.tsx`): listener de escáner **siempre activo** mientras el POS está abierto
  (aunque el foco no esté en el buscador). Al escanear: existe → agrega/incrementa en el carrito con
  feedback (línea parpadea verde + "bip" WebAudio); no existe → aviso "código no encontrado, ¿darlo de
  alta?". Se conserva la búsqueda por texto para lo manual.
- **Tablas:** ninguna nueva.

### Fase 2 — Ticket e impresora USB (~2–4 días)
- **2A · Pulir ticket:** encabezado con razón social/RFC/sucursal, logo opcional, ancho **58/80 mm**
  configurable, nota "no es comprobante fiscal", **"auto-imprimir al cobrar"**.
- **2B · Impresora USB directa:** botón **"Buscar impresora"** → cadena **Web Serial → WebUSB →
  `window.print()`** (ver arriba). ESC/POS (texto + corte + cajón). La elegida se recuerda **por caja**
  (localStorage); si no hay o el navegador no soporta, cae a `window.print()`.
- **2C · (Opcional):** agente local **QZ Tray** para impresión silenciosa garantizada a la USB
  instalada, si lo piden.
- **Tablas:**
  - **Nueva `pos_config`** (`company_id` PK, `paper_width` 58/80, `ticket_header`, `ticket_footer`,
    `show_logo` bool, `auto_print` bool, `drawer_kick` bool, `updated_at`) — plantilla del ticket a
    nivel empresa.
  - La **impresora elegida** NO va en BD (el dispositivo Web Serial/USB es por navegador) → localStorage
    por caja.
  - *Opcional:* `pos_sales.printed_at` para reimpresiones.
  - *Opcional (multi-EAN):* `product_barcodes (product_id, barcode, factor)` si un producto tiene varias
    presentaciones/códigos.

## Apariencia de la pantalla
- **Barra de escaneo** destacada arriba del carrito con indicador **"Modo escáner activo"** (ícono de
  código de barras); el buscador de texto queda para lo manual.
- Al escanear, la línea agregada **parpadea verde** + bip.
- Encabezado: chip **"Impresora: [nombre / –]"** con **"Buscar impresora"** y engrane **"Config.
  ticket"** (ancho 58/80, encabezado, auto-imprimir).
- Toggle **"Auto-imprimir al cobrar"**.
- Botones de cantidad **grandes** (mostrador/táctil).

## Riesgos / notas
- Web Serial/WebUSB: **solo Chromium** (Chrome/Edge), **HTTPS** y **gesto del usuario**; sin
  enumeración silenciosa. Fuera de eso → `window.print()`.
- Barcodes **duplicados** en datos legacy: resolver antes de cualquier índice único.
- La térmica del cliente decide la ruta (COM vs USB puro): conviene confirmar el modelo.

## Estimado
~1 semana para Fases 0–2 (sin el agente local 2C).
