# Pendientes — GDM NEXO

> Lista viva de lo que falta. Actualizada 2026-10-06. Lo hecho se documenta en `BITACORA.md`.

## 🔴 Bloqueado / requiere acción del usuario (no es código)

- **Descarga por SatGo — el plan NO incluye la descarga masiva.** Al activar `SAT_DESCARGA_VIA=satgo`, el SAT devuelve
  `HTTP 403 · "Este plan no tiene acceso a esta funcionalidad" · featureCode "wssolicita" · dailyLimit 5 / monthlyLimit 5`.
  Es un **candado del plan de SatGo**, no un bug. **Acción:** contratar/actualizar el plan de SatGo que incluya la
  **descarga masiva** (feature `wssolicita`, y probablemente `comunicadosfiel`/`notificacionesfiel` para el buzón).
  **Mientras tanto:** quitar `SAT_DESCARGA_VIA=satgo` en Render para volver al **WS oficial del SAT (gratis)**.
  _(2026-10-06: el usuario reporta que SatGo ya se liberó y habilitará más RFC; falta confirmar en vivo que el plan ya trae `wssolicita`.)_
- **IVA.HTML → desplegar.** El código **ya está listo** (motor SatGo, lee `SATGO_API_KEY`; ver `CAMBIO_SATGO.md`).
  Acción del usuario: **poner `SATGO_API_KEY`** en el `.env`/variables del hosting de IVA y **reiniciar** el server
  (Claude no tiene acceso a ese hosting). Mismo plan con descarga masiva aplica.
  **OJO — de dónde sale la llave (2026-10-06):** la API Key **NO está en las variables de entorno de NEXO**
  (`gdm-almacen-backend`); NEXO la guarda **cifrada en su base de datos** (bóveda con `SAT_VAULT_KEY`). En el env de NEXO
  sólo están `SATGO_BASE_URL` (la URL, no la llave) y `SAT_VAULT_KEY` (cifra la llave, no es la llave). Para IVA,
  tomar la **API Key del portal de SatGo** (`web.sat-go.com`) **o** poner en IVA `SATGO_PORTAL_TOKEN` y dejar que IVA
  haga `CreateKey` solo. Reemplazar el literal `"satgo"` que quedó mal. Ver [[iva-html-satgo]].
- **NEXO ya está EN VIVO en `https://hcgm.com.mx/erp/`** (2026-10-06, vía gdm-almacen `main`, que el usuario usa como
  producción; super admin `admin@gdmalmacen.mx`). Pendiente OPCIONAL: separar un ambiente de **pruebas** del real con
  el esquema de 2 ramas (`produccion` aparte, ver `DESPLIEGUE.md`), si se quiere experimentar sin tocar lo vivo.

## 🟡 Por construir

- **Punto de Venta (POS) — lector de código de barras + impresora de tickets.** Alcance (2026-10-06): **USB para
  ambos**. Lector USB (keyboard-wedge) e **impresora USB** por cadena Web Serial → WebUSB → `window.print()` (ESC/POS,
  ojo `usbprint.sys` en Windows). Plan en `docs/POS_PLAN.md`. **Fase 0 y Fase 1 HECHAS**: el alta de producto captura
  barcode, la búsqueda lo incluye, y el POS ya **escanea** con el lector USB (`GET /pos/scan` exacto, listener global
  por ráfaga+Enter, destello verde + bip). **Falta Fase 2**: ticket pulido + «Buscar impresora» USB (Web Serial →
  WebUSB → `window.print`) + tabla `pos_config`. **EN PAUSA (2026-10-06, decisión del usuario):** la Fase 2 se arma
  cuando un cliente indique qué **modelo** de impresora tiene (de los sugeridos en el PDF de referencia), para calibrar
  la ruta (COM/Web Serial vs respaldo).
- **PLD / antilavado — afinar el Aviso contra el formato oficial.** HECHO (2026-10-06): **expediente completo**
  (Anexo 2/3 + beneficiario controlador + completitud) **y el borrador del Aviso en XML** (pestaña «Aviso»: contenido
  del **Art. 24** + esquema general del **SPPLD**, armado desde config + facturas del mes + expediente). **Falta
  afinarlo** contra el **formato/XSD OFICIAL del DOF por actividad** (claves de actividad e instrumento monetario) y la
  **clave de sujeto obligado del padrón** — se ajusta cuando el usuario pase el formato oficial de su actividad o lo
  validemos en el Portal. Ver [[pld-lfpiorpi]] y `docs/PLD_LFPIORPI_ANALISIS.md`.
- **Comercializar IVA.HTML (producto de autoservicio).** Idea del usuario (2026-10-06): dejar de usar IVA sólo interno y
  **venderlo**. (a) **Pantalla emergente (modal) de captura de datos** al primer uso: el usuario **graba sus datos**
  (nombre, RFC, correo, teléfono, empresa) antes de poder consultar — sirve de registro/CRM ligero y de aviso de
  privacidad (LFPDPPP). (b) **Monetización:** vender **consultas** (cada descarga/cálculo de IVA del mes = 1 consulta;
  prepago por paquetes o por RFC/mes, con contador y candado antes de descargar) y **exportaciones a Excel** (el detalle
  de CFDI + IVA cobrado/pagado por tipo I-PUE / I-PPD / P / E; gratis ver resumen, se cobra exportar). (c) **Técnico
  (IVA = Node/Express + SQLite):** tablas `clientes`/`leads` + `uso` + `creditos`; middleware que descuenta crédito al
  completar descarga/export; export con `exceljs`; modal en el front que no deja avanzar sin grabar datos. Pago v1 =
  control manual de créditos (pasarela Stripe/MercadoPago/CoDi después). El **CFDI del servicio lo emite NEXO** (liga
  natural). Plan detallado en `IVA.HTML/COMERCIALIZACION_IVA.md`. Ver [[iva-html-satgo]].

## 🔵 Por probar en vivo (requieren e.firma + plan de SatGo)

- **Descarga por SatGo** (bloqueada por el plan, ver arriba).
- **Buzón de notificaciones** (`comunicadosfiel`/`notificacionesfiel`): puede estar **gated por el mismo plan**; si lo
  está, el buzón se verá vacío (no rompe). Se confirma al tener el plan.
- **IVA.HTML por SatGo** (al desplegar).

## ✅ Terminado recientemente (resumen; detalle en BITACORA)

**2026-10-07 — Panel fiscal (expediente de cumplimiento de un vistazo).** Nueva pantalla
`contabilidad/panel-fiscal` (`PanelFiscal.tsx`): encabezado **claro** con «Panel fiscal» + tarjeta de empresa, y
tablero **oscuro** (paleta NEXO del doc de diseño) con **DOCUMENTOS PERMANENTES** (32-D/Opinión SAT, CIF, Opinión IMSS,
Opinión INFONAVIT: estado vigente + fecha + condición de actualización) y **DOCUMENTOS ANUALES / HISTÓRICO** (ejercicio
seleccionable con Declaraciones/Notificaciones/Información fiscal: conteo + estado + última act.). Reusa los endpoints y
cachés del hub (no duplica motores); cada tarjeta/fila entra al hub en su pestaña (`servicios-sat?tab=`). Entrada desde
**«Tu empresa» en el Dashboard** (botón, gated contabilidad) y desde el menú. **INFONAVIT** ahora tiene su
**«Configurar»** en el hub (antes oculto) — queda lista mientras se explora su obtención automática. `tsc` + `vite build`
en verde. Ver [[panel-fiscal]] y [[satgo-integracion]].

**2026-10-06 — PLD: expediente único completo + borrador del Aviso (XML).** (a) El expediente captura todos los campos
del **Anexo 3 (PF) / Anexo 2 (PM)** por catálogo (identificación, domicilio, documento de identidad, representante),
uno o varios **Beneficiarios Controladores** estructurados, y calcula la **completitud automática** (requeridos +
documentos en resguardo). Catálogo = fuente única (`CATALOGO_EXPEDIENTE`, `GET /pld/campos-expediente`); `completo` se
deriva en el backend. (b) Nueva pestaña **«Aviso»**: genera el **borrador del Aviso en XML** (`pld-aviso.service`,
`GET /pld/aviso.xml`) con el contenido que marca el **Art. 24** (sujeto obligado · cliente/beneficiario · operación) y
la **estructura general del SPPLD**, desde config + facturas del mes + expediente. Es borrador: se valida/ajusta contra
el formato oficial del DOF por actividad en el Portal. Ver [[pld-lfpiorpi]].

**2026-10-06 — NEXO publicado en hcgm.com.mx/erp.** Se reemplazó la vieja app de GDM Facturación en `/erp/` por NEXO:
`npm run build:hosting` (frontend estático con base `/erp/` → `gdm-almacen-backend`) subido a `public_html/erp`. Se
corrigió el **CORS** del backend (`CORS_ORIGIN` += `hcgm.com.mx,www.hcgm.com.mx`, también en `render.yaml`) y se creó/
reseteó el **super admin** con `scripts/admin-total.js` (SUPER_ADMIN + ADMIN_ALL + acceso a las 5 empresas). Login OK.
Flujo de cambios en `docs/DESPLIEGUE_HCGM_ERP.md`. Ver [[despliegue-dev-produccion]].

**2026-10-06 — POS Fase 0+1 + cédulas de activo fijo.** (a) POS: alta/edición de producto captura **código de barras**,
búsqueda lo incluye, y el POS ya **escanea** con lector USB (Fase 1: `GET /pos/scan`, listener global, destello+bip).
(b) Activo fijo: la cédula trae la **ClaveProdServ (código + descripción SAT)** y **dónde cae en el algoritmo** (rubro
+ fundamento LISR), **columna «% avance»** con barra y **panel de monitoreo** (en curso · por agotarse · totalmente
depreciados · pendiente), y **descarga Excel y PDF** de ambas cédulas. Se regeneró el PDF de referencia
`CODIGOS_DEPRECIACION_SAT.pdf` (desde `depreciacion.data.ts`, con sección de ClaveProdServ). Ver
[[activo-fijo-depreciacion]] y [[pos-codigo-barras-impresora]].

**2026-10-06 — Tablas del ISR por mes y por periodo (consulta).** En Nómina → Parámetros, bajo la tarifa mensual, se
agregó una tarjeta con las **12 tablas acumuladas por mes** (pagos provisionales), la **anual** y las de cada
**periodicidad** (diaria/semanal/decenal/quincenal/mensual/bimestral). Son de consulta —el motor sigue reteniendo con
`nomina_tarifa_isr` (MENSUAL, cotejada DOF)—. Las tablas viven versionadas por año en
`backend/src/modules/nomina/tablas-isr.data.ts` (fuente Anexo 8 RMF 2026; enero=mensual, febrero=bimestral,
diciembre=anual) y se sirven de sólo lectura en `GET /nomina/tablas-isr/:anio`. Agregar un año = agregar un objeto.
Las 19 tablas 2026 pasaron validación de escalera + continuidad de cuota + igualdades. Ver [[indicadores-fiscales]].

Batch de 7 (2026-10-05): notificaciones 6 meses · foto checador→expediente · hub Cumplimiento unificado (IMSS/INFONAVIT
+ punto verde) · rediseño de Pólizas · motor de descarga conmutable a SatGo + Comprobantes unidos · login · logo NEXO.
Antes: PLD v1, IVA→SatGo (motor), vigencias, onboarding/facturación, etc.
