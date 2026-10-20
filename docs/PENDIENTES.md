# Pendientes — GDM NEXO

> Lista viva de lo que falta. Actualizada 2026-10-13. Lo hecho se documenta en `BITACORA.md`.

## 🔴 Bloqueado / requiere acción del usuario (no es código)

- **Descarga automática de XML — falta `ENABLE_SAT_DESCARGA_CRON=true` en Render.** El motor avanza solo con el cron
  `sat-descarga-cron` (cada 15 min + 6:00 CDMX: crea el trabajo del día, avanza, indexa a la bóveda → el XML aparece en
  el calendario **sin pulsar «Avanzar»**). Está gated por esa variable (y necesita `SAT_VAULT_KEY`). **Acción:** poner
  `ENABLE_SAT_DESCARGA_CRON=true` en el env del backend en Render y reiniciar. Sin esa variable, hay que avanzar a mano.
  Ver [[sat-descarga-estado]].

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

- **⭐ (EN DISEÑO — 2026-10-19, lo ve el usuario mañana) Reorganizar el panel «Usuarios reales (cobro por usuario)».**
  El usuario **aún no está conforme** con cómo quedó organizado (Súper Admin → Facturación mensual). Hoy ya se agrupó
  por **despacho** (árbol por emisora de cobro / predeterminada) y las exentas pasaron a reales como «sin cobro», pero
  falta definir la **vista de cobro**. **Idea del usuario a pensar:** el **precio por DESPACHO** — un despacho con,
  p.ej., **5 usuarios** es donde se puede **subir un poco más el precio** (un **escalón por número de usuarios del
  despacho**, no sólo por empresa). Hoy el precio es **$750/usuario plano** ([[cobro-por-usuario-algoritmo]]); la idea
  es un escalonado por tamaño del despacho (más usuarios ⇒ precio por usuario un poco mayor, o un cargo del despacho).
  **Pendiente mañana:** acordar con el usuario el modelo exacto (tabla de escalones, si cobra por empresa o por
  despacho, cómo se ve en el panel) ANTES de codificar. No tocar el algoritmo de cobro hasta tener la regla clara.
  Ver [[cobro-por-usuario-algoritmo]], [[paquetes-uso-y-landing-nexo]].

- **(HECHO 2026-10-15) Panel de XML de nómina de personas físicas.** Pestaña «Persona física» en XML del SAT: desglosa
  la nómina recibida (sueldos/asimilados por `TipoRegimen`, con ISR/IMSS/subsidio del complemento nómina 1.2) y el
  resumen mensual con ingresos (nómina + facturado) y egresos (recibidos tipo I), con export CSV. Detalle en BITACORA.
  **Pendiente opcional:** incluir el detalle de los otros recibidos (gastos) y emitidos en la misma pestaña, y un PDF.

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
- **Comercializar IVA.HTML — Fase 3 (pagos automáticos) + desplegar.** Las **Fases 1 y 2 YA ESTÁN** (2026-10-14):
  CRM (teléfono/empresa/cómo-nos-conoció + consentimiento LFPDPPP), **créditos prepago** (tablas `creditos_mov`/`uso`/
  `pagos`, consumo −1 por consulta, admin acredita paquetes), bitácora y export de leads a CSV. **Falta:** (a) **Fase 3**
  = pasarela de pago (Stripe/MercadoPago/CoDi) que acredite créditos sola + emita el CFDI del servicio desde NEXO;
  (b) **desplegar IVA** con estos cambios (IVA no es git: subir los archivos de `src/` + `views/` + `public/` al hosting
  de IVA en Render, y correr una vez para aplicar la migración idempotente de SQLite). Ver [[iva-html-satgo]].
- **(histórico) Comercializar IVA.HTML — idea original (2026-10-06):** dejar de usar IVA sólo interno y
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

**2026-10-14 — SatGo por e.firma + cierre por agrupador.** (1) **Información fiscal** y **Declaraciones** ya NO piden
CIEC: usan la **e.firma** (FIEL: `informacionfiscalfiel`/`decfiel`), con CIEC solo de respaldo; el buzón ya usaba
e.firma. (2) **Cierre anual** reconoce las cuentas de resultados también por **agrupador SAT** (4/5/6/7), no solo por
`tipo` — arregla el «no muestra datos del cierre anual» en catálogos importados con el tipo mal clasificado (p. ej.
SAJ10120859A). Backend-only, sin migración. Detalle en BITACORA.

**2026-10-14 — Importar respaldo: migración desde Contalink (CTLK).** Dos opciones nuevas en Contabilidad →
«Importar respaldo»: **cargar catálogo de CTLK** y **subir pólizas de CTLK** (Excel). Lee la estructura real de
Contalink (catálogo `Num/Nombre/Padre/Agrupador`; libro diario por bloques con CFDI asociados), conserva los números
de cuenta tal cual, reconstruye la historia sin pérdida y liga los CFDI (tabla `journal_entry_cfdi`). Idempotente
(catálogo por código; pólizas por hash). Validado con archivos reales: 675 cuentas / 3 824 pólizas (todas cuadran) /
0 cuentas faltantes. **Para usarse en una empresa NUEVA/vacía; el catálogo va antes que las pólizas.** Migración
`2026-10-14b_journal_entry_cfdi`. Detalle en BITACORA.

**2026-10-14 — Súper Admin «Emisor de facturas».** Pantalla nueva (`/admin/emisores`, NavItem en el sidebar) con 3
pestañas: **Emisoras** (marca varias empresas como emisoras del cobro + estrella de predeterminada, sobre el
`es_emisor_cobro` que ya existía), **Correo (SMTP)** por emisora (reusa el mailer, con envío de prueba) y **Depósito**
(banco/titular/CLABE/cuenta/referencia). `issue-invoice` ya resuelve la emisora por BD (predeterminada → cualquiera) con
`PLATFORM_COMPANY_RFC` sólo de respaldo. Migración `2026-10-14_emisores_deposito` (agrega `emisor_predeterminado` +
`deposito_*`; deja GHC como predeterminada por defecto). `tsc` verde. **Front ⇒ ZIP**; el push aplica la migración.

**2026-10-14 — IVA.HTML comercialización: CRM + créditos prepago.** Registro con CRM + consentimiento LFPDPPP
(`aviso-privacidad.html`), créditos prepago (`creditos_mov`/`uso`/`pagos`, 1 crédito = 1 consulta, el admin acredita
paquetes), export de leads a CSV. Validado con rollback. **IVA no es git → desplegar aparte** (ver arriba). Detalle en
BITACORA y `IVA.HTML/COMERCIALIZACION_IVA.md`.

**2026-10-13 — "Pago de compras" (antes PPD/PUE): cancela el pasivo de PUE y PPD, con guarda anti-doble.** La pestaña
de Pólizas se **renombró «Pago de compras»** + color **teal**; el pago manual (doble clic → elegir banco) ahora **cancela
el pasivo** también de las **PPD sin complemento REP** (antes sólo PUE). Asiento: *Cargo proveedor + Cargo 118.01 IVA
acred. pagado / Abono 102 banco + Abono 119.01 IVA por acreditar*. Guarda **REP↔factura** (`docsRelacionadosDeXml` +
`pagadaPorComplemento`) en las dos direcciones para no cancelar dos veces el mismo pasivo (manual↔complemento). `tsc`
verde, sin migración. **Front tocado ⇒ regenerar ZIP `build:hosting`.** Ver [[contabilidad-motor-polizas]].

**2026-10-13 — Lote del día (detalle en BITACORA/PLAN_TRABAJO_2026-10-13).** (1) **Validación de CFDI** como submenú de
Contabilidad→Reportes (entre SAT y Cédulas). (2) **Plan de negocios** PDF (punto 7). (3) **PLD**: botón para limpiar al
Representante de Cumplimiento. (4) **Conciliación bancaria**: modos por tipo (Nómina/Ingreso/Proveedor/Cliente), con
**autofiltro** (depósito→emitidas por cobrar; retiro→recibidas por pagar) para no dejar facturas volando. (5) **Reportes
NIF/Estados Financieros**: autoactualizan desde pólizas al entrar, con aviso de espera. (6) **CIF y 32-D por e.firma**
(`csffiel`/`ocfiel`, PDF) y **autodescarga al dar de alta** una empresa. (7) Puntos 1-7 del plan (alta de empresa, módulos
por usuario, reseteo de claves, precios, orden de usuarios, empresas bajo RFC).

**2026-10-07 — Cumplimiento fiscal consolidado en el Panel fiscal; hub ELIMINADO.** Todo el cumplimiento vive ahora en
el **Panel fiscal**: opiniones (32-D/CIF/IMSS/INFONAVIT) y las consultas (**Notificaciones**, **Declaraciones**,
**Información fiscal**, **Validar CFDI**) abren en **ventanas emergentes** (modal con botón «Salir»); el Panel tiene su
botón «Salir» (→ Dashboard). Los paneles se extrajeron a `CumplimientoPaneles.tsx`; se **borró** `ServiciosSat.tsx`, se
quitó la entrada del **menú** y las rutas viejas redirigen al Panel. Refresco automático de opiniones a **lunes 01:50**.
Ver [[panel-fiscal]].

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
