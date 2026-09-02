# BITÁCORA — GDM Facturación Móvil (Android)

Histórico de decisiones y avance de la app Android.
Arquitectura: [READMEAPIFAC.md](READMEAPIFAC.md).
Formato: fecha, contexto, decisión, consecuencia.

---

## 2026-07-16 — Definición de alcance y arquitectura

### Contexto
Se pidió exportar GDM Facturación a Android, con una lista de trabajos que
incluía: *crear endpoints /api/v1, separar la lógica fiscal de la interfaz HTML,
incorporar autenticación, implementar permisos, integrar los dos comandos de
timbrado y generar OpenAPI/Swagger*. Más un orden de módulos que terminaba en
*Inventarios* y *Modo punto de venta*.

### Hallazgo: la mayor parte del trabajo pedido ya existía

Contrastado contra el repositorio (no contra la memoria):

| Supuesto de la petición | Realidad verificada |
|---|---|
| Crear endpoints `/api/v1` | **33 routers ya montados** |
| Separar lógica fiscal del HTML | **No hay HTML en el backend**: `res.render`/ejs/pug → 0 coincidencias. Ya es API pura + SPA React |
| Incorporar autenticación | Ya existe (JWT + `authenticateToken`) |
| Implementar permisos | Ya existen (rol + grupo de trabajo) |
| Integrar timbrado | Ya existe (SW Sapien: timbrar + cancelar) |

**La petición asumía un monolito con vistas HTML. No lo es.** El backend ya es
justo lo que un cliente móvil necesita, así que el proyecto cambia de naturaleza:
no es *construir* la API, es **documentarla, endurecerla y empaquetar el
frontend**.

### Hallazgo secundario: un log que miente

El arranque imprime `📚 API Docs: http://localhost:3000/api/docs`, pero **no hay
swagger instalado ni esa ruta existe** (`grep -iE "swagger|openapi"
backend/package.json` → vacío). El mensaje lleva tiempo mintiendo. Por eso
OpenAPI **sí** es trabajo real, y es la Fase 0: sin contrato formal, el cliente
Android se acopla a suposiciones.

### Contradicción resuelta

La lista pedía **Inventarios** y **Modo punto de venta**, pero ese mismo día se
retiraron de GDM_FAC por pertenecer a **GDM_ALMACEN** (ver BITACORA.md,
2026-07-16). Además la petición decía *"solo podrán facturar"*, lo que se
contradecía con su propia lista.

**Resuelto con el usuario: el Android es SOLO facturación.** Inventarios y POS
quedan fuera; si se necesitan en móvil, serán una app del producto ALMACEN.

### Decisiones

| Decisión | Elección | Razón |
|---|---|---|
| Tecnología | **Capacitor 8.4.2** | Reusa el React existente (~90%) y mantiene **una sola base** web+Android. Nativo/RN implicaba reescribir una UI de facturación que ya funciona y sostener dos bases en paralelo |
| Alcance | **Solo facturación** | Respeta la separación GDM_FAC / GDM_ALMACEN |
| Offline | **Caché de lectura** | Catálogos en el dispositivo; **timbrar siempre exige conexión** (PAC y SAT son remotos). Offline-first se descartó por ahora: exige idempotencia, conflictos de folio y facturas rechazadas días después |
| Base de datos | **La misma en Render** | Sin BD local de negocio: cero divergencia entre lo que ve la web y el teléfono |
| Lógica fiscal | **Solo en el backend** | El APK es UI + caché. Duplicar el cálculo fiscal en el cliente sería el error nº6 del README (lógica replicada) elevado a dos plataformas |

### Gotchas registrados

- **Versiones verificadas contra npm, no citadas de memoria**: Capacitor está en
  **8.4.2** (no en la 6.x que se habría supuesto). Camera 8.2.1, Filesystem
  8.1.2, Share 8.0.1, Preferences 8.0.1.
- **Timbrado sobre datos móviles — corrección de un análisis impreciso.**
  Se afirmó que un corte de conexión podía **timbrar dos veces** y que no había
  protección. **Falso, verificado en el código:** existe `timeout: 30_000` hacia
  el PAC (`sw-sapien.provider.ts:78`) y una guarda que rechaza retimbrar
  (`invoices.service.ts:384`). Un corte **no** produce doble timbrado.

  El problema real es otro, y hay que separar dos tramos:
  · **Android → backend** (datos móviles, inestable): el backend timbra bien,
    la respuesta se pierde, el usuario reintenta y recibe *"ya está timbrada"*
    → **error confuso y sin su PDF/XML**. El dato está a salvo; la experiencia
    es pésima. Es el escenario **cotidiano** en la calle, no un caso raro.
  · **Backend → PAC** (servidor a servidor): el PAC timbra pero se pierde la
    respuesta antes de registrar `is_stamped` → timbre consumido y factura en
    DRAFT. Caro, pero **raro**: red de datacenter.

  Mitigación (Fase 4): clave de idempotencia por intento (hoy **no existe**:
  `grep -i idempotenc` en timbrado → vacío), reintento que **consulta estado**
  en vez de repetir POST, y timeouts diferenciados.

  **Lección:** "no existe protección" se afirmó tras un grep en los archivos
  equivocados. Un grep vacío prueba que no encontraste, no que no está.
- **Rate limiting no existe** y un cliente móvil es más fácil de atacar que un
  navegador (OWASP A05).
- **La sesión actual cierra al cerrar la pestaña** (decisión de negocio del
  2026-07-11). En móvil eso sería inusable: hay que redefinirla.
- **Camera/Share/Filesystem no se pueden probar en headless**: exigen dispositivo
  o emulador. Se documenta como verificación manual obligatoria.

### Consecuencia
Alcance y arquitectura cerrados; **sin código todavía**. El plan queda en 10
fases, empezando por OpenAPI (Fase 0) en vez de por el cliente, porque
documentar la API es prerrequisito de construir contra ella.

Quedan **5 preguntas abiertas** (ver READMEAPIFAC §9): notificaciones push vs
correo, sesión en móvil, definición de "productos del cliente frecuente",
factura global sin POS, y publicación en Play Store.

---

## 2026-07-16 (cierre) — Acuerdo: cola de recarga y envío desde el dispositivo

### Contexto
El usuario planteó el escenario real: se timbra desde el móvil, se cae la señal,
**el timbre se guardó bien en la nube** pero el PDF no llegó al teléfono. Propuso
(1) una rutina que al volver los datos recargue lo pendiente en el dispositivo y
(2) solicitar un correo cargado en el móvil para enviar desde ahí.

### Acordado
**Cola de pendientes con recarga automática: sí.** El diagnóstico del usuario era
correcto: todo está en la nube, al teléfono solo le faltan los archivos. Y es
barato porque **los PDF se regeneran al vuelo** (nunca se persisten): recargar es
volver a pedirlos, sin estado extra en el servidor.

### Discutido y modificado
**Se descarta guardar una cuenta de correo con contraseña en el dispositivo:**
- OWASP A02: una contraseña en un teléfono perdido es una fuga. Hoy ni el CSD ni
  la e.firma viven en el dispositivo; esto rompería el principio.
- Gmail/Outlook **bloquean SMTP con contraseña desde 2022** (exigen OAuth).
- Es innecesario: el teléfono ya tiene su app de correo autenticada.

**En su lugar: compartir nativo** (`@capacitor/share`) — Android abre la app de
correo/WhatsApp ya autenticada, con los adjuntos. Cero credenciales guardadas.

### Matiz que se le señaló al usuario
**Enviar también exige conexión.** "Enviar desde el móvil" NO resuelve la falta de
señal — resuelve inmediatez y flexibilidad. Y tiene un costo: si el operador
comparte desde su correo personal, el cliente recibe la factura de una dirección
personal y **no queda constancia** del envío en el sistema.

Por eso se conservan **dos vías**: compartir nativo (atajo de campo, sin
registro) y el envío del sistema (`sendInvoiceMail`, ya existe: sale del dominio
de la empresa y queda registrado).

### Consecuencia
Diseño de la Fase 5 acordado. Sin código todavía: entra con el APK.

---

## 2026-07-17 — Estado tras el primer día real. Recordatorio de retomar

### Contexto
GDM_FAC pasó a producción real con GRUPO HCGM el 2026-07-17. Se timbró el
primer CFDI 4.0 real (B-000001, UUID `a2a39f86-5fa7-4855-88d9-23a351da1383`).
El usuario pidió expresamente retomar el trabajo del móvil DESPUÉS de
estabilizar la operación y recolectar errores reales del uso.

### Estado del proyecto móvil

**Código escrito**: cero. Sigue en cero desde el 2026-07-16.

**Trabajo YA hecho durante el día que beneficia al móvil sin ser código de
Capacitor**:

- **Timbrado idempotente y a prueba de carreras** (commit `12f6651`): era el
  requisito bloqueante de la Fase 4. Ya está en producción. Cuando llegue el
  APK y le pasen los cortes de datos móviles cotidianos, el backend responde
  correctamente al reintento (devuelve el UUID en vez de "ya está timbrada")
  y bloquea el doble timbrado por doble toque.
- **`stamping_started_at` como reclamo atómico**: sin tabla nueva, sin
  bloqueos globales. Escalable al móvil sin cambios.

### Aprendizaje relevante para el móvil, capturado del uso real

- **`pdfjs` no separa espacios en PDFs mal tokenizados** (bug del extractor
  de CIF, arreglado con diccionario conservador — commit `1ce0c09`). Si en la
  app móvil se escanean CIFs con la cámara, el problema puede ser peor
  (calidad de imagen). Retomar el escaneo con esto en mente.
- **Los operadores realmente cargan CIFs y no verifican los datos**: hasta el
  primer CFDI timbrado no se dieron cuenta. En móvil hay que **forzar la
  revisión** con un aviso destacado antes de guardar.

### Consecuencia y recordatorio

**Retomar cuando**:
1. Haya un puñado de facturas reales (≥5) timbradas correctamente
2. El operador haya intentado cargar 2-3 CIFs y visto qué sale
3. Se hayan detectado los errores reales del uso — más valiosos que cualquier
   plan de hoy

**Empezar por**: Fase 0 del `READMEAPIFAC.md` (OpenAPI de los 33 routers).
Nada de código Capacitor hasta que el contrato de API esté formal.

**iOS/Mac**: distribución sigue exigiendo App Store o TestFlight (~$99/año +
revisión). Sideload solo funciona en Android.

---

## 2026-07-16 — WhatsApp, almacenamiento y paso al PAC productivo

### WhatsApp: corrección técnica
Se pidió apuntar las descargas **a la galería** para que aparezcan primero en el
selector de WhatsApp. **La galería indexa fotos y video**: un PDF/XML guardado
ahí no aparece. El destino correcto es **Descargas/Documentos**.

Además, **el selector sobra**: con `@capacitor/share` el flujo es
`Compartir → WhatsApp → contacto` con el archivo **ya adjunto**. El operador
nunca busca el archivo.

**Acordado:** compartir nativo como camino principal **+** guardar en Descargas
para poder reenviar después sin volver a la app.

⚠️ Android 10+ (scoped storage): escribir en Descargas compartidas exige
MediaStore. Hecho mal, los archivos caen en la carpeta privada de la app y
**WhatsApp no los ve**.

### Paso al PAC productivo (previsto viernes/sábado, con GRUPO HCGM)
El usuario avisó que hoy se timbra en sandbox y que integrará el ambiente real.

**`PLATFORM_COMPANY_RFC` es el punto ciego:** hoy está vacío y lo usan DOS
cosas — el CFDI de cobro que HCGM emite a sus clientes **y el contrato de
prestación de servicios firmado con e.firma**. Si sigue vacío, el contrato se
firma con el RFC del prestador en blanco.

Checklist acordado:
1. `PAC_PROVIDER=SW_SAPIEN` + `SW_SAPIEN_ENV=production` + token productivo.
2. `PLATFORM_COMPANY_RFC` = RFC de Grupo HCGM.
3. CSD real y vigente por empresa.
4. Verificar que **ninguna empresa** quedó con el RFC de prueba `EKU9003173C9`
   (el sandbox de SW solo acepta ese; en producción el SAT lo rechaza).
5. **Timbrar UNA factura real y validarla en el portal del SAT** antes de
   soltarlo a los clientes.

---

## 2026-07-16 — Orden acordado: primero facturar en real, luego el móvil

### Acordado con el usuario
Mañana se empieza a **timbrar en real con GRUPO HCGM**, se pulen los errores que
salgan del uso, y **después** se salta al móvil. El código Android sigue en **0
de 10 fases**: solo hay decisiones y diseño.

Es el orden correcto: facturar en real vale más que un APK, y los errores del
uso real son los que ningún sandbox muestra. Además, cuando arranque el móvil
sale barato porque el backend ya es API pura con JWT y permisos.

### ⚠️ iOS/Mac NO se distribuye como Android — descubierto al acordar el plan
El usuario habló de "cualquier dispositivo Android o Mac". **Apple no permite
sideloading**: el modelo acordado ("se descargará de la página web") funciona en
Android pero **no en iOS/Mac**. Las únicas vías son:
  · **App Store** — cuenta de desarrollador (~$99 USD/año) + revisión
  · **TestFlight** — pruebas, 90 días por build
  · **Enterprise** (~$299/año) — solo empleados de la propia empresa

Capacitor **sí compila para iOS** (la decisión técnica aguanta: misma base de
código), pero la **distribución** exige presupuesto y tiempo de revisión. Hay que
decidirlo antes de prometer iPhone a un cliente.

### Ya resuelto de las fases del móvil, aunque sea backend
El requisito bloqueante de la **Fase 4** está en producción: timbrado idempotente
y a prueba de carreras (`12f6651`). Era el riesgo más caro del móvil y además
protege a la web hoy.
