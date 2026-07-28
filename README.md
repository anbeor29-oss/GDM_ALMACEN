# GDM_FAC V2 — Facturación CFDI 4.0 + Complemento Carta Porte 3.1

Sistema de **facturación electrónica CFDI 4.0** para México **con Complemento Carta Porte 3.1**.
Backend Node/Express + TypeScript, frontend React + Vite, PostgreSQL 16. Integrado con
**SW Sapien** como PAC para timbrado real.

**Estado** (al 2026-07-27):
- 🟢 **Producción** — FACTURANDO REAL con **GRUPO HCGM** desde 2026-07-17 · SW Sapien production.
- 🟢 **V2 desplegada en sitio** — se decidió actualizar los servicios existentes de Render en lugar de levantar un par nuevo. Todo vive en `origin/main`; la rama `v2-carta-porte` quedó absorbida.
- 🟡 **`hcgm.com.mx/erp`** — el hosting de México se actualiza subiendo el .zip del build; verificar que sirva la versión vigente después de cada release.

---

## 🆕 Novedades de V2

Todo lo de V1 sigue igual (facturación, NC, clientes, productos, reportes, contrato, importador CFDI, admin). Se **agregan** los siguientes módulos y arreglos:

### Complemento Carta Porte 3.1 (Anexo 20 SAT)
- **Página `/carta-porte`** — dashboard con lista de facturas con CP y accesos rápidos.
- **`/carta-porte/lugares`** — catálogo de ubicaciones frecuentes (Origen/Destino) con CP-autofill de colonia/municipio/localidad desde catálogos SAT.
- **`/carta-porte/vehiculos`** — catálogo de vehículos con placa, config vehicular, permiso SCT, año, peso bruto, aseguradoras.
- **`/carta-porte/aseguradoras`** — catálogo de pólizas por tipo (RespCivil / MedAmbiente / Carga).
- **`/carta-porte/operadores`** — catálogo de figuras de transporte (operador, propietario, arrendador, notificado).
- **`/carta-porte/mercancias`** — módulo SEPARADO de Productos: catálogo (plantilla reusable) + bitácora por viaje para inspecciones SAT.
- **`/invoices/:id/carta-porte`** — formulario completo del CP: ubicaciones, mercancías, medio de transporte, figuras. Con "Cargar plantilla" en cada bloque.
- **Builder XML CP 3.1** + validator (Matriz de Errores SAT) + timbrado sandbox.
- **Sección CP en el PDF** — hoja 2 con QR y datos del complemento, hoja 3 con las 14 cláusulas del contrato de transporte.

### Carta Porte internacional y multimodal

Las cuatro modalidades del SAT, exclusivas entre sí (`c_CveTransporte`):

| Clave | Modalidad | Qué captura |
|---|---|---|
| `01` | Autotransporte | Config vehicular, placa, permiso SCT, seguros, remolques |
| `02` | Marítimo | Embarcación (OMI, eslora/manga/calado), agente naviero, viaje, conocimiento de embarque, contenedores con precinto |
| `03` | Aéreo | Aeronave, guía aérea, código de transportista, embarcador |
| `04` | Ferroviario | Tipo de servicio y tráfico, derechos de paso, carros con sus contenedores |

Al marcar **Transporte internacional = Sí** aparece el bloque de comercio
exterior: entrada/salida, país extranjero, régimen aduanero (varios, filtrados
por sentido de la operación) y cruce fronterizo. La **vía de entrada/salida se
toma del medio elegido** — declarar una y capturar otra es rechazo del PAC.

Cada mercancía puede llevar su propia **documentación aduanera** (pedimento o
permiso): va por mercancía, no por carta porte, porque un embarque puede
mezclar mercancías con pedimentos distintos y mercancías nacionales.

Los **domicilios extranjeros** no se validan contra el catálogo mexicano: fuera
de México se pide el RFC genérico `XEXX010101000` más el registro tributario
(Tax ID / EIN) y la residencia fiscal. Igual para las figuras de transporte —
a un operador de EUA no se le exige RFC mexicano.

Catálogos propios: `sat_cp_pais` (ISO 3166-1 alfa-3), `sat_cp_estado`
(México + EUA + Canadá, con PK por país) y `cp_cruce_fronterizo` (8 cruces
México–EUA, ayuda de captura que no viaja al SAT).

**Punto de entrada/salida** — el combo se adapta al medio elegido:

| Medio | Qué ofrece |
|---|---|
| Autotransporte y Ferroviario | los 8 cruces carreteros México–EUA |
| Marítimo | 123 puertos del catálogo SAT |
| Aéreo | 2 346 aeropuertos del catálogo SAT |

Fuera del autotransporte, cada Ubicación captura además su propia estación
(`TipoEstacion`, `NumEstacion`, `NombreEstacion`) — el puerto de origen no es
el mismo que el de destino. La búsqueda ignora acentos: "lazaro" encuentra
Lázaro Cárdenas.

**Pendiente**: el expediente multimodal por tramos (§13 del documento de
diseño) — hoy cada tramo de un traslado encadenado se captura como una carta
porte independiente.

### Tipos de cambio y diferencia cambiaria

Servicio central para facturar en **MXN, USD, EUR y GBP**. Es el único
componente que sale a internet; el resto del ERP lee de la base.

**Qué valor se usa.** El del DOF: el FIX que Banxico determinó el día hábil
anterior, que es lo que pide el Art. 20 del CFF. Se guardan las dos fechas —
la de determinación y la de vigencia — para poder rehacer el cálculo en una
auditoría.

**Lo facturado contra lo pagado.** El tipo de cambio se congela dos veces: al
emitir y al cobrar. Se facturan 1 000 USD a 17.50 (17 500 pesos) y quince días
después cobran a 18.00 (18 000 pesos): llegaron los mismos dólares pero 500
pesos más. Esa diferencia queda registrada por separado, con su detalle por
pago y su reporte por periodo exportable a CSV. En pagos parciales se compara
solo la porción cobrada.

**Nunca detiene una factura.** Si Banxico no responde se usa el último valor
vigente, se marca como arrastrado y queda la advertencia en la bitácora; se
reintenta una vez a los 30 minutos. La captura manual está siempre disponible.

Pantallas: **Monedas → Tipos de cambio** (cuadro del día, captura manual,
histórico y bitácora) y **Monedas → Diferencia cambiaria** (utilidad, pérdida,
efecto neto y detalle por pago).

Configuración: `BANXICO_TOKEN` en el entorno activa el cron de lunes a viernes
a las 12:05 hora de México. Las series SIE viven en `exchange_rate_sources`,
editables sin deploy.

> **Pendiente de verificar**: la serie de USD es `SF43718` (FIX, alta
> confianza). Las de EUR y GBP quedaron tentativas — conviene confirmarlas
> contra el catálogo SIE de Banxico antes de confiar en el automático. Se
> corrigen con un UPDATE a `exchange_rate_sources`, sin tocar código.

### Tablas nuevas en la base

| Tabla | Para qué |
|---|---|
| `cp_regimenes_aduaneros` | régimen aduanero como colección, no un solo valor |
| `cp_mercancia_doc_aduanera` | pedimento o permiso, colgado de la mercancía |
| `cp_ferroviario` + `_derechos_paso` + `_carros` + `_contenedores` | modalidad 04 |
| `cp_maritimo` + `_contenedores` | modalidad 02 |
| `cp_aereo` | modalidad 03 |
| `cp_cruce_fronterizo` | 8 cruces México–EUA (catálogo propio, ayuda de captura) |
| `sat_cp_pais` | 66 países en ISO 3166-1 alfa-3 |
| `sat_cp_estado` | 97 estados con PK (clave, país): MEX + USA + CAN |
| `exchange_rates` | histórico diario de tipos de cambio |
| `exchange_rate_sources` | series de Banxico, editables sin deploy |
| `exchange_rate_log` | bitácora de cada intento de actualización |
| `v_diferencia_cambiaria` | vista: facturado vs cobrado, con su efecto |

Columnas agregadas: `carta_porte.medio_transporte`, `invoices.total_mxn` /
`subtotal_mxn` / `exchange_rate_date`, `payments.exchange_rate` /
`exchange_rate_date` / `payment_amount_mxn`.

### Super Lector XML (`/xml-super-import`)
Reemplaza el importador CFDI clásico. Un solo lector que detecta y procesa:
- CFDI 4.0 puro
- CFDI + Complemento Carta Porte 3.1
- CFDI + Complemento Nómina 1.2 (solo detecta + guarda metadata)
- CFDI + Complemento de Pagos 2.0 (detecta)
- Notas de Crédito

**Modo lote**: acepta hasta 5 XMLs. Analiza todos, dedup entre archivos y contra la BD, muestra preview consolidado por tipo de entidad (👥 parties · 📄 productos · 📦 mercancías · 📍 lugares · 🚚 vehículos · 🛡️ aseguradoras · 👤 operadores) con checkbox por ítem, marca en verde los que ya existen y pre-desmarca. Un solo click "Importar lo seleccionado" ejecuta la creación de todos los ítems marcados.

### Catálogos SAT cargados (dos bugs del seed corregidos)

`sat_cp_colonia` (144,718), `sat_cp_municipio` (2,453), `sat_cp_localidad` (661),
`sat_cp_estaciones` (5,279: 123 puertos + 2,346 aeropuertos + 2,811 estaciones
ferroviarias), `sat_cp_config_autotransporte` (33), más los de CFDI 4.0.

**Bug 1 — columnas invertidas.** El seed original de gdmalmacen intercambiaba
`codigo_postal ↔ descripcion` en `sat_cp_colonia` y `estado ↔ descripcion` en
`sat_cp_municipio`/`sat_cp_localidad`. Corregido con `fix-cp-swap.js`,
idempotente y cableado a `start:prod`.

**Bug 2 — una clave perdida por catálogo (34 en total).** `apply-cp-seed.js`
partía el seed por `;\n` y descartaba toda sentencia que empezara con `--`.
Como el comentario que encabeza cada catálogo queda pegado al primer INSERT de
su bloque, ese INSERT se iba con el comentario. Las bajas eran justo las claves
de uso diario: `01 Pedimento`, `01 Operador`, `01 Autotransporte`,
`01 Origen Nacional`, `01 Materia prima`, `TPAF01`, `CTR001`… Sin `01 Pedimento`
la documentación aduanera era imposible de capturar. Parser corregido más
`fix-cp-catalogos-faltantes.js` en `start:prod`, porque `apply-cp-seed` se salta
el trabajo cuando `catalog_versions` ya tiene fila y las bases sembradas no se
repararían solas.

### Endpoints nuevos

**Carta Porte**
- `GET /carta-porte/cp/:codigoPostal` — colonias + estado inferido + municipios + localidades.
- `GET /carta-porte/catalogs/:name` — 35 catálogos SAT con búsqueda sin acentos. `?pais=` filtra estados.
- `GET /carta-porte/puntos-entrada-salida?medio=` — cruces (01/04), puertos (02) o aeropuertos (03).
- `GET /carta-porte/estaciones?medio=` — estaciones para `NumEstacion` de una ubicación (02/03/04).
- `GET /carta-porte/cruces-fronterizos` — los 8 cruces México–EUA.
- `GET|PUT|DELETE /invoices/:id/carta-porte` · `/validate` · `/xml`.
- `GET /carta-porte/mercancias` · `/bitacora` · `DELETE`.
- Rutas de `carta-porte/*` (lugares, vehículos, aseguradoras, operadores, importar-xml, catalogos-empresa).

**Tipos de cambio**
- `GET /exchange-rates` — cuadro de las 4 monedas.
- `GET /exchange-rates/:moneda[?fecha=]` · `/:moneda/history` · `/log`.
- `POST /exchange-rates/update` — fuerza consulta a Banxico (solo ADMIN).
- `POST /exchange-rates/manual` — captura manual (solo ADMIN).
- `GET /fx-difference?desde=&hasta=&moneda=` · `/por-factura/:invoiceId`.

**Super Lector**
- `POST /xml-super-import/detect` · `/apply` · `/apply-selected` · `/check-existing`.

### PDF mejorado
- **Página 2 Carta Porte** con layout SAT: QR, IdCCP, Folio fiscal, RFC PAC, fecha timbrado, lugar expedición, barras oscuras con secciones (Autotransporte, Aseguradora, Vehículo, Figuras, Ubicaciones, Mercancías).
- **Página 3** con las 14 cláusulas completas del contrato de transporte que ampara la Carta Porte.
- **Ubicaciones con lookup automático** `(clave) Nombre` — clave SAT + descripción resuelta contra catálogo.
- **Sellos íntegros** en el TIMBRE FISCAL — antes se truncaban a 60 caracteres. Ahora wrap multilínea según Anexo 20 §III.A. Cadena original de certificación con formato correcto `||1.1|UUID|Fecha|PAC||SelloCFD|NoCertSAT||`.

### Sidebar reorganizado (más limpio, iconos 3D emoji)
Orden: 🏠 Dashboard · 🧾 Facturas · 🚚 Carta Porte (colapsable con Lugares/Vehículos/Aseguradoras/Operadores/Mercancías) · 📉 Notas de Crédito · 📦 Productos · 👥 Clientes · 📥 Lector de XML · 📊 Reportes · 💱 Monedas (colapsable con Tipos de cambio / Diferencia cambiaria) · 📜 Contrato.
- Iconos con `drop-shadow` CSS para look 3D.
- "Datos de la empresa" NO va en sidebar — vive en el top bar (botón *DATOS DE MI EMPRESA*) para no duplicar.
- Módulo "Usuarios" oculto en V2 (V2 se enfoca en facturación + CP, no gestiona equipos de empresa).

### Formulario CP mejorado (UX)
- **Fecha/hora salida-llegada** — split en 2 inputs (fecha calendario + hora reloj) porque `datetime-local` se cortaba visualmente en Chrome.
- **CP autofill** — al escribir CP 5 dígitos, colonia/municipio/localidad se convierten en combos con opciones del catálogo SAT. Estado se auto-infiere por rango de CP (mapa oficial 2 primeros dígitos). Debajo de cada combo aparece `Clave SAT: XXX` en rojo pequeño.
- **Pickers de plantilla** — "Cargar plantilla" en Mercancías, Autotransporte (vehículo), Aseguradora, Figura. Los pickers muestran ítems del catálogo con búsqueda, poblado por lo que se ha importado con el Super Lector.
- **Verde suave** en campos vacíos que el XML no trajo, con leyenda "verde = falta capturar".
- **Auto-numeración** OR000001/DE000001 al agregar ubicaciones.
- **Split time input** — evita corte visual del `datetime-local`.

### Manifiesto ante el PAC
- Sección **ManifestSigner** en el modal "DATOS DE MI EMPRESA" (top bar): firmar con e.firma FIEL una sola vez para autorizar a SW Sapien como PAC certificador. Backend rechaza timbrado si no está firmado (`428 Precondition Required`).

### Productos: fix silencioso del update
- El controller de update de productos ignoraba `basePrice` (mandaba camelCase pero el service esperaba `base_price`). Ahora normaliza camelCase→snake_case para 12 campos.
- Descripción SAT visible: al abrir un producto, "Clave Producto/Servicio" muestra `78101800 — Servicios de transporte de carga por carretera` en vez de `78101800 — 78101800`. Backend hace `LEFT JOIN` a `sat_catalogs` c_ClaveProdServ + `sat_cp_clave_prod_serv` y devuelve `clave_sat_description`.
- Preset fiscal `auto_carga` — al importar por Super Lector conceptos con SAT `78101xxx` o retIva>0, se crean con IVA 16% + Ret. IVA 4% automático (Autotransporte de carga).

### Ancho de columna corregido en Figuras del PDF
La columna "Datos" tenía 25pt (rompía "Licencia: LFD01120038" letra por letra). Ahora 95pt.

---

## Setup local V2 (Windows)

Requisitos:
- Node.js 18+ (probado con v24)
- PostgreSQL 16 instalado como servicio (usuario `postgres` con password conocida)
- Puerto 3001 (backend) y 5173 (frontend) libres

Pasos:

```bash
# 1) Clonar. Todo vive en main; la rama v2-carta-porte quedó absorbida.
cd /e/Obsidian/GDM_FAC_2
git checkout main

# 2) Crear BD vacía
export PGPASSWORD='tu_password'
psql -h localhost -U postgres -d postgres -c "CREATE DATABASE gdmfac_v2;"
psql -h localhost -U postgres -d gdmfac_v2 -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# 3) Configurar .env (ver backend/.env y frontend/.env de referencia)
#    DATABASE_URL=postgresql://postgres:tu_password@localhost:5432/gdmfac_v2
#    PAC_PROVIDER=MOCK   (o SW_SAPIEN + token para timbrar real)
#    BOOTSTRAP_ADMIN_EMAIL=admin@tudominio.local
#    BOOTSTRAP_ADMIN_PASSWORD=xxxx
#    VITE_API_BASE=http://localhost:3001
#    BANXICO_TOKEN=            (opcional — sin él, tipos de cambio a mano)

# 4) Aplicar migraciones y catálogos SAT
cd backend
DATABASE_URL='postgresql://postgres:tu_password@localhost:5432/gdmfac_v2' \
  node scripts/migrate-up.js
DATABASE_URL='postgresql://postgres:tu_password@localhost:5432/gdmfac_v2' \
  node scripts/apply-cp-seed.js
# ⚠ El apply-cp-seed carga 200K sentencias — tarda ~30 seg. Si falla por
# "valor demasiado largo", correr primero el widen (ver widen-sat-cp.js).

# 5) Los dos fixes del seed CP. Ambos son idempotentes y ya viven en
#    start:prod, así que en Render corren solos; en local hay que invocarlos.
DATABASE_URL='postgresql://postgres:tu_password@localhost:5432/gdmfac_v2' \
  node scripts/fix-cp-swap.js              # columnas codigo_postal ↔ descripcion
DATABASE_URL='postgresql://postgres:tu_password@localhost:5432/gdmfac_v2' \
  node scripts/fix-cp-catalogos-faltantes.js   # las 34 claves que el parser tiraba

# 6) Bootstrap admin/empresa demo
DATABASE_URL='postgresql://postgres:tu_password@localhost:5432/gdmfac_v2' \
  BOOTSTRAP_ADMIN_EMAIL=... BOOTSTRAP_ADMIN_PASSWORD=... \
  node scripts/bootstrap-env.js

# 7) Arrancar backend + frontend en 2 terminales
cd backend && npm run dev     # localhost:3001
cd frontend && npm run dev    # localhost:5173
```

Login: `admin@gdmfac2.local` / `admin1234` (o los que hayas puesto en el bootstrap).

## Deploy a Render

`start:prod` encadena todo lo que la base necesita antes de levantar el server,
así que un deploy normal no requiere pasos manuales:

```
migrate-up → apply-cp-seed → fix-cp-swap → fix-cp-catalogos-faltantes
           → bootstrap-env → node dist/index.js
```

Todos los scripts son idempotentes: correrlos de más no hace daño.

**Variables de entorno a revisar antes de un release:**

| Variable | Para qué | Si falta |
|---|---|---|
| `PAC_PROVIDER` + token | Timbrado real con SW Sapien | cae a MOCK |
| `BANXICO_TOKEN` | Actualización diaria de tipos de cambio | el cron no se registra; se capturan a mano |
| `ENABLE_BILLING_CRON` | Cierre mensual de facturación | el cron no corre |
| `ENCRYPTION_KEY` | CSD y contraseñas SMTP | no se pueden desencriptar |

**Una sola vez por contribuyente:** firmar el manifiesto SW Sapien desde el
modal *DATOS DE MI EMPRESA* con la e.firma FIEL.

**Después de cada release:** subir el .zip del build a `hcgm.com.mx/erp` y
comprobar que el navegador sirva el bundle nuevo — el `.htaccess` de SPA
devuelve 200 con HTML para cualquier archivo faltante, así que un asset que no
subió NO da 404 y el error pasa inadvertido.

---

## Estado histórico V1 (sin cambios)

---

## ⚠️ Lo primero: GDM_FAC es SOLO facturación

> Léelo antes de tocar código. Aquí se confundieron dos productos y costó una
> sesión entera de limpieza (BITÁCORA 2026-07-16).

**GDM_FAC factura. No maneja inventarios, ni compras, ni punto de venta.** Esos
módulos son del producto **ALMACEN**, que es **otro sistema, con otro repo y otra
base de datos**.

| | **GDM_FAC** (este repo) | **ALMACEN** (otro producto) |
|---|---|---|
| Ruta local | `E:\Obsidian\GDM_FAC` | `E:\Obsidian\ALMACEN\app` |
| Repo | `github.com/anbeor29-oss/GDM_FACT` (`origin`) | `github.com/anbeor29-oss/GDM_ALMACEN` (`gdmalmacen`) |
| Marca en pantalla | "GDM Facturación" | "GDM ALMACÉN" |
| Alcance | CFDI 4.0: facturas, NC, complementos, clientes, productos, reportes | Inventarios, almacenes, compras, POS, tesorería |
| Estado | En producción | En desarrollo |

### Los módulos que existen aquí

**Por grupo de trabajo (todos los usuarios de empresa):**
`dashboard` · `invoices` · `credit_notes` · `customers` · `reports` · `products`

Definidos en `frontend/src/utils/permissions.ts` y su **espejo obligatorio**
`backend/src/middleware/permissions.ts`. **Si cambias uno, cambia el otro.**

**Por ROL, solo para el ADMIN de la empresa** (no pasan por grupo de trabajo —
son autoridad, no módulos): **Usuarios** (`/team`) y **Contrato** (`/contract`).

**No agregues aquí módulos de ALMACEN.** Hasta el 2026-07-16 el menú anunciaba
Inventarios, Almacenes, Inventario físico, Compras, Órdenes de compra y
Tesorería como pantallas `ComingSoon` ("Próximamente"): el sistema prometía lo
que no tenía y confundía al usuario. Se eliminaron junto con sus rutas. Punto de
Venta y Proveedores sí funcionaban, pero también se retiraron por pertenecer a
ALMACEN.

> 🧨 **`modules/pos` (backend) sigue en el repo** para migrarlo a ALMACEN, pero
> **no se concede a ningún grupo**: sus endpoints responden 403 y la UI no lo
> expone. `'pos'` sigue declarado en `ModuleKey` solo porque `pos.routes.ts` usa
> `requireModule('pos')`. Al migrarlo, se borra el módulo y la clave.

### ⚠️ Tres cosas distintas que se llaman parecido

Esta es la trampa que más confunde:

| Qué | Dónde | Qué contiene |
|---|---|---|
| **GDM_FAC** | `origin/main` | Facturación pura (6 módulos) |
| **Entorno GDM_ALMACEN** | `origin/almacen` (rama de ESTE repo) | 2º despliegue del **mismo código**, con los 14 módulos (POS + inventarios) |
| **Producto ALMACEN** | repo `GDM_ALMACEN` | El sistema de inventarios de verdad |

> 🚨 **NO hagas `merge main → almacen` a ciegas.** La rama `almacen` conserva los
> 14 módulos **a propósito**; un merge de `main` le borraría POS e inventarios.
> Si necesitas llevar un fix de `main` a `almacen`, hazlo con `cherry-pick` del
> commit puntual, no del branch completo.

---

## 🔗 URLs de producción

| Servicio | URL |
|----------|-----|
| **Frontend productivo (clientes)** | https://hcgm.com.mx/erp |
| Frontend Render (pruebas) | https://gdmfac-frontend.onrender.com |
| Backend API | https://gdmfac-backend.onrender.com/api/v1 |
| Health check | https://gdmfac-backend.onrender.com/health |
| Manual de usuario (PDF) | https://hcgm.com.mx/erp/manual-usuario.pdf |
| Repo | https://github.com/anbeor29-oss/GDM_FACT |

**Hay DOS frontends contra el MISMO backend.** Ambos deben estar en `CORS_ORIGIN`
o el navegador bloquea todo desde el que falte (ver ⚠️ abajo). Se actualizan
distinto:

| Frontend | Cómo se actualiza |
|---|---|
| Render | `git push` a `main` → auto-deploy (3-5 min) |
| `hcgm.com.mx/erp` | `npm run build:hosting` → subir el ZIP por el panel del hosting |

### ⚠️ CORS: el fallo que se ve como "ningún usuario funciona"

Si `CORS_ORIGIN` no incluye **exactamente** el origen desde el que entra el
usuario, el navegador bloquea la petición **antes de que salga** — login
incluido. No hay error en el backend, no hay log, las contraseñas son correctas y
el síntoma es "no entra nadie" (pasó el 2026-07-16 con `hcgm.com.mx`).

Valor correcto hoy (en `render.yaml`, aplicado por Blueprint):

```
CORS_ORIGIN=https://gdmfac-frontend.onrender.com,https://hcgm.com.mx,https://www.hcgm.com.mx
```

Reglas: con protocolo `https://`, sin barra final, y **con y sin `www`** (para el
navegador son orígenes distintos). Verifícalo por origen, no de memoria:

```bash
curl -si -X OPTIONS https://gdmfac-backend.onrender.com/api/v1/auth/login \
  -H "Origin: https://hcgm.com.mx" -H "Access-Control-Request-Method: POST" \
  | grep -i access-control-allow-origin
# Debe responder: access-control-allow-origin: https://hcgm.com.mx
# Si no sale la cabecera → ese origen está bloqueado.
```

---

## 🔐 Credenciales de capacitación (testeadas contra prod)

| Rol | Email | Contraseña | Cambio forzado |
|-----|-------|------------|-----------------|
| **SUPER_ADMIN** | `superadmin@plataforma.local` | `Super123!` | ⚠️ Sí (opcional) |
| **ADMIN** demo | `admin.demo@gdmfac.mx` | `Demo123!` | No |
| **USER** demo | `usuario.demo@gdmfac.mx` | `Demo123!` | No |

> ⚠️ **Cambia las contraseñas al primer acceso en producción real** (no capacitación).

---

## 🏗️ Arquitectura de deploy

```
┌─────────────────────────────────────────────────────────┐
│                       RENDER.COM                        │
│                                                         │
│  ┌────────────────────┐          ┌──────────────────┐   │
│  │  gdmfac-frontend   │  HTTPS   │  gdmfac-backend  │   │
│  │  React + Vite      ├─────────►│  Node 20 + TS 5.9│   │
│  │  Static Site free  │   CORS   │  Starter $7 USD  │   │
│  └────────────────────┘          └────────┬─────────┘   │
│                                           │             │
│                                    ┌──────▼──────┐      │
│                                    │  Postgres 15│      │
│                                    │  Free 1GB   │      │
│                                    └─────────────┘      │
└─────────────────────────────────────────────────────────┘
                          │
                          │ HTTPS bearer token
                          ▼
                ┌────────────────────┐
                │   SW SAPIEN (PAC)  │
                │  services.test     │
                │  .sw.com.mx        │
                │  (Sandbox 501⚡)   │
                └────────────────────┘
```

---

## 🧭 Entorno GDM_ALMACEN (segundo despliegue de ESTE código)

> ⚠️ **No confundir con el producto ALMACEN** (repo `GDM_ALMACEN`, carpeta
> `E:\Obsidian\ALMACEN`). Esto es un **despliegue de este mismo repo** desde la
> rama `almacen`, que conserva los 14 módulos. Ver "Tres cosas que se llaman
> parecido" al inicio.
>
> 🚨 **Nunca `merge main → almacen`.** Desde el 2026-07-16 `main` no tiene POS ni
> inventarios; un merge se los borraría a este entorno. Para llevar un fix
> puntual: `git checkout almacen && git cherry-pick <sha>`.

`GDM_ALMACEN` es un **entorno independiente** del mismo código, pensado para
demostrar/operar el flujo completo (POS + inventarios + grupos de trabajo) sin
tocar la producción `gdmfac`. Vive en su **propia base de datos** y sus propios
servicios de Render.

| Recurso | Nombre en Render |
|---------|------------------|
| Base de datos | `gdm-almacen-postgres` |
| Backend API | `gdm-almacen-backend` |
| Frontend | `gdm-almacen-frontend` |

**Se despliega desde la rama `almacen`** (que trae su propio `render.yaml`):

1. En Render: **New → Blueprint → conecta el repo → Branch: `almacen` → Apply**.
2. Render pedirá 2 secretos (`sync: false`): pega la **contraseña del admin**
   (`BOOTSTRAP_ADMIN_PASSWORD`) y tu **token SW** (`SW_SAPIEN_TOKEN`).
3. En el primer arranque, el `startCommand` corre migraciones y luego
   `bootstrap:env`, que crea empresa + **admin ADMIN_ALL** + datos de ejemplo.
4. Entra a `https://gdm-almacen-frontend.onrender.com` con
   `BOOTSTRAP_ADMIN_EMAIL` y la contraseña que pegaste.

El admin nace con **grupo de trabajo `ADMIN_ALL`** (ve todos los módulos). Desde
ahí puedes crear usuarios VENTAS / ALMACEN / COMPRAS / TESORERIA con acceso
restringido a sus módulos.

> 💡 Costo: el backend web de Render no tiene tier gratuito vía Blueprint
> (~$7 USD/mes, plan `starter`). Render permite **1 Postgres free por cuenta**;
> si el free ya lo usa `gdmfac`, cambia `gdm-almacen-postgres` a `basic-256mb`
> (~$6 USD/mes) en el `render.yaml` de la rama `almacen`, o libera el otro.

> 🔄 **Obsoleto desde 2026-07-16**: antes se decía "haz `git merge main`". **Ya
> no.** `main` es solo facturación; mergearlo aquí borraría POS e inventarios.
> Lleva los fixes uno a uno con `git cherry-pick <sha>` (conservando su
> `render.yaml`).

---

## 📦 Módulos y estado

### 🔷 Operación diaria — módulos del menú de empresa (por grupo de trabajo)

| Módulo | Estado | Descripción |
|--------|--------|-------------|
| Autenticación JWT | ✅ | Roles: SUPER_ADMIN, ADMIN, MANAGER, USER; force password change; impersonation con audit |
| Dashboard | ✅ | 6 KPIs (facturas, cobrado, saldo, acreditado, con saldo, total facturado) |
| Facturas CFDI 4.0 | ✅ | Emisión con retenciones RESICO/Honorarios; UUID SAT; PDF con paginación X/Y |
| Notas de Crédito | ✅ | % de descuento o monto fijo; prorrateo de IVA; CFDI tipo E |
| Complemento de Pago | ✅ | REP con desglose por parcialidades; `ImpSaldoAnt` descuenta NC previas |
| Clientes | ✅ | STI con `party_type`; extractor de CIF SAT (PDF); RFC + CP + régimen |
| Productos | ✅ | Impuestos por producto (11 presets fiscales); catálogo SAT 52,513 claves; c_ClaveUnidad ~115 opciones |
| Reportes | ✅ | Cobranza, cobranza detallada (saldo > 0.20), ventas, fiscal |
| **Ventas por periodo** | ✅ | Reportes → Ventas: filtro mes/año + detalle (fecha, cliente, factura, importe, pagado, no pagado) y totales: ventas totales / cobradas / no cobradas. `GET /reports/sales-detail?year&month`. **Criterio**: "pagado" = pagos timbrados **+ NC**, para que `importe = pagado + no pagado` siempre cuadre |
| **Manual de usuario** | ✅ | `frontend/public/manual-usuario.pdf`, abierto desde el botón "Manual" de la landing (`import.meta.env.BASE_URL` → sirve en Render y en `/erp`). Se regenera con el script del scratchpad; documenta los **9 iconos** del panel de facturas |
| **Resumen mensual (PDF)** | ✅ | Reportes → Resumen mensual. Por mes y año: venta, cobrada, no cobrada y **adeudo acumulado**, con subtotal por año. `GET /reports/sales-summary/pdf` (inline) |
| **Facturas no pagadas (PDF)** | ✅ | Reportes → No pagadas. TODAS las facturas con saldo, lista plana cronológica, sin importar antigüedad y **sin el umbral de $0.20** (solo descarta el redondeo, >= $0.01). Días de antigüedad: ámbar > 30, rojo > 90. `GET /reports/unpaid/pdf` |

### 🟣 Solo el ADMIN de la empresa (por ROL, no por grupo de trabajo)

| Módulo | Estado | Descripción |
|--------|--------|-------------|
| **Usuarios** (`/team`) | ✅ | El ADMIN da de alta/baja a los **USER de SU empresa** + contraseña temporal (se muestra una vez) + reset. Aislamiento: `company_id` **siempre del JWT**, todo query lleva `AND company_id = <mía>` (id ajeno → 404) y el rol va **fijo a USER** (un ADMIN no crea otro ADMIN). Cada acción → `audit_log` |
| **Contrato** (`/contract`) | ⚠️ | Contrato de prestación de servicios + T&C firmados con la **e.firma del contratante**. Estructura completa y probada; **el TEXTO LEGAL está pendiente** (ver abajo). Reusa las primitivas de e.firma de `modules/manifest`. Guarda el texto íntegro + SHA-256; la `.key` **nunca** se persiste |
| **Bitácora de actividad** | ✅ | `user_activity_log` vía **middleware global** (`middleware/activity-log.ts`): registra toda mutación exitosa de usuarios de empresa. **Se registra a TODOS**; `users.monitoring_enabled/_email` solo controla el **envío** del reporte mensual (cláusula SEXTA del contrato). Cron día 1 06:00; el correo va **solo** a `monitoring_email` |
| Timbrado real SW Sapien | ✅ | Endpoint `/v3/cfdi33/issue/json/v4` con vault CSD; QR SAT + sellos del XML real |
| Editar factura DRAFT | ✅ | Reuso de la vista de emisión; totales se recalculan al guardar |
| Envío por correo (SMTP) | ✅ | Nodemailer + selección PDF/XML de factura + NC + pagos; tolerante a fallos parciales |
| Cancelación en cascada | ✅ | NC/pagos con botón cancelar en Historia; validación de dependientes en la factura padre |
| Cancelación SW real | ✅ | `/v4/cfdi/cancel/{rfc}` + parseo de códigos SAT (201/202/205); bypass local + resend |
| Marca de agua CANCELADO | ✅ | Diagonal roja translúcida en PDFs de factura/NC/pago cancelados (se regenera al descargar) |
| Manifiesto PAC con e.firma | ✅ | Firma RSA-SHA256 real con la FIEL del contribuyente (valida RFC + vigencia + correspondencia .cer/.key); constancia PDF; la .key nunca se persiste |
| Marca corporativa GDM | ✅ | Logo oficial (monograma azul/plata) en login, sidebar, landing y favicon |

### 🔶 Plataforma (solo SUPER_ADMIN)

| Módulo | Estado | Descripción |
|--------|--------|-------------|
| Importar XML | ✅ | Preview + auto-sugerencia (yo=emisor → receptor=CUSTOMER) |
| Proveedores | ✅ | Read-only, alimentados por Importar XML |
| Paquetes fiscales | ✅ | 4 planes: PKG_100/200/500/FLEX + descarga de respaldo SAT |
| **Facturación y consumo** | ✅ | Consumo del mes con cap efectivo (quota + rollover), cierre mensual idempotente, histórico anual, marcar pagado. Cron día 1 00:15 (`ENABLE_BILLING_CRON`) |
| **CFDI de cobro (dogfooding)** | ✅ | Al cerrar el mes, HCGM (`PLATFORM_COMPANY_RFC`) emite y timbra el CFDI contra cada cliente, lo envía por correo y guarda folio+UUID; reintento por fila en errores |
| **Compras prepago (FLEX)** | ✅ | Saldos semaforizados, recarga por bloques (30 × $4.99 + IVA), histórico de compras, bloqueo de timbrado al llegar a 0 |
| **Correos automáticos** | ✅ | Alertas prepago (saldo ≤ 5 y saldo 0) con flags anti-spam + recordatorio de cobranza el día 10 |
| Usuarios | ✅ | CRUD + reset password + impersonate |
| Empresas | ✅ | CRUD + lector CIF SAT + selector de plan + carga de CSD cifrado |
| Editar empresa completa | ✅ | Modal con datos generales, domicilio y contacto + acceso directo a actualizar CSD |
| Reset operacional | ✅ | `POST /admin/companies/:id/reset-operations` (confirmRfc + dryRun) — vacía operación conservando empresa/usuarios |
| Eliminar empresa (2 pasos) | ✅ | Borrado total (usuarios, CSD, todo) con doble confirmación server-side: RFC exacto + palabra ELIMINAR |

### 🔴 Infraestructura

| Item | Estado |
|------|--------|
| Deploy en Render (auto-deploy en push) | ✅ |
| Migraciones idempotentes con `schema_migrations` | ✅ |
| Logo persistente en BD (BYTEA) | ✅ |
| Watchdog local con auto-restart | ✅ |
| Health checks | ✅ |

---

## 🚦 Listos para facturar de verdad — qué falta

Al 2026-07-16 el sistema quedó limpio (solo facturación), publicado y con los
accesos funcionando desde `hcgm.com.mx/erp`. Lo que falta para operar en real:

### ✅ Ya listo (2026-07-17)

| Concepto | Estado |
|---|---|
| PAC en producción (`SW_SAPIEN_ENV=production` + token productivo) | ✅ |
| CSD real de HCGM cargado (cert `00001000000717077906`, vence 2029-07-04) | ✅ |
| `PLATFORM_COMPANY_RFC=GHC1707275Y0` | ✅ |
| Base de datos limpia (0 facturas de prueba, 0 clientes, 0 productos) | ✅ |
| **Primer CFDI 4.0 real timbrado y validado en portal SAT** | ✅ B-000001 |
| Ambiente A/B para demos (Render sandbox con EKU9003173C9) | ✅ |

### 🔄 Operación diaria

| # | Actividad | Notas |
|---|---|---|
| 1 | **Dar de alta clientes reales** (lector de CIF) | El extractor tiene bug conocido con datos pegados (`RINCONDEROMOS`, `VILLATERESA`) — arreglado 2026-07-17; **revisar los campos autollenados ANTES de guardar** |
| 2 | Emitir facturas contra clientes reales | Timbra directo contra SAT productivo — cada timbre cuenta del paquete |
| 3 | Validar UUIDs nuevos en portal SAT los primeros días | `verificacfdi.facturaelectronica.sat.gob.mx` — verifica que sale "Vigente" |

### 🔴 Bloqueantes del contrato y la bitácora

| # | Bloqueante | Consecuencia si falta |
|---|---|---|
| 1 | **Texto legal del contrato** — `docs/CONTRATO_TYC_BORRADOR.docx` tiene 10 bloques `[PENDIENTE — texto legal]` que debe redactar el abogado (precios, vigencia, datos personales, responsabilidad, jurisdicción). La cláusula SEXTA (auditoría) está redactada pero **requiere revisión**, sobre todo el deslinde laboral | El contrato que firmen los clientes tiene cláusulas incompletas |
| 2 | **`PLATFORM_COMPANY_RFC`** en Render | El contrato se firma con el **RFC del prestador en blanco** |
| 3 | **`ENABLE_BILLING_CRON=true`** | El reporte mensual de la bitácora **no se envía** (el cron no se registra) |
| 4 | **SMTP** (`MAIL_HOST/USER/PASS/FROM`) | El reporte se genera pero no sale |

> Al entregar el texto legal: se edita **un solo archivo**
> (`backend/src/modules/contracts/contract-text.ts`) y **se sube
> `CONTRACT_VERSION`**. Quien firmó la versión anterior verá "los T&C cambiaron,
> vuelve a firmar"; su firma vieja se conserva atada al texto que sí aceptó.
> El Word se regenera desde ese mismo archivo, así documento y sistema no divergen.

### Deudas conocidas (no bloquean, pero confunden)

- **Productos aún tiene campos de ALMACEN**: columna "Mayoreo" y "Existencias
  (stock)", con textos que citan el Punto de Venta ("se cobra automáticamente en
  el Punto de Venta…", "el Punto de Venta descuenta de aquí…"). Son de ALMACEN y
  siguen visibles en facturación. Decisión pendiente.
- **Usuarios sin `work_group` ven todo lo que exista en el mapa**: la columna
  tiene default `ADMIN_ALL` y `canAccess` es fail-open. Asignar grupo (`VENTAS`)
  a quien deba ver solo facturación.
- **El manual muestra capturas con el menú anterior** (se tomaron antes de la
  limpieza). El texto y la tabla de iconos son correctos; las imágenes del menú
  no reflejan el menú actual (ni los módulos nuevos Usuarios y Contrato).
- `AdminUsers` describe el grupo "Ventas" mencionando Punto de Venta.
- **`reset:company` y su endpoint `reset-operations` están rotos** (olvidan 4
  tablas, fallan con "current transaction is aborted"). Usar el nuevo endpoint
  `POST /admin/companies/:id/wipe-operations` — mismo alcance, arreglado.
- **Extractor de CIF partía palabras concatenadas** — arreglado 2026-07-17,
  pero es conservador. Puede dejar cosas pegadas si la cadena no empieza con
  prefijo conocido (`FRACCVILLA...` separa `FRACC` pero no el segundo nivel).
  Revisar campos autollenados antes de guardar.
- **Datos ya pegados en BD**: emisor GRUPO HCGM tenía `PROLONGACIONADORATRICES`
  y `VILLATERESA`; cliente CEMJ7902287G3 tenía `RINCONDEROMOS`. Corregibles
  con UPDATE directo. La factura B-000001 timbrada quedó así (CFDI inmutable
  ante el SAT).

### 📱 Cliente móvil (Android/iOS) — pendiente prioritario

**Estado**: cero código. Decisiones tomadas y documentadas en
[READMEAPIFAC.md](READMEAPIFAC.md) y [bitacoraapifac.md](bitacoraapifac.md):

- Tecnología: **Capacitor 8.4.2** (reusa el React actual)
- Alcance: solo facturación (respeta separación GDM_FAC / GDM_ALMACEN)
- Offline: caché de lectura; timbrar siempre exige conexión
- **Fase 4 desbloqueada**: el timbrado idempotente que exige el móvil ya está
  en producción (commit `12f6651`) y protege también a la web
- **iOS/Mac ≠ Android para distribución**: Apple no permite descarga desde
  web. Requiere App Store (~$99 USD/año + revisión) o TestFlight

Retomar después de estabilizar la operación real con GRUPO HCGM y recolectar
errores reales del uso — esos valen más que cualquier plan hecho hoy.

---

## 🛠️ Stack técnico

**Backend**
- Node 20 LTS (pinneado `.nvmrc` + `engines`)
- TypeScript 5.9.3 exacto (evita error `moduleResolution=node10` de TS 6.x)
- Express 4 + JWT + bcryptjs
- PostgreSQL 15 con pg (pool + `DATABASE_URL`)
- pdfkit para PDF, xml2js para CFDI, sharp para logos
- Axios para SW Sapien PAC

**Frontend**
- React 18 + Vite 5 + TypeScript
- TailwindCSS + Lucide icons
- React Router (con `SuperAdminRoute` guard)
- React Query + Zustand
- Recharts para gráficas
- `VITE_API_BASE` dinámico por ambiente

**Infraestructura**
- Render Blueprint (`render.yaml`)
- Auto-deploy en push a `main`
- Backend Starter $7/mes (no hiberna)
- Postgres Free 1 GB (upgrade a Basic $7 para prod)
- Frontend Static free (ilimitado)

---

## 💰 Planes de timbrado (paquetes fiscales)

| Plan | Timbres/mes | Renta MXN | Extra c/u | Público |
|------|-------------|-----------|-----------|---------|
| **Esencial** (PKG_100) | 100 | $399 | $2.50 | Pyme chica |
| **Pyme** ⭐ (PKG_200) | 200 | $699 | $2.25 | Pyme mediana |
| **Empresarial** (PKG_500) | 500 | $1,399 | $2.00 | Empresa mediana |
| **Uso libre** (PKG_FLEX) | 0 | $0 | $2.00 | Ocasional |

Costo interno por timbre: ~$1.72 MXN → margen bruto 40-57 %.

---

## 🚀 Ciclo de desarrollo

### Local

```bash
# Servicios locales (Windows PowerShell)
scripts/start-all.ps1        # levanta PG + Backend + Frontend con watchdog auto-restart
scripts/healthcheck.ps1      # estado + balance SW en 1 comando
scripts/stop-all.ps1         # apagar (pregunta si detener PG)
```

- Backend en http://localhost:3000
- Frontend en http://localhost:5173
- PostgreSQL en localhost:5432 (portable en C:\pgportable)

### Deploy a producción

```powershell
cd E:\Obsidian\GDM_FAC        # ← el repo vive en E: desde 2026-07-09
git add .
git commit -m "feat/fix: descripción"
git push
```

Render detecta el push y deploya automáticamente en 3-5 min. Los logs se ven en tiempo real desde el dashboard.

### Rollback

Cada deploy en Render se puede revertir con 1 clic desde **Deploys → Rollback**.

---

## 🔒 Variables de entorno

Copiar `backend/.env.example` a `backend/.env` y llenar:

| Variable | Uso | Ambiente |
|----------|-----|----------|
| `DATABASE_URL` | Conexión PG completa | Render (auto-inyectada); local usa `DB_HOST/PORT/NAME/USER/PASSWORD` |
| `JWT_SECRET` | Firma tokens | Render la genera; local: `min 32 chars` |
| `JWT_REFRESH_SECRET` | Refresh tokens | Ídem |
| `ENCRYPTION_KEY` | Cifrado general | Ídem |
| `CSD_MASTER_KEY` | Cifrado de .key CSD SAT | Ídem |
| `PAC_PROVIDER` | `MOCK` (dev) o `SW_SAPIEN` (prod) | Manual |
| `SW_SAPIEN_ENV` | `sandbox` o `production` | Manual |
| `SW_SAPIEN_TOKEN` | Bearer token del panel SW | **Manual — no en git** |
| `CORS_ORIGIN` | URLs exactas del frontend con `https://`, separadas por coma (incluir `hcgm.com.mx` y `www.` si aplica) | Manual (Render usa host sin protocolo, falla) |
| `MAIL_HOST/PORT/USER/PASS/FROM` | SMTP para envío de facturas y correos automáticos (ej. `mail.hcgm.com.mx:465`) | Manual |
| `PLATFORM_COMPANY_RFC` | RFC de la empresa que emite los CFDIs de cobro (GRUPOHCGM). Vacío = cierre sin emisión | Manual |
| `ENABLE_BILLING_CRON` | `true` activa los crons: cierre mensual (día 1 00:15), alertas prepago (cada hora), cobranza (día 10 09:00) | Manual — `false` en dev |

---

## 🏥 Comandos frecuentes

### Estado de servicios (local)

```bash
scripts/healthcheck.ps1
```

### Reset de datos de capacitación (Render Shell)

```bash
psql $DATABASE_URL -f src/database/seeds/reset_to_training.sql
```

Deja 3 usuarios (superadmin + admin.demo + usuario.demo) y 1 empresa demo.

### Reset operacional de una empresa por RFC

Borra facturas + pagos + NC + clientes + productos de UNA empresa (conserva la empresa y usuarios). Corre desde tu PowerShell contra Render:

```bash
cd backend
# Requiere DATABASE_URL en .env apuntando a la BD que quieras limpiar
npm run reset:company -- EKU9003173C9
# Confirma escribiendo el RFC; para saltar el prompt agrega --yes
npm run reset:company -- EKU9003173C9 --yes
```

Ideal para volver a fojas cero antes de pruebas con clientes reales.

### Regenerar la guía visual de íconos

```bash
cd backend
npm run docs:icons
# → docs/GUIA_ICONOS_FACTURAS.pdf
```

### Generar el ZIP para el hosting (hcgm.com.mx/erp)

```bash
cd frontend
npm run build:hosting
# → frontend/dist-hosting/gdmfac-erp-hosting.zip
# Subir a cPanel → public_html/ → Extract (ver docs/DEPLOY_HOSTING_ZIP.md)
```

### Cerrar el mes de facturación manualmente

Desde la UI: SUPER_ADMIN → **Facturación y consumo** → "Cerrar mes anterior"
(calcula rollover, genera cargos y emite CFDIs de cobro). Es idempotente.
El cron del día 1 hace lo mismo automáticamente si `ENABLE_BILLING_CRON=true`.

### Limpiar productos de prueba (Render Shell)

Todos:
```bash
psql $DATABASE_URL -c "DELETE FROM invoice_items WHERE product_id IS NOT NULL; DELETE FROM customer_products; DELETE FROM products;"
```

De una empresa específica:
```bash
psql $DATABASE_URL -c "DELETE FROM invoice_items ii USING products p WHERE ii.product_id = p.id AND p.company_id = '<UUID>'; DELETE FROM products WHERE company_id = '<UUID>';"
```

### Backfill de `tax_preset_id` en productos existentes (Render Shell)

```bash
psql $DATABASE_URL <<'SQL'
UPDATE products SET tax_preset_id = CASE
    WHEN is_exempt = TRUE OR tax_type = 'EXENTO' THEN 'ivaex'
    WHEN applies_ieps = TRUE OR tax_type = 'IEPS' THEN 'ieps_tasa'
    WHEN tax_rate = 0.08                          THEN 'iva8'
    WHEN tax_rate = 0                             THEN 'iva0'
    ELSE 'iva16'
END
WHERE tax_preset_id IS NULL;
SQL
```

### Verificar balance SW en Render

```bash
curl -s https://gdmfac-backend.onrender.com/api/v1/pac/account-status -H "Authorization: Bearer $TOKEN"
```

---

## 📊 Costos operativos mensuales

| Concepto | Costo MXN/mes |
|----------|---------------|
| Render Backend Starter | ~$140 |
| Render Postgres Free (90 días retención) | $0 |
| Render Frontend Static | $0 |
| Cloudflare DNS + SSL | $0 |
| Backblaze B2 backup off-site (20 GB) | $20 |
| **Total infra** | **~$160 MXN/mes** |

Con 10 clientes activos mix Esencial/Pyme/Empresarial (~$7,200 MXN ingresos):
- Costo PAC (2,000 timbres × $1) = $2,000
- Costo infra = $160
- Utilidad neta ≈ **$5,000 MXN/mes (69 % margen)**

---

## 📚 Documentación adicional

- [BITACORA.md](BITACORA.md) — Histórico cronológico de cambios y decisiones
- [docs/BUGS_RESUELTOS.md](docs/BUGS_RESUELTOS.md) — Bugs de las pruebas pre-producción con síntoma/causa/fix/commit
- [docs/GUIA_ICONOS_FACTURAS.pdf](docs/GUIA_ICONOS_FACTURAS.pdf) — Guía visual de cada ícono de la lista de facturas (regenerable con `npm run docs:icons`)
- [docs/DEPLOY_HCGM_DOMAIN.md](docs/DEPLOY_HCGM_DOMAIN.md) — Guía paso a paso para colgar el ERP de `erp.hcgm.com.mx` (custom domain + SSL + variables)
- [docs/DEPLOY_HOSTING_ZIP.md](docs/DEPLOY_HOSTING_ZIP.md) — Servir el frontend desde `hcgm.com.mx/erp` vía ZIP en cPanel (`npm run build:hosting`) + checklist de PAC producción
- [docs/DISENO_FACTURACION_PLANES.md](docs/DISENO_FACTURACION_PLANES.md) — Diseño del módulo de Facturación y Consumo (rollover iguala, prepago FLEX, jobs y correos)
- [DEPLOY_RENDER.md](DEPLOY_RENDER.md) — Guía paso a paso del deploy inicial
- [ARCHITECTURE.md](ARCHITECTURE.md) — Arquitectura interna del backend
- [ESTRUCTURA_PROYECTO.md](ESTRUCTURA_PROYECTO.md) — Layout de carpetas

---

## 🧪 Testing

```bash
# Backend unitario
cd backend && npm test

# Frontend lint
cd frontend && npm run lint

# E2E (Playwright)
npx playwright test
```

Suite E2E en `tests/e2e/` con 14 archivos: smoke, auth, productos, facturas, NC + saldo, UI, a11y WCAG 2.2, performance, multi-tenant, paquetes de timbres, import XML hardening.

---

## 🐛 Reportar bugs

- **Bugs de código**: crear issue en el repo con etiqueta `bug` + captura
- **Emergencias PAC**: soporte SW Sapien 33 1380 9988
- **Reset admin en prod**: Render Shell + SQL directo (documentado arriba)

---

## 🧭 Lecciones del proyecto — guía para el siguiente

> Esta sección condensa TODO lo aprendido de cero a producción, pensada para
> arrancar un nuevo proyecto que incluya (o se parezca a) este. El detalle
> cronológico vive en [BITACORA.md](BITACORA.md) (§ Compendio Maestro) y el
> catálogo bug-por-bug en [docs/BUGS_RESUELTOS.md](docs/BUGS_RESUELTOS.md).

### Arquitectura que SÍ funcionó (repetir tal cual)

| Decisión | Por qué repetirla |
|---|---|
| **Monorepo backend/ + frontend/** con deploy separado en Render | Un push deploya ambos; el static site del frontend es gratis |
| **Migraciones SQL idempotentes** (`IF NOT EXISTS` + tabla `schema_migrations` + runner que aborta el boot si falla) | Cada deploy auto-migra; imposible arrancar con schema a medias |
| **Multi-tenant por `company_id` en el JWT** (nunca en el body) | Elimina toda una clase de vulnerabilidades de un plumazo |
| **Persistencia binaria en BYTEA** (logos, CSD cifrado) | Render Starter NO tiene disco persistente — el filesystem se borra en cada deploy |
| **Patrón provider para el PAC** (interfaz + registry MOCK/SW_SAPIEN por env) | Desarrollas todo con MOCK y conectas el PAC real sin recompilar |
| **PDFs regenerados al vuelo** (nunca persistidos) | Cada fix de PDF aplica retroactivamente a documentos viejos |
| **Contadores dentro de la MISMA transacción** que el evento (timbre → `stamp_usage`) | Nunca hay CFDI timbrado sin contabilizar ni viceversa |
| **Scripts npm para operación** (`reset:company`, `docs:icons`, `build:hosting`) | La operación repetible vive en el repo, no en la memoria de nadie |
| **Dogfooding**: la plataforma se factura a sí misma con su propio motor | Cada mejora al producto mejora la operación del negocio |

### Los 10 errores que más costaron (no repetir)

1. **CORS sin protocolo / origen faltante** — Express compara el `Origin` literal (`https://…`); Render inyecta el host pelón vía `fromService`. Hardcodear la URL completa **y listar TODOS los orígenes** (Render + `hcgm.com.mx` + `www.`). Picó dos veces: el 07-02 por el protocolo y el **07-16 por olvidar `hcgm.com.mx` al publicar en el hosting** — se vio como "ningún usuario funciona". La lección ya estaba escrita aquí y aun así volvió a pasar: **documentarla no basta, hay que verificarla por origen con `curl -X OPTIONS`**.
2. **Placeholder olvidado** (`'ABC010101ABC'` como RFC) — costó horas contra el PAC. Todo placeholder debe gritar (`TODO-FIXME`) o fallar en arranque.
3. **`getHours()` en servidor UTC** para fechas fiscales — SAT valida contra hora México. Siempre `toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' })`.
4. **`CREATE OR REPLACE VIEW` reordenando columnas** — Postgres solo permite agregar al final; tumbó el deploy. `DROP VIEW IF EXISTS` primero.
5. **Columnas usadas por el código sin migración** — el modal "Saldo" quedó en `Cargando…` para siempre por un `42703`. El schema base y el código deben evolucionar juntos.
6. **Un cálculo replicado en 8 lugares** (saldo = total − pagos − NC) — al agregar la condición `!= 'CANCELLED'` hubo que cazarlos todos. Centralizar en un helper/vista desde el día 1.
7. **Emojis en PDFKit** — Helvetica no tiene esos glifos (salen `Ø=Ý`). Texto plano o dibujar los íconos con `doc.path()` (SVG paths de Lucide).
8. **`fetch('/api/…')` relativo en prod** — con frontend y backend en dominios distintos apunta al static site. Siempre el cliente axios con `baseURL`.
9. **Token JWT pegado con basura** (`NOMBRE=`, `...`, saltos) — validar formato (2 puntos exactos) antes de culpar al servidor.
10. **Confiar en el sandbox del PAC** — 404 falsos de vault, timbres que no aparecen. Siempre tener botón "reintentar" + bypass local + logging del `messageDetail`.
11. **Verificar con el happy path** — un `401` en `/reports/sales-detail` pareció probar que la ruta existía tras el deploy; una ruta inventada daba **el mismo 401**, porque `router.use(authenticateToken)` corre antes del match. Igual, un `200 OK` no distingue el PDF nuevo del viejo. **Verifica con un control negativo y con evidencia que cambie** (hash del bundle, bytes del archivo), no con "responde".
12. **Anunciar módulos que no existen** — el menú traía 6 pantallas `ComingSoon`; el usuario creyó que se habían mezclado dos sistemas. Un placeholder en producción es una promesa que confunde: o está, o no se anuncia.
13. **Palabras reservadas de Postgres como alias** — `SELECT TO_CHAR(ts,'YYYY-MM-DD') day` es error de sintaxis (`day` es reservada); exige `AS day`. Habría explotado el día 1 a las 6 AM **dentro de un cron, en silencio**. Lo atrapó el smoke, no el typecheck: *el compilador no ve el SQL*.
14. **El typecheck no valida el schema** — `last_login_at` compilaba perfecto y reventaba en runtime (la columna es `last_login`). Igual que el bug nº5. Todo query nuevo necesita ejercitarse contra la BD, aunque el tipo diga que está bien.
15. **Los PDFs del SAT no traen espacios reales** — el CIF viene con vialidades pegadas (`PROLONGACIONADORATRICES`), `pdfjs` no las separa. Solución: diccionario CONSERVADOR de prefijos conocidos + preposiciones LARGAS PRIMERO (DEL antes que DE) para no partir cadenas mal. Y NUNCA buscar preposición en medio del resto: parte palabras legítimas (`RETORNOMORELOS → MOR + EL + OS`). Documentado en `separarPalabrasCsf`.
16. **Un DELETE ciego revienta con FK violation, pero además destruye evidencia fiscal** — `users` tiene 8 FK entrantes `ON DELETE NO ACTION` (contratos firmados, CSD subidos, timbres emitidos). No es limitación técnica: es que borrar a quien firmó destruye el rastro. Cuenta el historial ANTES y responde con explicación útil, no un constraint violation opaco.

### Cómo verificar de verdad (lo aprendido a golpes)

| Situación | Verificación que NO sirve | La que sí |
|---|---|---|
| ¿La ruta nueva existe tras el deploy? | Un `401`/`200` — el middleware de auth responde antes del match de ruta | **Control negativo**: una ruta inventada debe dar 404 mientras la real da 200 |
| ¿Se publicó el bundle nuevo? | `200 OK` — la caché sirve el viejo con 200 | **Hash del bundle** + buscar una cadena que solo exista en la versión nueva |
| ¿Se subió el PDF nuevo? | `200 OK` | **Bytes exactos** contra el archivo local |
| ¿El origen tiene CORS? | Suponerlo porque está documentado | `curl -X OPTIONS -H "Origin: …"` y ver `access-control-allow-origin` |
| ¿La firma con e.firma funciona? | Que compile | **Generar una e.firma de prueba con openssl** (RFC en `x500UniqueIdentifier`, `.key` PKCS#8 cifrada) y firmar de verdad |
| ¿Se filtró un secreto? | Leer el código | **Consultar la BD** buscando la cadena del secreto en la fila y en `audit_log` |

### Gotchas de plataforma (Render / Postgres / SAT)

- **Render**: sin disco persistente · `npm ci` omite devDeps (usar `--include=dev`) · pinnear Node (`engines` + `.nvmrc`) y TypeScript exacto · el runner de migraciones corre en `start:prod` · cron interno con `node-cron` funciona porque Starter no hiberna.
- **Postgres**: vistas no se reordenan · `pg` multi-statement respeta el `BEGIN/COMMIT` del archivo (migraciones atómicas) · `??` y `||` no se mezclan sin paréntesis en TS.
- **SAT/CFDI**: sandbox SW solo acepta el RFC de prueba `EKU9003173C9` · cancelación exige cancelar dependientes primero (NC/REP) · el timbre cancelado NO se devuelve · QR del portal = `?id=UUID&re=&rr=&tt=(17 chars zero-pad)&fe=(últimos 8 del sello)` · e.firma ≠ CSD (la FIEL firma manifiestos; el CSD sella CFDIs) · la `.key` SAT es PKCS#8 DER cifrado — Node la abre nativo con `passphrase`.

### Atajos de operación diaria

```powershell
cd E:\Obsidian\GDM_FAC                      # repo (única copia local + GitHub)
npm run reset:company -- <RFC>              # backend: vaciar una empresa (dry-run + confirmación)
npm run docs:icons                          # backend: regenerar guía PDF de íconos
npm run build:hosting                       # frontend: ZIP para hcgm.com.mx/erp
# SUPER_ADMIN UI: Facturación y consumo → "Cerrar mes anterior" (idempotente)
# Diagnóstico PAC sin abrir DevTools: GET /api/v1/pac/providers (con token)
```

---

**Copyright** © 2026 — Antonio Bernal / HCGM
