# Pendientes — GDM NEXO

> Lista viva de lo que falta. Actualizada 2026-11-26. Lo hecho se documenta en `BITACORA.md`.

## 🔜 Abierto (2026-11-26)

### Acción del usuario — nada de esto es código

- **EMPUJAR `0a876f2`** (LISR 2027: tope del RESICO por año + recargos 2027). Es sólo backend: Render
  despliega y corre la migración. Lo anterior ya está empujado.
- **Facturas capturadas ANTES del 25/11 con precio de más de 2 decimales: hay que RETECLEAR el precio.**
  La columna `invoice_items.unit_price` era `DECIMAL(15,2)` y Postgres redondeaba al guardar; esos
  decimales **no se recuperan**. Volver a guardar la factura sin tocar el precio **no sirve** (recargaría
  el valor truncado y cambiaría el total): hay que abrirla y teclear el precio completo. El constructor
  del CFDI lo detecta y lo dice con esas palabras en vez de dejar que el PAC conteste un código.
  Ver `ERRORES_Y_SOLUCIONES.md` #34.
- **Empresas con lista de módulos RESTRINGIDA: palomear «Checador».** Las que están en «Todos los
  módulos» ya lo tienen. Súper Admin → Empresas → Editar empresa.
- **Elegir los formatos nuevos**, si se quieren: Datos de mi empresa → «Formato de impresión (PDF)»
  (Lineal / Bandas) y «Formato del recibo de nómina» (Clásico / Detallado). Es **por empresa** y hay que
  pulsar **Guardar**.

### Por probar en vivo (lo hecho el 25 y 26 no se probó contra el SAT)

- **Timbrar una factura con los formatos nuevos (Lineal / Bandas).** Se revisaron contra muestras
  generadas, no contra un CFDI timbrado real: lo que falta ver es el QR, los sellos reales y la cadena
  original con su longitud de verdad.
- **Un recibo de nómina en formato «Detallado»**, con un recibo timbrado real.
- **La nota de crédito y el complemento de pago** llevan ya la marca nueva (comparten `drawFooter`), pero
  **no se renderizaron**: necesitan base. Basta abrir uno de cada y mirar el pie.
- **Una factura con precio de 6 decimales, timbrada de verdad**, para cerrar el caso del rechazo del PAC.

### Decisiones pendientes del usuario

- **¿El RFC va público en el pie de la tienda?** Hoy el storefront muestra razón social y RFC del
  vendedor. Se ofreció quitarlo y no hubo respuesta.
- **¿`PUT /companies/:id` debe exigir ADMIN?** Hoy cualquier usuario de la empresa puede editar datos
  fiscales y subir un CSD. El inquilino de sólo-ecommerce (rol `USER`) **depende** de que siga abierto,
  así que cerrarlo tiene consecuencia.
- **Cuenta `7-1-01-000 «Comisiones Bancarias»` en depreciación** — pregunta vieja, nunca contestada.
- **Logo de la tienda** (`ec_store.logo_url`): la URL capturada apunta a un **artículo de revista**, no a
  una imagen. Hasta que apunte a un `.png`/`.jpg` real, el ícono de la pestaña queda genérico.

### Código pendiente (chips abiertos)

- **(HECHO 2026-11-26, commit `f95cc60`)** ~~El PDF «GNcys» imprime la tasa de IVA fija en `16.0000`.~~
  Las tasas salen de `pdf-impuestos` en GNcys y FarSystems; aparecieron además el bloque RETENCIONES y el
  tipo factor Exento. La muestra de `scripts/muestra-formatos` trae ahora cuatro tasas distintas, y con
  ella salieron tres defectos más del mismo formato. 18 pruebas. Ver `ERRORES_Y_SOLUCIONES.md` #37.
- **`task_83b08b69` — fuga de secretos en `GET /companies/:id`**: devuelve la fila completa de
  `companies`, incluidas `mail_pass_enc` y la llave del CSD. Está cifrado, pero no tiene por qué salir
  del servidor. Filtrar con lista blanca.
- **`task_bef07d06` — catálogo de conceptos de nómina vs. claves del motor**: cotejar uno contra otro.
- **LISR 2027 — lo que NO se tocó:** el **Capítulo X** y el **Art. 28-XXXII** de la reforma del DOF
  13-11-2026 no están implementados. El tope del RESICO y los recargos sí (`0a876f2`).

---

## 🔜 Abierto (2026-11-24)

- **PROBAR EL CORREO DE GRUPO HCGM.** El remitente guardado era `f` (una letra) y por eso el servidor
  rechazaba todo con «501 … sender address must contain a domain». Ya se arregló en las cuatro capas, pero
  hay que verlo en vivo: (a) abrir **Datos de mi empresa → Servidor de correo (SMTP)** y comprobar que el
  formulario **ya muestra** lo guardado y que abajo dice *«Tus correos saldrán desde …»* con la dirección
  completa; (b) **Enviar prueba** — el mensaje ahora dice **desde qué buzón** salió, que es como se confirma
  si está tomando el buzón propio o el del despacho; (c) mandar una factura de verdad a un tercero.
  Ver `ERRORES_Y_SOLUCIONES.md` #23.

- **Correo — el bloque de depósito quedó APAGADO para todos.** Era lo pedido («no mandes este texto»), pero
  eso incluye el correo **automático** del cargo mensual: ya no lleva banco ni CLABE. Para los clientes a los
  que sí conviene, encenderlo en **Súper Admin → Emisor de facturas → Depósito** («Incluir estos datos de
  depósito en los correos»), o marcarlo en el envío de cada factura. Ver `ERRORES_Y_SOLUCIONES.md` #20.
- **Recibos de nómina por correo — PROBAR con un trabajador real.** El envío ya existe (PDF + XML timbrado,
  uno por trabajador). Lo que hay que ver en vivo: (a) que el SMTP de la empresa —o el del despacho— mande
  sin rebotar; (b) que los trabajadores **sin correo** salgan como «omitido» y que capturarlo desde el
  renglón lo guarde también en el expediente; (c) que `enviado_at` se prenda y el reenvío se omita solo.
  Ver #21.
- **Complemento de pago del súper admin — PROBAR contra el PAC.** El camino nuevo (cobro → CFDI tipo P desde
  la emisora que timbró la factura) sólo se ejercitó con `tsc` y las 191 pruebas. Reusa `payments.service`,
  que ya timbra en producción, pero **este camino** no se ha corrido. Probar primero en una empresa con
  `timbrado_ambiente = PRUEBAS`. Ver #22 y [[pac-timbrado-produccion]].
- **Fuga de secretos en `GET /companies/:id`** (hallazgo al paso, no se tocó): devuelve la fila completa de
  `companies`, incluidas `mail_pass_enc` y la llave del CSD. Está cifrado, pero no tiene por qué salir del
  servidor. Hay una tarea aparte propuesta para filtrarlo con lista blanca.

- **Notificaciones del SAT — PROBAR contra el buzón real.** Ya se trae el contenido completo de un aviso
  (documento notificado, acuse, constancia y todos los campos del trámite) con su propio endpoint:
  `notificacionContenido`. Falta probarlo con **e.firma vigente**. Si el proveedor nombra el documento de
  otra forma, el aviso saldrá **con sus datos pero sin PDF** —la pantalla lo dice así— y agregar el alias
  en `ALIAS` es una línea. Ver `ERRORES_Y_SOLUCIONES.md` #18.
- **Stripe — el detalle sigue dependiendo del CSV.** El acomodo ya está (positivos sumados por día,
  negativos uno por uno, comisión retenida en su renglón), pero del **PDF** no se pueden leer las cifras
  de la tabla (fuente sin mapa a Unicode). Para el detalle: **CSV de «balance transactions»**, texto
  pegado, o `ENABLE_OCR=true`. Ver #14 y #17.

## 🔜 Para mañana (2026-11-24)

- **PROBAR STRIPE EN VIVO (lo pidió el usuario para mañana).** Cargar el estado de cuenta de octubre 2026 en
  Tesorería. Lo que hay que verificar: (a) que la cuenta de **Stripe exista en Tesorería** con su **cuenta 102
  ligada** —si no, la conciliación no lo toma—; (b) que se detecte como «Stripe» y salgan **saldo inicial
  62,241.30 y final 15,215.86**; (c) que la tarjeta morada muestre **comisión 2,913.15 = base 2,511.34 + IVA
  401.81**; (d) que el aviso diga que **27 renglones** traen las columnas sin cifras. **El PDF NO da el detalle
  movimiento por movimiento** (fuente sin mapa a Unicode): para tenerlo hay que subir el **CSV de «balance
  transactions»** del portal de Stripe, o pegar el texto, o encender `ENABLE_OCR=true` en Render. Ver
  [[stripe-cobrador-pagos]] y `ERRORES_Y_SOLUCIONES.md` #14.
- **PROBAR EL CHECADOR EN LA TABLETA REAL.** Nada de lo del 2026-11-23 se pudo verificar en ejecución (las
  pantallas están detrás del login y el frontend no tiene corredor de pruebas): sólo `tsc` + build. Revisar:
  (a) el flujo **imprimir → firmar → fotografiar el convenio → se libera el enrolamiento**; (b) que el aviso de
  cámara diga la causa y que **Reintentar** funcione sin recargar; (c) el botón **Salir** del kiosco (con
  confirmación) y de campo; (d) Configuración/Kioscos/Registro ya no se quedan en «Cargando…».
- **DATO QUE FALTA — ¿con qué dirección abren el checador?** Si la barra dice `http://` o una **IP de red local**
  (`192.168.x.x`), **ésa** es la causa del «permiso denegado» de la cámara: `getUserMedia` sólo corre en
  **contexto seguro** (https o localhost) y el navegador ni siquiera pregunta. La solución de fondo es servir el
  checador por **https**. Ver `ERRORES_Y_SOLUCIONES.md` #12.
- **Consecuencia del nuevo candado del checador.** A quien ya tenía el consentimiento marcado con la **palomita
  vieja** NO se le puede **re-enrolar** hasta subir la **foto de su convenio firmado**. Los rostros **ya
  enrolados siguen checando** normal (la identificación no se tocó). Si hay plantilla grande, conviene imprimir
  los convenios en lote antes de necesitar re-enrolar a alguien.
- **Orden del despliegue del 2026-11-23: BACKEND PRIMERO.** Lleva dos migraciones
  (`2026-11-23_checador_consentimiento_firmado`, `2026-11-23b_bancos_comision_cobrador`) y el lector de Stripe;
  con el backend viejo, un PUT sin `aceptado` **apagaría** el consentimiento. Después el ZIP del frontend.

## 🟣 Abierto de antes (sigue sin respuesta del usuario)

- **E-commerce · foto de producto rota.** El código está bien (subida multer→sharp→bytea, ruta pública sin auth,
  mismo `VITE_API_BASE`, sin helmet). Se agregó un enlace **«No cargó — clic para ver»** en la miniatura: falta
  que el usuario lo oprima y diga **qué responde el servidor** (404 / 401 / en blanco / error de Render).
- **E-commerce · logo de la tienda.** La URL capturada es la de un **artículo de GQ**, no una imagen — además de
  que usar una foto de ese medio es problema de derechos. Falta que el usuario ponga la **URL directa de su
  propio logo** (o que se construya la subida de archivo, ya listada abajo en los pendientes de e-commerce).
- **Catálogo de conceptos de nómina vs. claves del motor.** Quedó una tarea de fondo sugerida y **nunca
  arrancada** (chip `task_bef07d06`): cotejar los conceptos del catálogo contra las claves que usa el motor.

## 🛒 E-commerce — pendientes (2026-11-18)

Prueba en vivo del módulo; el usuario pidió seguir con las pantallas. Lo que falta:

- **(HECHO 2026-11-18, commit `bc4a859`)** ~~Captura de stock desde el Inventario de e-commerce.~~ El Inventario ya
  NO es solo lectura: lista TODOS los productos activos (los sin stock con 0) y captura **entrada/salida** por
  producto+almacén desde un modal, vía `applyMovement` del ERP (kardex + costeo; no escribe `warehouse_stock` a pelo).
  Endpoints gated ecommerce: `GET /ecommerce/almacenes`, `POST /ecommerce/inventario/ajuste`. Front ⇒ ZIP.
  Ver [[ecommerce-modulo-plan]], [[almacen-modulo-inventarios]].
- **Tienda «no disponible» / vacía.** La ruta pública `/t/:slug` SÍ está montada (App.tsx) y el backend
  (`ecommerce-storefront.service`) exige tienda `activa=TRUE` + productos con `ec_product_channel.publicado=TRUE`. Falta
  confirmar con el usuario: slug exacto, tienda activa, y **publicar productos en «Catálogo web»**. Revisar si el flujo
  de publicar productos es claro (puede faltar un botón «publicar a la tienda»).
- **Subdominio `tienda.hcgm.com.mx`.** Hoy solo funciona `/t/:slug` bajo el dominio principal; el comentario del código
  dice «el ruteo real llega luego». El subdominio necesita **DNS + que el hosting sirva la SPA ahí** (infra del
  servidor, no solo código). Dejar indicado.
- **Diseño de la tienda: logo + plantillas (pedido 2026-11-19).** Hoy Tiendas tiene logo por **URL** + 2 colores. Falta:
  (a) **subir** el logo como archivo (como las fotos de producto, endpoint propio + storage), (b) elegir **plantilla/
  diseño** entre varias (campo `plantilla` en `ec_store` + variantes de layout en el storefront `/t/:slug`). Es lo que
  el usuario quiere para «capturar su logo y elegir su diseño» antes de publicar.
- **Tienda «no encontrada» al probar:** no es el API base (el ERP corre en cPanel con el mismo `VITE_API_BASE`); el
  backend no halla la tienda por slug → revisar que la tienda esté **activa** (Tiendas, que NO diga «inactiva») y usar
  el botón **«Ver tienda pública»** (lleva el slug correcto) en vez de teclear la URL. Pedir el slug para diagnosticar.
- **(HECHO 2026-11-19, commit `7f9778d`)** ~~Almacén «No hay almacenes» al cargar stock~~: `GET /ecommerce/almacenes`
  crea un «Almacén principal» al vuelo si la empresa no tiene. ~~Fotos de producto en rejilla 3×3 con zoom (lightbox)~~.

## 🟢 En curso / arrancar enseguida (2026-11-04)

- **(HECHO 2026-11-16)** ~~Correcciones del menú Pólizas (lista A, 7) + depreciación de autos + limpieza de catálogo~~.
  Cobro IVA 208/209; barra de descontabilizar; fix `ESCAPE`; cancelación pasiva; «Generar pólizas» de Depreciaciones;
  barras 0-100 % y límite 25 MB; Libro diario a Excel por rango. **#7** impuestos al editar, **#8** precio 6 decimales,
  **#9** folio reutiliza el del borrador borrado, **#6** reorden de Tesorería + «Cobros y pagos» oculto, **#2** validador
  de catálogo CTLK. **#3** «Proponer agrupadores» en la pantalla verde del import; **#4** «Reconstruir» dentro de la
  pantalla verde (tarjeta suelta oculta); **#1** depreciación de autos (resuelve cuentas por AGRUPADOR SAT → sí deprecia
  en catálogos importados; + tope deducible 36-II editable, migración `2026-11-16_activo_tope_deducible.sql`); **#2
  limpieza** «Limpiar cuentas raras» (borra las vacías con código inválido, desactiva las que tienen datos); **#6 PDF**
  `docs/FUNCIONES_OCULTAS.pdf`. Detalle en BITACORA. **Front tocado ⇒ regenerar ZIP `build:hosting`.** Ver
  [[polizas-hub-pestanas]], [[activo-fijo-depreciacion]].
- **(REVISADO 2026-11-17) #5 Estados de cuenta — UNO A LA VEZ, sin bultos.** DECISIÓN del usuario: **NO** subir un
  documento con 12 estados de cuenta ni un ZIP (los bultos grandes dan problemas de memoria/cortes, igual que el libro
  gigante de Contalink). Se queda el flujo que ya existe: **un estado de cuenta (un PDF) por carga** → Tesorería (extractor
  canónico de 7 columnas). Si se quiere «el año», se suben los 12 meses **uno por uno** (cada carga arma su mes). Queda
  DESCARTADO el importador masivo de 1-12 PDFs/zip. Ver [[extractor-estados-cuenta]].
- **(HECHO 2026-11-16) #10 Complemento de pago (REP) con más de 1 factura.** El MOTOR ya aceptaba `documentos[]`
  (`construirPagos20` + `createPayment`: UN CFDI tipo P con varios `DoctoRelacionado`, mismo cliente, saldo real,
  parcialidad por factura, multimoneda). Se agregó la **pantalla que arranca del DEPÓSITO** en Facturas → «Complementos de
  Pago»: botón **«Nuevo complemento»** → elegir cliente, fecha/forma/banco, ver sus facturas PPD con saldo, teclear el
  depósito y **«Repartir en las más viejas»** o marcar/editar a mano, y **«Timbrar complemento»**. Una sola moneda por
  complemento (el cruce de monedas sigue en «Registrar pago» de la factura). Ver [[complemento-pago-multimoneda]],
  [[pue-ppd-cobranza-regla]].
- **(HECHO 2026-11-16) «Network Error» al recuperar pólizas de Contalink — ahora en SEGUNDO PLANO.** 1er intento
  (`responderConLatido`, latido al socket) fue una REGRESIÓN: al cerrarse la conexión, el `res.write` emitía un `'error'`
  de stream sin listener → `uncaughtException` → `process.exit(1)` → **se caía TODO el backend** (por eso también moría
  «cambiar de empresa»); crash-loop confirmado en `/health`. Arreglo correcto: el POST **arranca el import en segundo
  plano y responde al instante con `{ jobId }`** (`import-jobs.ts`, `correrImportEnFondo` con `setImmediate` + `.catch`
  que atrapa TODO); nuevo `GET /contalink/importar/:jobId` da el avance; el front **sondea** hasta terminar (tolera
  reinicios; 404 = re-subir, no duplica). Se quitó `responderConLatido`. Idempotente + precarga de firmas `CTLK:*` en
  `Set`. Queda sólo el OOM del archivo gigante (parseo síncrono): subir el libro **por año** o más RAM. Ver
  [[importador-contalink-ctlk]].

- **(ARREGLADO 2026-11-17) Import de Contalink con archivos grandes — SÍ ERA OOM; reducida la memoria del parseo.**
  El supuesto de «no es OOM» (ayer) era FALSO: medí sólo la memoria RETENIDA, no el PICO. Al subir de verdad el libro de
  **todos los años (~8 MB)**, el parseo síncrono del `.xls` **pasa los 512 MB** → el OS mata el proceso → crash-loop
  (`/health`: uptime ~113 s y luego 502; con el backend ocioso sí aguantaba). Arreglo (bajo riesgo, sin tocar la máquina
  de estados): `XLSX.read` con `cellFormula:false,cellHTML:false`; `sheet_to_json` con `blankrows:false` (no materializa
  las filas vacías); y `delete wb.Sheets[nombre]` tras cada hoja. **Medido:** memoria del parseo **14.6 → 7.7 MB (~½)**,
  **salida idéntica** (598 pólizas/3 412 movs/223 CFDI/0 descuadres). Backend-only ⇒ sin ZIP; el usuario empuja para
  desplegar. Si aun así un libro fuera demasiado grande: exportar **por AÑO** o **subir la RAM** (plan Standard). Re-probar
  los `libro-diario (2)/(3).xls` tras desplegar. Ver [[importador-contalink-ctlk]] y `docs/ERRORES_Y_SOLUCIONES.md` §1.
- **(FALTA — NUEVA 2026-11-16, PARA MAÑANA) Nuevo error de BASE DE DATOS detectado por el usuario.** El usuario reportó
  «otro error de base de datos» el 2026-11-16 y pidió dejarlo para mañana (2026-11-17). **Pendiente de DETALLAR**: falta
  el mensaje/pantalla/pasos exactos para reproducirlo. Al retomar: pedir al usuario el texto del error y dónde aparece,
  luego diagnosticar. (No confundir con el «Network Error» del import, que ya quedó en segundo plano.)

- **GRUPO HCGM — reconstruir su contabilidad y limpiar ejemplos.** Saldos no cuadran por catálogo duplicado. Caminos
  listos: **Fusionar** duplicadas (Catálogo → «Cuentas duplicadas») o **Reiniciar contabilidad** (Súper Admin, conserva
  XML) + re-importar. El usuario eligió reiniciar. Además se están **borrando por SQL** (Web Shell) facturas/pagos/
  productos de ejemplo de HCGM (soft-delete por `deleted_at`). Probar que la facturación arranca limpia.
- **Parámetros de horas extra 2027 — cotejar contra el DOF.** Reforma 40 h publicada (jornada 48→46→44→42→40, 2026-30);
  el escalonamiento del tope de dobles (9→12 h) viene de despachos. Actualizar `nomina_te_parametros` y marcar
  `confirmado=TRUE` sólo tras validar el DOF. Checador: token de dispositivo, asistencia→prenómina, modo campo GPS;
  afinar límites SBC; casos TE sin cubrir. Ver [[checador-nomina-plan]].
- **Lector del PDF 32-D del IMSS.** El usuario pasó una muestra; formato conocido (RFC/Folio/sentido/vigencia/
  trabajadores). Falta escribir el `leerPdf` del IMSS (regex, como CSF/CIF) para autollenar `opinion_cumplimiento`.
  Ver [[imss-32d-opinion-pendiente]].
- **Autofacturación — salir en vivo (decisión del usuario).** Ya se captura el rol de adquirente + timbrado conectado
  con salvaguarda (commit `b9b8c23`). Para emitir real: empresa en PRODUCCIÓN + PAC con servicio de adquirentes. Umbral
  de ingresos (~40 UMA Art.74) por validar. Ver [[autofacturacion-anexo20-pendiente]].
- **Factura global — probar timbrado** en PRUEBAS (nodo InformacionGlobal). Ver [[factura-global-publico-general]].
- **Alerta de IVA — que la app de IVA llame al puente.** La alerta de registro NEXO ya funciona; la de IVA dispara si
  la app de IVA llama `POST /integracion/iva/cliente` en cada autoregistro (si no, agregarlo en IVA — app aparte).
- **Costo vs gasto en Compras (a conversar).** Usuario aceptó ClaveProdServ→115/601; si se afina, tabla por empresa
  marcada «sugerido». Ver [[contabilidad-asignacion-centralizada]].
- **(HECHO 2026-11-04)** ~~Filtro de metadatos en XML del SAT~~ (`42e79a5`); ~~correo del despacho como canal central
  + SMTP arreglado~~ (`7afa940`, host = `mail.hcgm.com.mx`); ~~flecha de regreso en Pedidos~~ (`a460348`).
- **(HECHO 2026-11-11)** ~~PUE genera los DOS asientos~~ (`2f801de`): en PUE (pago en una exhibición, sin
  complemento) el motor de compras ahora genera, tras la compra (pasivo), **su pago** que lo CANCELA
  (cargo proveedor / abono banco 102.01 o Caja 101 si efectivo + IVA 119→118). MetodoPago/FormaPago se leen
  del XML (la columna puede venir vacía); el panel «Pago de compras» también detecta PUE por XML. Idempotente.
  Para compras ya asentadas sin pago: «Descontabilizar mes» + regenerar. **Pendiente:** el pago de NÓMINA (su
  pasivo/neto) es flujo aparte (`nomina-poliza`), no se auto-paga. Ver [[contabilidad-motor-polizas]].
- **(HECHO 2026-11-11)** ~~Pólizas reconstruida como HUB de pestañas~~ (`60d096e`→`83e8cc9`): Ventas · Compras ·
  Pagos de ventas · Pago de compras · Depreciaciones · Nómina (emitida/recibida) · Libro diario. Acomodo común
  (Fecha·Folio·Nombre·Cuenta·[2ª]·Subtotal·IVA·Total·ojo·estado), sin UUID/RFC, combos que alimentan el asiento,
  auto-contabiliza al abrir, ícono de estado nuevo. Cobro de ventas (`generarCobroPue`), nómina recibida
  (`nomina-pf`), Libro diario como hoja por fecha. Migración `2026-11-11_cfdi_cuenta_contable_2.sql`. Timbrado→
  contabilidad ya existía (`postTimbradoEmitido`). Detalle completo en `docs/POLIZAS_PESTANAS.md`. Ver
  [[polizas-hub-pestanas]]. **Pendiente de usuario/afinar:** (a) confirmar los **agrupadores de nómina recibida**
  (ingreso 700/401 e ISR a favor 113); (b) **formato final del Libro diario** (hoja: ¿por póliza o por movimiento?);
  (c) hook server-side **descarga SAT → contabilidad** (hoy lo cubre el auto de las pestañas); (d) en Compras hay que
  **capturar la 2ª cuenta (gasto)** para que genere (si está migrada, descontabilizar y regenerar).
- **(HECHO 2026-11-09)** ~~Reparar enlaces del respaldo (opción B)~~ (`d2804b7`): cuando un respaldo no trajo el
  bloque «CFDI Asociados», el XML sale «por clasificar» aunque ya esté contabilizado (y el motor lo duplicaría).
  Botón **«Reparar enlaces del respaldo»** en Asignación de cuentas → Memoria por RFC: empareja XML↔póliza por
  importe exacto + RFC + fecha (unicidad 1:1, confianza Alta/Media/Baja), graba sólo `journal_entry_cfdi`.
  Incluye diagnóstico por año. ~~Enlace «Abrir asignación» navegaba con recarga completa y fallaba~~ (`4d3cce0`,
  ahora `useNavigate`). Detalle completo en `docs/RECUPERACION_ENLACES_RESPALDO.md`. Ver [[reparar-enlaces-respaldo]].
  **Pendiente de usuario:** opción A = reexportar de Contalink el libro diario **con el bloque «CFDI Asociados»**
  y reimportar (llena los enlaces solo). Y desplegar `4d3cce0` en el frontend de Render + subir el nuevo zip al hosting.

**E-commerce (parcial):** flecha de regreso en Pedidos HECHA. «Tienda no disponible» = la tienda debe estar `activa`
(check en Tiendas) + slug correcto; inventario vacío = agregar productos primero en «Productos» y publicarlos en
«Catálogo web». Si persiste con la tienda activa, pasar la URL exacta. Ver [[ecommerce-modulo-plan]].

## 🔴 Bloqueado / requiere acción del usuario (no es código)

- **(HECHO 2026-11-04)** ~~Descarga automática de XML — `ENABLE_SAT_DESCARGA_CRON=true`~~ → **ya puesto en Render**.
- **(HECHO 2026-11-04)** ~~Plan de SatGo con descarga masiva (`wssolicita`)~~ → **ya contratado**.
- **(DECISIÓN DEL USUARIO, no listar como pendiente)** PAC producción = marcar empresa PRODUCCIÓN +
  `SW_SAPIEN_TOKEN_PROD` + CSD en SW. Es CFDI real; lo activa el usuario cuando quiera salir en vivo.
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

- **(2026-10-29) Re-publicar `/erp`** — pestañas IVA/E-COMMERCE, login `/comercio`, recibos de aguinaldo y despachos
  unificados son de PANTALLA: `npm run build:hosting` y subir `erp/` a `public_html/erp` (Ctrl+F5).
- **(2026-10-29) Subir el menú nuevo de hcgm.com.mx** — `dist-uploads/landing-hcgm-comercio/index.html` a la raíz de
  `public_html` («🛒 Comercio electrónico» en Herramientas).
- **(2026-10-29) Aguinaldo 2026:** recalcular el especial #2 si sigue abierto; si ya se cerró con el cálculo viejo
  (sueldo × días), reabrir/rehacer antes de timbrar.

## 🟡 Por construir

- **(HECHO 2026-10-20) Despacho contable como entidad + precio por despacho + panel de cobro por usuarios.**
  Se creó la entidad **`despachos_contables`** (migración `2026-10-20_despachos_contables.sql`): nombre, **precios
  propios** (precio/usuario y escalón de timbres; NULL = hereda el global), emisora predeterminada y `activo`. Las
  empresas se cuelgan de un despacho con `companies.despacho_id`. Nuevo sidebar **Plataforma → «Despachos contables»**
  (`/admin/despachos`, `AdminDespachos.tsx`) para **dar de alta/baja y fijar los precios**; y en **Empresas → Editar
  empresa** un selector para meter la empresa a un despacho. El cobro (`facturacion-usuarios.service`) ahora resuelve el
  **precio por despacho** (si el despacho fija precio propio, ése manda y NO se le aplica el brinco por calendario; si
  no, hereda el global). El panel «Usuarios reales» agrupa por **despacho** (prefiere `despacho_id`, cae al viejo
  agrupamiento por emisora para empresas sin despacho) y **sólo factura a quien TIENE usuarios**: las de 0 usuarios
  salen «sin usuarios» sin acción de emitir (base del cobro por usuario). **Seed CUARTO:** un único despacho interno
  **«GRUPO HCGM»** con TODAS las empresas activas dentro (incluida SERVICIOS ADMINISTRATIVOS JOMAR / SAJ10120859A).
  **OJO facturación:** `FAMC800303RN4` (CARLOS ERNESTO FRANCO) **salió** de `RFCS_SIN_COBRO` porque es el único cliente
  de HCGM con usuario propio y SÍ se cobra. Si tras desplegar sigue saliendo «sin cobro», es porque tiene el flag
  `billing_exempt=TRUE` en la BD → quitarlo desde Empresas. Ver [[cobro-por-usuario-algoritmo]].
  **Pendiente opcional (a conversar):** escalón de precio por **tamaño del despacho** (p. ej. 5+ usuarios ⇒ precio por
  usuario un poco mayor) — hoy el precio por despacho es un valor fijo, no escalonado por nº de usuarios.

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

- **Aguinaldo:** validar un recibo timbrado en PRUEBAS (TipoNomina E, percepción 002, exento/gravado) y decidir si la
  exención del Art. 93-XIV va en **SMG** (como hoy) o en **UMA** (criterio del SAT).
- **Puente IVA→NEXO:** que un autoregistro nuevo aparezca en «Solicitudes en prueba» y que «Facturar (elegir emisora)»
  timbre el CFDI del servicio IVA (CFDI REAL si la emisora está en PRODUCCIÓN).
- **Despachos:** confirmar que CESSMART y Mi Tienda quedaron en el único grupo GRUPO HCGM tras la migración 2026-10-29d.


- **Descarga por SatGo** (bloqueada por el plan, ver arriba).
- **Buzón de notificaciones** (`comunicadosfiel`/`notificacionesfiel`): puede estar **gated por el mismo plan**; si lo
  está, el buzón se verá vacío (no rompe). Se confirma al tener el plan.
- **IVA.HTML por SatGo** (al desplegar).

## ✅ Terminado recientemente (resumen; detalle en BITACORA)

**2026-11-03 — Lote contable + factura global + horas extra.** (1) **Factura global al público en general**: el nodo
`InformacionGlobal` ya sale (RFC XAXX010101000, tipo I) con periodo capturable; POS = Diario. (2) **Cuentas
duplicadas**: pestaña Catálogo → «Cuentas duplicadas» detecta por código normalizado y **fusiona** (sin doblar la
apertura). (3) **Reiniciar contabilidad** (Súper Admin, conserva XML) para re-importar limpio. (4) **Reconstruir
cartera de cobranza** desde XML (PPD − complementos de pago). (5) **Balance** sin duplicar el capital + aviso de
facturas sin clasificar al reconstruir + selector de cuenta en portal (no se recorta). (6) **Dashboard**: resumen del
despacho sólo en la cabecera (GRUPO HCGM). (7) **PDF** «Horas extra 2026 vs 2027». Detalle en BITACORA.

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

**2026-11-26 — NEXO alimenta al SUA (altas, movimientos y créditos).** Motor y servicio para generar los `.txt`
que el SUA **importa**: `Aseg.txt` (168) y `Afil.txt` (80) para las **altas**, `Movt.txt` (49) para **bajas (02),
modificación de salario (07) y reingresos (08)**, y `Cred.txt` (52) para los **créditos INFONAVIT** (15 inicio,
16 suspensión, 17 reinicio, 19 modificación de valor). Los cuatro layouts se verificaron **contra la base real del
SUA 3.7.1** (`C:\Cobranza\SUA\SUA.MDB`) cotejando sus propios exportados; los créditos cuadraron 21 de 21. El sexo
y la entidad de nacimiento se deducen del CURP contra el catálogo `Estados` del propio SUA. Rutas
`GET /nomina/sua/candidatos` y `POST /nomina/sua/{altas,movimientos,creditos,validar}`; 24 pruebas verdes. Mapeo en
`docs/NEXO_A_SUA.md`.

**2026-11-26b — Bitácora de lotes del SUA.** Cada generación queda apuntada en `nomina_sua_lotes` +
`nomina_sua_lote_renglones` con la **foto** de lo enviado (NSS, fecha, importe como se mandaron). El SUA no devuelve
acuse —deja sus rechazos en los `ErrImp*.txt`—, así que el lote se cierra con un **resultado** que captura quien
importó: PENDIENTE / IMPORTADO / **CON_ERRORES** (con el `ErrImp` pegado). Un lote CON_ERRORES **deja de contar como
enviado** y sus movimientos reaparecen como pendientes. `candidatos` ya marca `enviado`/`enviado_en`, y el generador
avisa antes de repetir un alta, un movimiento con la misma fecha o un crédito anterior al último enviado. Rutas
`GET /nomina/sua/lotes`, `POST /nomina/sua/lotes/:id/resultado`, `GET .../errores`, `DELETE .../:id`. La migración se
probó contra Postgres local (creada y revertida).

**2026-11-26c — Pantalla del SUA.** **Nómina → SUA · Importación** (`/nomina/sua`), junto a IMSS · IDSE, con cuatro
pestañas en el orden del proceso: **Altas · Movimientos · Créditos · Bitácora**. Arranca en el mes en curso y propone
lo que hay en el rango, cada renglón con su estado (listo / lo que le falta / ya se mandó el DD/MM/AAAA). La
modificación de salario se agrega buscando al trabajador. Los `.txt` se guardan con su nombre del SUA y los avisos
salen arriba; la bitácora se cierra con «Entró al SUA» o «Lo rechazó» pegando el `ErrImp*.txt`. Parámetros del SUA en
panel plegado. Verificado: tsc limpio en back y front, 24 pruebas verdes, las migraciones se aplicaron con el runner
real contra Postgres local y los endpoints responden 401 (registrados y con llave). **No se vio la pantalla con
sesión** — hace falta un usuario de dev.

**2026-11-26d — Botón automático del SUA.** Junto al rango, **«Generar todo lo pendiente»**: arma los tres pasos de
un golpe (`POST /nomina/sua/automatico`) con lo completo y no enviado, en el orden altas → movimientos → créditos.
Los créditos van como **inicio de descuento**; los demás tipos siguen a mano. Lo que le falta un dato se **omite y se
nombra** en vez de tumbar la corrida (en el modo a mano sí frena: ahí alguien marcó ese renglón). Si las altas
truenan se detiene todo.

**Falta:** (a) confirmar la escala
del descuento **por porcentaje** (no hay ni un caso en la base real: hoy se escribe con 4 decimales y el generador
avisa); (b) incapacidades y ausentismos (`Incap.txt`), fuera de alcance. Ver [[sua-mdb-mapeo]].

Batch de 7 (2026-10-05): notificaciones 6 meses · foto checador→expediente · hub Cumplimiento unificado (IMSS/INFONAVIT
+ punto verde) · rediseño de Pólizas · motor de descarga conmutable a SatGo + Comprobantes unidos · login · logo NEXO.
Antes: PLD v1, IVA→SatGo (motor), vigencias, onboarding/facturación, etc.
