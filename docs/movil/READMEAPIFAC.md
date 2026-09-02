# READMEAPIFAC — GDM Facturación Móvil (Android)

Arquitectura y control de la app Android de **GDM Facturación**. Bitácora de
avance: [bitacoraapifac.md](bitacoraapifac.md).

**Estado**: 🟡 Alcance y arquitectura definidos · **sin código todavía**

---

## 1. RESUMEN TÉCNICO Y DECISIONES DE ARQUITECTURA

### 1.1 El hallazgo que redefine el proyecto

La petición original planteaba *"crear endpoints /api/v1"*, *"separar la lógica
fiscal de la interfaz HTML"*, *"incorporar autenticación"* e *"implementar
permisos"*. **Contrastado contra el código, nada de eso hace falta:**

| Supuesto | Verificación |
|---|---|
| Hay que crear la API | **Ya existen 33 routers** montados en `/api/v1` |
| Hay lógica fiscal mezclada con HTML | **El backend no renderiza HTML** (`res.render`/ejs/pug: 0 coincidencias). Ya es API pura + SPA React |
| Falta autenticación | **Ya existe**: JWT + `authenticateToken` |
| Faltan permisos | **Ya existen**: rol (autoridad) + grupo de trabajo (módulos) |
| Falta integrar el timbrado | **Ya existe**: SW Sapien (timbrar + cancelar, con bypass y reintento) |

**Consecuencia:** el backend ya es exactamente lo que un cliente móvil necesita.
El trabajo real NO es construir la API, sino **documentarla, endurecerla para un
cliente no confiable, y empaquetar el frontend existente como APK.**

### 1.2 La única brecha real de la API

El arranque imprime `📚 API Docs: http://localhost:3000/api/docs`, pero **no hay
swagger instalado ni esa ruta existe**: el log miente. La documentación
OpenAPI es trabajo genuino y es **el primer entregable**, porque sin contrato
formal el cliente Android se acopla a suposiciones.

### 1.3 Decisiones tomadas

| Decisión | Elección | Por qué |
|---|---|---|
| **Tecnología** | **Capacitor 8.4.2** | Envuelve el React existente en un APK nativo. Reusa ~90% del código y **una sola base** para web y Android: un fix de facturación aplica a ambos. Nativo/React Native implicaba reescribir una UI de facturación que ya funciona y mantener dos bases en paralelo — el costo no se justifica |
| **Alcance** | **Solo facturación** | Respeta la separación GDM_FAC / GDM_ALMACEN del 2026-07-16. Inventarios y POS **no** entran: son del otro producto |
| **Offline** | **Caché de lectura** | Catálogos (clientes, productos, 52k claves SAT) en el dispositivo. **Timbrar siempre exige conexión**: el PAC y el SAT son remotos. Se descarta offline-first por ahora (ver Riesgos §8.1) |
| **Base de datos** | **La misma, en Render** | Sin BD local de negocio. El móvil es un cliente más de la API: cero divergencia de datos |
| **Multi-tenant** | **Sin cambios** | `company_id` viaja en el JWT, nunca en el body. Cada empresa queda aislada por el mismo mecanismo que ya protege la web |

### 1.4 Arquitectura

```
┌─────────────────────────────┐
│   APK (Capacitor 8.4.2)     │
│  ┌───────────────────────┐  │
│  │ React 18 + Vite 5     │  │  ← el MISMO código de frontend/
│  │ (build web reusado)   │  │
│  └──────────┬────────────┘  │
│  Plugins nativos:           │
│   Camera (constancias/CIF)  │
│   Filesystem (PDF/XML)      │
│   Share (mandar por correo) │
│   Preferences (token+caché) │
└──────────────┬──────────────┘
               │ HTTPS + JWT
               ▼
   gdmfac-backend.onrender.com/api/v1   ← sin cambios de arquitectura
               │
        Postgres 15 (Render) · SW Sapien (PAC)
```

**Principio rector:** el móvil **no** replica lógica fiscal. Todo cálculo de
impuestos, timbrado y generación de PDF/XML vive en el backend, donde ya está
probado. El APK es UI + caché. Duplicar el cálculo fiscal en Kotlin/JS sería
el error nº6 del README (lógica replicada) elevado a dos plataformas.

---

## 2. ESTRUCTURA DEL PROYECTO

No se crea un repo nuevo: **el APK sale del `frontend/` actual**.

```
E:\Obsidian\GDM_FAC\
├── backend/                      # SIN cambios de arquitectura
│   └── src/
│       ├── docs/                 # ← NUEVO: OpenAPI 3.1
│       │   ├── openapi.ts        #   spec + swagger-ui en /api/docs
│       │   └── schemas/          #   componentes reutilizables
│       └── middleware/
│           └── rate-limit.ts     # ← NUEVO: OWASP (ver §8.3)
├── frontend/                     # el MISMO código sirve web y APK
│   ├── src/
│   │   ├── platform/             # ← NUEVO: única frontera nativo/web
│   │   │   ├── index.ts          #   fachada: web y nativo tras 1 interfaz
│   │   │   ├── storage.ts        #   sessionStorage | Preferences
│   │   │   ├── files.ts          #   descarga blob | Filesystem+Share
│   │   │   └── camera.ts         #   <input file> | Camera
│   │   ├── pages/Mobile*.tsx     # ← NUEVO: solo donde el móvil difiera
│   │   └── hooks/useOfflineCatalog.ts  # ← NUEVO: caché de catálogos
│   ├── android/                  # ← NUEVO: proyecto Android (lo genera Capacitor)
│   └── capacitor.config.ts       # ← NUEVO
└── READMEAPIFAC.md / bitacoraapifac.md
```

**Por qué una carpeta `platform/`:** es la ÚNICA frontera entre web y nativo. Si
los `if (isNative)` se esparcen por las páginas, en tres meses nadie sabe qué
corre dónde. Con una fachada, las páginas piden "guarda esto" y la
implementación correcta se resuelve sola.

---

## 3. DEPENDENCIAS Y VERSIONES

Verificadas contra el registro de npm el 2026-07-16, **no citadas de memoria**:

| Paquete | Versión | Por qué |
|---|---|---|
| `@capacitor/core` · `/cli` · `/android` | **8.4.2** | Runtime, build y plataforma Android |
| `@capacitor/camera` | **8.2.1** | Escaneo de constancias (CIF). El `<input type=file>` web no da control de cámara ni calidad |
| `@capacitor/filesystem` | **8.1.2** | Guardar PDF/XML en el dispositivo (la descarga por blob no funciona igual en WebView) |
| `@capacitor/share` | **8.0.1** | "Compartir" nativo → correo, WhatsApp. Requisito explícito |
| `@capacitor/preferences` | **8.0.1** | Token y caché. **No** `localStorage`: el WebView puede purgarlo |

**Ya en el proyecto** (se reusan): React 18.2 · Vite 5.0.8 · TypeScript 5.3.3 ·
axios 1.6.5 · @tanstack/react-query 5.28.

**Backend (a instalar):** `swagger-ui-express` + `zod-to-openapi` o
`@asteasolutions/zod-to-openapi` — decisión pendiente de si se adopta Zod para
validación (ver §8.3).

---

## 4. FASES DE ENTREGA

Orden **corregido** respecto al pedido original: la API se documenta ANTES de
construir el cliente, o el cliente se acopla a suposiciones.

| # | Fase | Entregable | Estado |
|---|---|---|---|
| **0** | **Auditoría de API + OpenAPI** | Spec 3.1 de los 33 routers, servida en `/api/docs` (hoy el log miente). Inventario de qué endpoint sirve a qué pantalla móvil | ⬜ |
| **1** | **Endurecimiento para cliente no confiable** | Rate limiting, validación de inputs, revisión OWASP del token en dispositivo | ⬜ |
| **2** | **Capa `platform/`** | Fachada web/nativo + `capacitor.config.ts` + `android/` generado. APK que abre y hace login | ⬜ |
| **3** | **Login · Clientes · Productos** | Con caché de lectura. **Productos del cliente frecuente** (requisito: mostrar solo lo que ese cliente ha comprado) | ⬜ |
| **4** | **Factura · Timbrado** | Prevalidación local + timbrado. Idempotencia y errores del PAC (§8.2) | ⬜ |
| **5** | **PDF/XML · Compartir** | Filesystem + Share nativo | ⬜ |
| **6** | **Cobranza** | Reusa `/reports/receivables` y los PDF que ya existen | ⬜ |
| **7** | **Complementos · Cancelaciones** | Reusan endpoints existentes | ⬜ |
| **8** | **Escaneo de constancias** | Camera nativa → el lector de CIF que ya opera en el backend | ⬜ |
| **9** | **Notificaciones** | Requiere decisión: push (FCM) vs correo. **Pendiente de definir** |  ⬜ |

**Fuera de alcance** (decisión del 2026-07-16): Inventarios, Modo punto de venta
y Factura global ligada a POS. Son de **GDM_ALMACEN**.

---

## 5. BASE DE DATOS / SCHEMA

**No hay migraciones nuevas.** El móvil consume la misma BD en Render con el
mismo modelo. Es una decisión deliberada: cualquier tabla "para móvil" abriría
la puerta a divergencia entre lo que ve la web y lo que ve el teléfono.

El único almacenamiento en el dispositivo es **caché de lectura** vía
`@capacitor/preferences`, con TTL y descarte al cerrar sesión. **Nunca** se
guarda ahí el CSD, la e.firma ni datos fiscales que no estén ya en la nube.

---

## 6. TESTS

| Nivel | Herramienta | Qué cubre |
|---|---|---|
| Unitario | Jest (ya en backend) | Fachada `platform/`, caché con TTL, prevalidación |
| Integración | Los 14 specs de `tests/e2e/` que ya existen | La API no debe romperse: el móvil depende de ella |
| Contrato | OpenAPI + validación de respuestas | Que la spec no mienta (como miente hoy el log de `/api/docs`) |
| Dispositivo | Capacitor + emulador | Cámara, Share y Filesystem: **no se pueden probar en headless** |

**Límite honesto:** Camera/Share/Filesystem **solo se validan en un dispositivo o
emulador real**. Ningún test automatizado en este entorno prueba que el APK
comparte un PDF de verdad. Se documentará como verificación manual obligatoria.

---

## 7. EJECUCIÓN Y DESPLIEGUE

```bash
# Build web + sincronizar al proyecto Android
cd frontend
npm run build
npx cap sync android

# Abrir en Android Studio para firmar y generar el APK
npx cap open android
```

**Distribución** (requisito: "se descargará de la página web"): el APK firmado se
publica junto al frontend de `hcgm.com.mx/erp`, con un enlace de descarga en la
landing — el mismo mecanismo del botón "Manual". **No** requiere Google Play.

⚠️ **Descargar un APK fuera de Play exige activar "orígenes desconocidos"** en el
teléfono, y Android muestra advertencias. Está anotado en §8.4.

---

## 8. RIESGOS TÉCNICOS Y MITIGACIONES

### 8.1 Offline y facturación
**Riesgo:** el usuario espera facturar sin señal. **No se puede**: el timbrado
depende del PAC y del SAT.
**Mitigación:** la app debe decirlo con claridad ("sin conexión: puedes capturar,
no timbrar"), no fallar con un error genérico. Los catálogos sí se cachean.

### 8.2 Timbrado sobre datos móviles — REQUISITO EXPLÍCITO

> Requisito del 2026-07-16: *"el timbrado debe funcionar correctamente, ya sea
> con datos móviles o wifi"*. No es facturar sin señal: es ser **confiable sobre
> una red intermitente**.

**Lo que YA protege (verificado, no supuesto):**

| Protección | Dónde |
|---|---|
| `timeout: 30_000` hacia el PAC | `pac/providers/sw-sapien.provider.ts:78` |
| Guarda contra retimbrar | `invoices.service.ts:384` — `if (status !== 'DRAFT' \|\| is_stamped)` rechaza |

**Conclusión: un corte de datos móviles NO produce doble timbrado.** La guarda lo
impide. (Una versión anterior de este documento afirmaba lo contrario; era
impreciso.)

**El problema real — hay que separar dos tramos:**

**a) Android → backend (el inestable, el de datos móviles)**
1. El móvil pide timbrar → el backend timbra **bien** → la respuesta se pierde.
2. La factura **quedó timbrada**; el celular no se enteró.
3. El usuario reintenta → el backend responde *"ya está timbrada"* → **error
   confuso y sin PDF/XML**.

El dato está a salvo; **la experiencia es pésima**. Es el escenario cotidiano en
la calle con mala señal, no un caso raro.

**b) Backend → PAC (servidor a servidor, estable)**
El PAC timbra pero se pierde la respuesta antes de registrar `is_stamped` ⇒ el
timbre se consume y la factura sigue DRAFT; un reintento consumiría **otro**.
Es el caso caro, pero **raro**: es red de datacenter, no celular.

**Mitigación (Fase 4, requisito bloqueante):**
1. **Clave de idempotencia por intento**: el cliente genera un UUID y lo envía al
   timbrar. Con la misma clave, el backend devuelve **el mismo resultado** (la
   factura timbrada con su PDF/XML), no un error. Hoy **no existe**
   (`grep -i idempotenc` en el módulo de timbrado → vacío).
2. **Reintento seguro en el cliente**: ante un corte, **consultar el estado** de
   la factura en vez de repetir el POST.
3. **Timeouts diferenciados**: timbrar tolera más espera que un GET de catálogo.
4. **(b)**: al reintentar, consultar primero en el PAC si el UUID ya existe antes
   de volver a timbrar.

### 8.2b Cola de recarga y envío desde el dispositivo (acordado 2026-07-16)

**Escenario:** se timbra desde el móvil, se pierde la señal, el timbre **se
guardó bien en la nube** pero los archivos no llegaron al teléfono. La factura
aparece como timbrada y sus iconos de PDF/XML existen — al operador solo le
faltan los archivos.

**Acordado — cola de pendientes con recarga automática:**
1. El dispositivo mantiene una cola: *"factura X timbrada, archivos no bajados"*.
2. Al volver la conexión, descarga PDF y XML (`@capacitor/filesystem`).
3. Marca resuelto y avisa: *"tus N facturas ya están listas para enviar"*.

Es barato porque **los PDF se regeneran al vuelo** (nunca se persisten): la
recarga es volver a pedirlos, sin estado extra en el servidor.

**Envío — decisión y su porqué:**

Se **descarta** guardar una cuenta de correo con contraseña en el dispositivo
para mandar SMTP desde ahí:
- **Seguridad (OWASP A02):** una contraseña de correo en un teléfono que se
  pierde es una fuga. Hoy ni el CSD ni la e.firma viven en el dispositivo;
  meter credenciales rompería ese principio.
- **Ya no funciona:** Gmail y Outlook bloquean SMTP con contraseña desde 2022
  (exigen OAuth).
- **No hace falta:** el teléfono ya tiene su app de correo autenticada.

**En su lugar, dos vías que resuelven cosas distintas:**

| Vía | Sale de | Cuándo | Registro |
|---|---|---|---|
| **Compartir nativo** (`@capacitor/share`) | El correo/WhatsApp del **operador** | En la calle, inmediato | ❌ No queda constancia |
| **Envío del sistema** (`sendInvoiceMail`, ya existe) | El **dominio de la empresa** | Formal | ✅ Registrado |

⚠️ **Enviar también exige conexión**: "enviar desde el móvil" NO resuelve la
falta de señal — resuelve inmediatez y flexibilidad. Quien elija compartir debe
saber que el cliente recibirá la factura de un correo personal y que **no
quedará constancia** del envío en el sistema.

### 8.2c WhatsApp y dónde quedan los archivos (acordado 2026-07-16)

Se pidió "apuntar las descargas a la galería para que aparezcan primero al abrir
los archivos de WhatsApp". **Corrección técnica:** la galería de Android indexa
**fotos y video** (MediaStore Images/Video); un PDF o XML guardados ahí **no
aparecen**. Lo que los muestra en el selector es **Descargas/Documentos**.

**Pero el selector sobra:** con `@capacitor/share`, el flujo es
`Compartir → WhatsApp → contacto` y **el archivo ya va adjunto**. El operador
nunca busca nada, así que "que aparezca primero" deja de ser un problema.

**Acordado — las dos cosas:**
1. **Compartir nativo** como camino principal (sin picker, sin buscar).
2. **Guardar también en Descargas**, para que el archivo quede en el teléfono y
   se pueda reenviar después sin volver a la app.

⚠️ Desde **Android 10 (scoped storage)** escribir en Descargas compartidas exige
MediaStore. Si se hace mal, los archivos caen en la carpeta privada de la app y
**WhatsApp no los ve**. Es el error clásico de esta parte.

### 8.3 OWASP — token en un dispositivo perdido
| Riesgo | Mitigación |
|---|---|
| A01 Broken Access Control | `company_id` del JWT (ya implementado). Auditar que ningún endpoint nuevo lo tome del body |
| A02 Fallas criptográficas | Token en `Preferences` (almacenamiento de la app), **nunca** en `localStorage`. Sin CSD ni e.firma en el dispositivo |
| A05 Mala configuración | Rate limiting por IP/usuario: hoy **no existe** y un cliente móvil es más fácil de atacar que un navegador |
| A07 Fallas de identificación | Sesión con expiración corta + refresh. **Decisión pendiente**: la web cierra sesión al cerrar pestaña; en móvil eso es inusable |

### 8.4 Distribución fuera de Play
APK autofirmado ⇒ advertencias de Android y fricción en la instalación.
**Alternativa a evaluar:** publicar en Play (requiere cuenta de desarrollador y
revisión) o TWA.

### 8.5 El manual quedará desactualizado
Ya arrastra capturas del menú anterior. Con el móvil serán dos interfaces.

---

## 9. PREGUNTAS ABIERTAS

1. **Notificaciones**: ¿push (FCM, requiere proyecto Firebase) o basta correo?
2. **Sesión en móvil**: la web cierra sesión al cerrar la pestaña. En móvil eso
   sería inusable. ¿Sesión persistente con biometría/PIN, o expiración corta?
3. **"Productos del cliente frecuente"**: ¿los últimos N comprados, los más
   frecuentes, o todos ordenados por recencia? Hoy existe la tabla
   `customer_products`; hay que confirmar si ya modela esto.
4. **Factura global**: está en la lista, pero hoy va ligada al cierre de POS
   (fuera de alcance). ¿Se requiere una factura global sin POS?
5. **Play Store**: ¿solo descarga desde la web, o también publicación en Play?

---

**Copyright** © 2026 — Antonio Bernal / HCGM
