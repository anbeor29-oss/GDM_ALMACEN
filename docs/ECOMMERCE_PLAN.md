# GDM NEXO — Plan de trabajo: módulo **Comercio Electrónico**

**Archivo:** `docs/ECOMMERCE_PLAN.md` · **Fecha:** 21 de octubre de 2026 · **Estado:** plan para validar contigo
**Base:** analiza y aterriza `E:\Banco\e_comer.md` a la arquitectura REAL de NEXO.

> Este plan responde a tus dos condiciones:
> **A) Aprovechar la estructura de la base de datos** de NEXO (no duplicar productos, inventario, clientes, CFDI, tesorería).
> **B) Módulo 100% aparte**: un usuario que yo dé de alta en Comercio Electrónico **no ve nada más que ese módulo**; y
> yo como **SUPER_ADMIN (despacho contable) veo todos los módulos**.

### Decisiones tomadas (2026-10-21)
1. **Operación: Tienda + productos/inventario.** El módulo **embebe** la gestión de productos e inventario (como pestañas
   DENTRO de Comercio Electrónico) para que el merchant sea autónomo. Importante: **sobre las MISMAS tablas** `products`/
   `inventory` (no copia) — el despacho ve esos mismos datos desde el ERP completo. Así se cumplen A y B a la vez.
2. **Segmento: B2C primero.** B2B (precios por cliente, cotizaciones, crédito) a fase 3.
3. **Pasarela inicial: Mercado Pago** (tarjeta, OXXO, SPEI, Meses Sin Intereses), con adaptador para sumar otras.
4. **Storefront: subdominio por tienda** (`tienda.hcgm.com.mx/<slug>`), multi-tienda desde el diseño.

Pendiente de cerrar: **el merchant piloto** (empresa/cliente real que arranca primero).

---

## 0. Lo que YA existe en NEXO y vamos a reutilizar (no inventar)

NEXO ya resuelve lo difícil. El e-commerce se monta ENCIMA, no al lado:

| Pieza de NEXO | Tabla/servicio real | Cómo la usa el e-commerce |
|---|---|---|
| **Productos** | `products` (con `barcode`, precio, unidad, impuestos) | Fuente de verdad de SKU, costo, precio e impuestos. La tienda sólo le agrega **contenido web** aparte. |
| **Clientes** | `customers` (`es_cliente`, RFC, régimen, CP) | El comprador web es un `customers`; no se duplica. Se le agrega una **cuenta web** (correo/clave). |
| **Inventario** | `warehouses` / `inventory` | Disponibilidad por almacén. Se agregan **reservas** para carrito/pedido. |
| **Facturación CFDI** | `invoices` + `pac.service` (SW Sapien) + `timbrado_ambiente` por empresa | Emite el CFDI del pedido web con el motor que ya timbra. |
| **Tesorería** | módulo `treasury`, conciliación bancaria | Concilia los depósitos de la pasarela contra pedidos y comisiones. |
| **Contabilidad** | `journal_entries`, motor de pólizas/cuadre | El pedido/cobro genera póliza con el motor existente. |
| **Multi-empresa** | `company_id` en todo + `despachos_contables` | Cada tienda pertenece a una empresa; el despacho (super admin) ve todas. |
| **Gating de módulos** | `companies.modulos_habilitados`, `users.work_group`/`extra_modules`, `requireModule`, `ModuleRoute`, `gated(mod)` | **Es justo el mecanismo que logra la condición B** (ver §2). |
| **Autenticación** | JWT (30d) + refresh reparado | El admin de tienda entra con el login de NEXO. El storefront público usa su propia sesión de comprador. |
| **POS** | `pos_sales`, `pos_sale_items` | Patrón ya probado de “venta” que podemos reutilizar para el pedido web. |

**Consecuencia:** la **Fase 0 (descubrimiento técnico)** del spec ya está, en gran parte, hecha — este documento la cierra.

---

## 1. Qué ES el módulo (alcance del cockpit)

**Comercio Electrónico** es un **cockpit autocontenido** dentro de NEXO: el merchant opera SU tienda **y gestiona sus
productos e inventario desde ahí**, sin ver el resto del ERP. El back-office pesado (CFDI, contabilidad, conciliación)
lo lleva el **despacho** sobre los mismos datos.

Pantallas del módulo (pestañas que ve el usuario del merchant — y **nada más**):
1. **Tiendas** — alta de tienda, subdominio, moneda, zona horaria, logo/colores (branding), políticas (envío, cambios, devoluciones, privacidad).
2. **Productos** *(embebido)* — alta/edición de producto sobre la tabla real `products` (SKU, código de barras, precio, unidad, impuestos). Reusa el servicio de productos del ERP; el despacho ve lo mismo desde el módulo Productos.
3. **Inventario** *(embebido)* — existencias por almacén sobre `warehouses`/`inventory`: entradas, ajustes y consulta. Mismos datos que ve el despacho.
4. **Catálogo web** — elige qué productos salen a la tienda; agrega fotos, descripción larga, SEO, precio web/promo y visibilidad (contenido web en `ec_product_channel`, sin tocar el maestro).
5. **Pedidos** — tablero con estados (`DRAFT`→…→`DELIVERED`/`RETURNED`), historial, guía de envío.
6. **Pagos** — operaciones de la pasarela (aprobadas, pendientes, rechazadas, reembolsos).
7. **Promociones** — cupones, ofertas con vigencia, envío gratis.
8. **Clientes web** — cuentas de compradores (ligadas a `customers`).
9. **Envíos** — método/costo, captura de guía, recoger en sucursal.
10. **Reportes** — ventas, conversión, carrito abandonado, stock bajo.

**Clave del aislamiento (B):** Productos e Inventario se montan como **pestañas dentro del módulo Comercio Electrónico**
(rutas y endpoints protegidos por `requireModule('ecommerce')`), **no** como las entradas separadas del ERP. Así el
merchant con `modulos_habilitados=['ecommerce']` gestiona los datos reales **sin que aparezcan** los módulos Productos/
Inventario en su menú; el despacho (SUPER_ADMIN) sí los ve, sobre las mismas tablas.

El **storefront público** (la tienda que ve el comprador) es un sitio aparte servido por NEXO (ver §4).

---

## 2. Condición B — módulo 100% aislado (lo logra el gating que ya existe)

**No hay que inventar un sistema de permisos nuevo.** NEXO ya une rol + grupo + módulos por empresa:

1. **Nuevo `ModuleKey`: `ecommerce`** (etiqueta visible **“Comercio Electrónico”**). Se agrega a:
   - back: `MODULOS_VALIDOS` (admin-companies.routes), `requireModule('ecommerce')`, `gated('ecommerce')` al montar las rutas.
   - front: `ModuleKey`, `ModuleRoute module="ecommerce"`, entrada de sidebar (Layout) y rutas (ErpPrivado).
2. **Empresa “merchant” = `companies.modulos_habilitados = ['ecommerce']`.** Como el sidebar, `requireModule`, `canAccess`
   y `ModuleRoute` **ya respetan esa lista**, sus usuarios **ven SÓLO Comercio Electrónico** (más el tablero, que siempre
   está). **Cero código nuevo de aislamiento**: es el mismo mecanismo de [[usuarios-modulos-extra]].
3. **SUPER_ADMIN (despacho) ve todo** — el rol `SUPER_ADMIN` ya salta el gating. Ya funciona hoy.
4. **Sub-roles dentro de la tienda** (admin de tienda, ventas, almacén/surtido, finanzas, atención) — con `work_group`
   nuevos o capacidades (`capabilities`), fase 2. No bloquea el MVP.
5. **El merchant es un cliente del despacho**: encaja con `despachos_contables` — el despacho factura el servicio de
   e-commerce por el mismo motor de cobro por usuario ([[cobro-por-usuario-algoritmo]], [[despachos-contables]]).

> **Decisión tomada:** el módulo **embebe productos e inventario** (el merchant es autónomo). El aislamiento se mantiene
> porque esas pestañas viven **dentro** del módulo `ecommerce` y sus endpoints se protegen con `requireModule('ecommerce')`:
> el merchant NO ve las entradas separadas de Productos/Inventario, pero escribe en las **mismas tablas** que el despacho
> lee desde el ERP. Un poco más de trabajo (reusar los servicios de productos/inventario bajo el gate de ecommerce), pero
> cumple A (misma BD) y B (un solo módulo visible) a la vez.

---

## 3. Condición A — reutilizar la BD (qué se REUSA y qué tablas NUEVAS se agregan)

**Regla de oro:** NEXO manda en SKU, costo, precio, impuestos, inventario, cliente y CFDI. El e-commerce **sólo agrega
lo que NEXO no tiene** (contenido web, carrito, pedido espejo, reserva, pasarela, envío, devolución, promo).

**Tablas NUEVAS (todas con `company_id` + `store_id`, aislamiento estricto):**
- `ec_store`, `ec_store_domain`, `ec_store_settings` — la tienda y su configuración.
- `ec_product_channel` — contenido web por producto (visible/oculto, precio web, SEO) **ligado por `product_id`** (no copia el producto).
- `ec_product_media` — imágenes/documentos.
- `ec_category` — categorías de la tienda.
- `ec_cart`, `ec_cart_item` — carrito (persistente para registrados, temporal para invitado).
- `ec_order`, `ec_order_item`, `ec_order_status_history` — **pedido espejo** con **fotografía histórica** de precio/impuesto/dirección. Al confirmarse, se liga a `invoices`/venta.
- `ec_inventory_reservation` — reserva transaccional contra `inventory` (evita sobreventa).
- `ec_payment_transaction`, `ec_payment_settlement`, `ec_refund` — pasarela (monto, comisión, liquidación, reembolso).
- `ec_shipment`, `ec_shipment_event` — envío/guía.
- `ec_return_request`, `ec_return_item` — devoluciones.
- `ec_promotion`, `ec_coupon` — promociones.
- `ec_webhook_event`, `ec_sync_job`, `ec_audit_log` — eventos de pasarela, reconciliación, bitácora.

**Reusadas sin duplicar:** `products`, `customers`, `warehouses`/`inventory`, `invoices`, `treasury`, `journal_entries`.

**Disponible para venta** = `física − comprometido − reservado − stock_seguridad` (la fórmula final se ajusta a las reglas
reales de Inventarios de NEXO). La caché de la tienda **nunca** es la existencia definitiva: antes de confirmar se
**revalida/reserva** contra el servicio de inventario (transacción + idempotencia).

---

## 4. Arquitectura técnica (encaja en el monorepo actual)

- **Backend:** nuevo módulo `backend/src/modules/ecommerce/*` con **tres superficies**:
  1. **Admin API** (gated `requireModule('ecommerce')`) — lo que usa el cockpit.
  2. **Storefront API** (pública, acotada por tienda/dominio, con rate-limit e idempotencia) — catálogo, carrito, checkout, pedido.
  3. **Webhooks** (`/webhooks/payments/:provider`) — firmados, idempotentes, con cola de reintentos y reconciliación.
- **Adaptador NEXO** (interno): lee productos/stock/cliente y crea pedido→venta→CFDI→póliza→tesorería reutilizando los servicios existentes.
- **Adaptador de pago** (interfaz común, 1 pasarela primero): checkout **tokenizado/alojado** del proveedor. **NEXO nunca guarda PAN ni CVV.**
- **Frontend:**
  - **Cockpit** = pantallas React dentro del ERP (mismo Vite/Tailwind/react-query, patrón de pastillas de colores [[opciones-menu-colores]], fechas DD/MM/AAAA [[fecha-formato-ddmmaaaa]]).
  - **Storefront público** = sitio nuevo servido por NEXO, **multi-tienda por subdominio** (`tienda.hcgm.com.mx/<slug>` o dominio propio del cliente), **mobile-first**.
- **Sincronización:** eventos cuando se pueda + consultas incrementales por `updated_at` + **reconciliación periódica** (no depender sólo de webhooks).

---

## 5. Tendencias (investigadas) → cómo se traducen en diseño y modernidad

Investigación oct-2026 (fuentes al final; cifras de blogs/reportes, direccionales):

- **Móvil primero:** ~**78.5 %** de las compras de e-commerce en México son por celular → **diseño mobile-first no negociable**, checkout de una sola página, mínimos campos, pago como invitado.
- **Social commerce en México:** mercado ~**US$55.8 mil M (2026) → ~96.9 mil M (2031)**, +11.7 %/año. **TikTok Shop** llegó a México (feb-2025); **Meta (WhatsApp/Instagram/Facebook)** domina adquisición y conversión → integrar **botón “Comprar por WhatsApp”**, **catálogo exportable a Instagram/Facebook Shops**, y dejar la puerta a **TikTok Shop** (fase posterior).
- **Métodos de pago que el comprador mexicano espera:** tarjeta, **SPEI (transferencia)**, **OXXO (efectivo)**, **Meses Sin Intereses (MSI)** y **BNPL** (compra ahora, paga después) en crecimiento → el adaptador debe soportar pagos **asíncronos** (OXXO/SPEI se confirman horas después; nunca marcar pagado por volver a la página de “éxito”, sólo por webhook firmado).
- **Live shopping:** en Latinoamérica **Instagram** es la plataforma dominante de compras en vivo → fase de diferenciación (video + carrito en vivo).
- **Confianza y velocidad:** mostrar envío/devoluciones visibles, reseñas, carga rápida; **personalización con IA** ya es expectativa, no lujo → buscador bueno primero, recomendaciones después.
- **Diseño:** sistema de diseño reutilizable, **branding por tienda** (logo/colores del merchant), tema claro/oscuro, componentes accesibles.

---

## 6. Plan de trabajo por fases (aterrizado a NEXO)

> Sin fechas cerradas: integración, QA, seguridad y homologación fiscal/pasarela suelen subestimarse. Cada fase tiene **criterio de salida**.

### Fase 0 — Cierre técnico *(casi listo: lo cubre este documento)*
- Confirmar fórmula real de disponibilidad y la transacción de reserva/descuento en `inventory`.
- Confirmar el punto de enganche con `invoices`/`pac.service` para el CFDI del pedido.
- Elegir **1 merchant piloto** y su flujo (B2C).
- **Entregable:** este plan aprobado + contratos de datos.

### Fase 1 — MVP B2C (P0)
- `ModuleKey ecommerce` + gating (condición B: el usuario merchant ve **sólo** Comercio Electrónico).
- **Productos e Inventario embebidos** (pestañas del módulo, gated `ecommerce`, sobre `products`/`inventory` reales).
- Alta de **tienda** + branding + 1 almacén habilitado + **subdominio** (`tienda.hcgm.com.mx/<slug>`).
- **Catálogo web** sobre `products` (publicar, fotos, precio web, SEO).
- **Storefront** mobile-first: catálogo, búsqueda simple, carrito, **checkout de 1 página**, pago como invitado.
- **Mercado Pago** con checkout tokenizado/alojado (tarjeta, OXXO, SPEI, MSI) + **webhook firmado** (pago asíncrono real).
- **Reserva transaccional** de stock + idempotencia (anti-sobreventa).
- **Pedido** con estados + fotografía histórica, integrado a Ventas/`invoices`.
- Tablero de pedidos + bitácora + reconciliación mínima.
- **Criterio de salida:** pasan pruebas de sobreventa concurrente, pago tardío (OXXO/SPEI), webhook repetido/fuera de orden, reserva vencida, pedido duplicado.

### Fase 2 — Operación comercial (P1)
- **Tesorería/conciliación** de liquidaciones y comisiones.
- **CFDI** del pedido con el motor y el ambiente (PRUEBAS/PRODUCCIÓN) de la empresa.
- **Envíos** (costo/guía/sucursal), **promociones** (cupones/ofertas), **reportes**.
- **Alertas de stock bajo** → propuesta de compra aprobable (conecta con Compras).
- **Devoluciones** controladas (reingreso a inventario sólo tras inspección).
- **Social:** botón WhatsApp + exportar catálogo a Meta Shops.

### Fase 3 — Diferenciación (P2/P3)
- **B2B:** catálogos privados, precios por cliente/lista, cotizaciones→pedido, compra por SKU en lote, crédito con autorización (usa `customers`/listas).
- Multi-almacén avanzado y surtido parcial; más pasarelas; **TikTok Shop / marketplaces**; **live shopping**; portal de proveedores; personalización con IA.

---

## 7. Seguridad y cumplimiento (desde el día 1)
- **Nunca** guardar PAN/CVV; checkout tokenizado del proveedor (PCI minimizado, no eliminado).
- Webhooks **firmados + idempotentes + anti-repetición**; secretos por empresa/tienda/ambiente en gestor seguro, nunca en el repo.
- **Aislamiento multi-tenant probado** en API y BD (un merchant no lee datos de otro).
- Idempotencia en crear pedido/cobro/reembolso; claves únicas `(company_id, store_id, external_order_id)`.
- Aviso de privacidad, términos, políticas de envío/cambios/devoluciones; LFPDPPP y protección al consumidor (MX).

---

## 8. Riesgos principales
Sobreventa (reserva transaccional + pruebas de concurrencia) · pedidos/cobros duplicados (idempotencia + conciliación) ·
webhooks perdidos/repetidos (firma + reintentos + reconciliación) · descuadre de tesorería (modelo separado pago/comisión/liquidación) ·
error fiscal (revisión por especialista + anti-duplicado CFDI) · acceso cruzado entre empresas (tenant aislado y probado) ·
dependencia de una pasarela (adaptador común + 2º proveedor a futuro) · exceso de alcance (MVP acotado por criterios de salida).

---

## 9. Decisiones
**Cerradas (2026-10-21):** (1) operación = **tienda + productos/inventario embebidos**; (2) **B2C** primero; (3) pasarela
= **Mercado Pago**; (4) storefront = **subdominio por tienda**.

**Pendiente:** (5) **merchant piloto** — ¿qué empresa/cliente real arranca primero? Y, cuando toque programar la pasarela,
conseguir la **cuenta de Mercado Pago + credenciales sandbox** del piloto.

---

## 10. Fuentes (validar al implementar)
- Mexico Social Commerce Report 2026 (Yahoo Finance / ResearchAndMarkets) · marketing4ecommerce.mx · orbis.agency · pangostudio.com
- UX/diseño: cleverence.com, techwyse.com, makdigitaldesign.com · Live commerce: getstream.io, videowise.com, marketingltb.com
- Pasarelas: Conekta, Mercado Pago, Stripe, Openpay, PayPal (docs oficiales) · PCI DSS · OWASP ASVS · SAT

---

## 11. Bitácora de construcción (se avanza ~1.5 h/semana, en paralelo al pulido de NEXO)

### Rebanada 1 — Base + aislamiento del módulo · **HECHO 2026-10-22**
- **Backend:** `ModuleKey 'ecommerce'` en `middleware/permissions.ts` (+ `ALL_MODULES`); `'ecommerce'` en `MODULOS_VALIDOS`
  (admin-companies); nuevo módulo `modules/ecommerce/ecommerce.routes.ts` con `GET /ecommerce/estado`, montado en `app.ts`
  con `gated('ecommerce')` (authenticateToken + requireModule).
- **Frontend:** `ModuleKey 'ecommerce'` + `MODULE_LABELS` ('Comercio Electrónico') en `utils/permissions.ts`; NavItem en
  `Layout` (`show('ecommerce')`, ícono 🛒, acento esmeralda); ruta `/ecommerce` en `ErpPrivado`; **hub**
  `pages/ecommerce/EcommerceHub.tsx` (encabezado con gradiente + 10 tarjetas de sección «Próximamente», mobile-first);
  `'ecommerce'` agregado a `MODS_TOGGLE` (Editar empresa); `api.getEcommerceEstado()`.
- **Aislamiento (condición B) — por diseño, sin permisos nuevos:** una empresa con `companies.modulos_habilitados=['ecommerce']`
  hace que su usuario ADMIN vea **SÓLO Comercio Electrónico** (lo resuelve el gating que ya existe: `requireModule` back +
  `show()`/`ModuleRoute` front). SUPER_ADMIN/despacho ve todo. **No** se agregó `WorkGroup` nuevo (no hace falta en esta etapa).
- **Cómo probarlo tras desplegar:** Empresas → Editar empresa → en «Módulos» marcar **sólo** «Comercio Electrónico» →
  entrar como admin de esa empresa (o impersonar) → el menú muestra únicamente esa entrada y abre el hub.
- **Estado:** typecheck (back+front) y `build:hosting` OK.

### Rebanada 2 — Tiendas (alta/edición/baja) · **HECHO 2026-10-22**
- **Migración** `2026-10-22_ecommerce_tiendas.sql`: tabla **`ec_store`** (company_id, nombre, **slug=subdominio** único global,
  moneda, zona_horaria, branding `logo_url`/`color_primario`/`color_secundario`, políticas de envío/devolución/privacidad/
  términos, `activa`, soft-delete). Índice único parcial `lower(slug)` entre tiendas vivas.
- **Backend:** `ecommerce-tiendas.service.ts` (listar/contar/crear/actualizar/eliminar; valida slug como subdominio y su
  unicidad, normaliza acentos) + rutas `GET/POST/PUT/DELETE /ecommerce/tiendas` (gated `ecommerce`, acotadas por
  `companyId`); `/ecommerce/estado` ya cuenta tiendas reales.
- **Frontend:** `pages/ecommerce/Tiendas.tsx` (lista con tarjetas de gradiente del branding + modal de alta/edición:
  nombre, subdominio con preview `tienda.hcgm.com.mx/<slug>` y auto-sugerencia desde el nombre, moneda, colores con
  `input[type=color]`, logo, políticas colapsables); ruta `/ecommerce/tiendas`; la tarjeta «Tiendas» del hub ya es
  navegable y marcada «Disponible»; `api.listTiendas/crearTienda/actualizarTienda/eliminarTienda`.
- **Estado:** typecheck (back+front) y `build:hosting` OK. La migración corre sola en Render al desplegar.

### Rebanada 3 — Productos/Inventario embebidos + Catálogo web · **HECHO 2026-10-22**
- **Productos (embebido):** `GET/POST/PUT/DELETE /ecommerce/productos` **reusan `products.service`** del ERP (listProducts/
  createProduct/updateProduct/deleteProduct) bajo el gate `ecommerce` → el merchant administra la MISMA tabla `products`
  sin ver el módulo Productos del ERP. Pantalla `pages/ecommerce/Productos.tsx` (lista + buscador + modal lean: nombre,
  SKU auto, precio, código de barras, clave SAT/unidad con genéricos editables + aviso de que el despacho las ajusta).
- **Inventario (embebido, lectura):** `GET /ecommerce/inventario` lee `warehouse_stock`×`products`×`warehouses` (existencias
  por almacén + total por producto). Sólo consulta: los movimientos con capas de costo siguen en el ERP (no romper kardex).
  Pantalla `pages/ecommerce/Inventario.tsx`.
- **Catálogo web (núcleo):** migración `2026-10-22b_ecommerce_catalogo.sql` con **`ec_product_channel`** (publicado,
  destacado, precio_web, titulo_web, descripcion_web, SEO; **liga por product_id, NO copia** — campo web NULL = usa el
  maestro). Servicio `ecommerce-catalogo.service` (listar overlay, upsert web, toggle publicar, contar publicados) +
  rutas `/ecommerce/catalogo`. Pantalla `pages/ecommerce/CatalogoWeb.tsx` (interruptor de publicado por producto, precio
  web opcional, destacado, descripción y SEO; filtro «sólo publicados»). `/estado` ya cuenta publicados.
- Las tres tarjetas del hub (Productos/Inventario/Catálogo web) quedan «Disponible» y navegables.
- **Estado:** typecheck (back+front) y `build:hosting` OK; migración corre sola en Render.
- **Siguiente (rebanada 4):** **storefront público** (catálogo→carrito→checkout) + **reserva transaccional** de stock.
