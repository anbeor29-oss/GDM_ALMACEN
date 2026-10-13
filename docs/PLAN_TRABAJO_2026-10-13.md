# Plan de trabajo — 2026-10-13 (ejecución)

> Organizado el 2026-10-12. Fuente: instrucciones del usuario (7 puntos). **NO implementado aún** — se corre mañana.
> Convención: Claude **commitea**; el usuario **empuja** (`git push gdmalmacen erp-unificado:main`) y **prueba en Render**.
> Las ⚠ son **decisiones que hay que confirmar ANTES de codificar** ese punto.

## Orden sugerido (de lo aislado/rápido a lo de mayor diseño)
1. **D** — limpiar sidebar (2 quitadas)
2. **C** — Empresas: quitar carga de CSD → «Resetear claves»
3. **A2** — Alta de empresa: quitar paquetes (solo nombre)
4. **B2** — Usuarios ordenados por empresa
5. **E** — datos: quitar EKU del DEMO + mover Villagrán a pruebas
6. **A1** — autollenado por Código Postal + combo de Régimen fiscal
7. **B1** — módulos por usuario (uno o varios)
8. **F** — precio por usuario con calendario (750 → 1,000)
9. **G** — dos paneles de contratación (NEXO / IVA)
10. **7º** — modelo "todas las empresas bajo RFC GHC1707275Y0"
- **H** (infra SatGo / IVA) lo hace el **usuario** en Render, en paralelo.

---

## A · Súper Admin — Alta de empresa
**Dónde:** `frontend/src/pages/AdminCompanies.tsx` · `backend/src/modules/admin/admin-companies.routes.ts`

- [ ] **A1 · Autollenado por Código Postal + Régimen fiscal (meta: 80–90% precargado).**
  - Campo CP → al teclearlo, autollenar **estado, municipio y colonia**. El **catálogo CP ya existe** en la BD
    (migraciones `2026-08-18e_catalogos_cp_columnas_cruzadas.sql`, `2026-08-18f_catalogo_cp_restos.sql`): hay que
    exponer un endpoint `GET /catalogos/cp/:cp` (si no existe) que regrese estado/municipio + **lista de colonias**.
  - Si el CP trae **varias colonias** → **combo** con las que coinciden (y estado/municipio en solo-lectura).
  - **Combo de Régimen fiscal** (catálogo SAT `c_RegimenFiscal`, ~fijo). Dejarlo elegible en el alta.
  - Resultado: al pasar al usuario, su empresa ya trae domicilio + régimen prácticamente listos.
- [ ] **A2 · Quitar "paquetes" del alta.** En el alta solo pedir **nombre de la empresa** (+ los datos fiscales de A1).
    Ya no hay paquetes (ver [[paquetes-uso-y-landing-nexo]]). Nota: la pantalla **«Respaldos»** (`/admin/packages`,
    `AdminPackages.tsx`) es otra cosa (respaldo SAT ZIP) — **no** se toca aquí; esto es quitar la selección de paquete
    del formulario de alta.

## B · Súper Admin — Usuarios
**Dónde:** `frontend/src/pages/AdminUsers.tsx` (+ `users.extra_modules` / `work_group`, ver [[usuarios-modulos-extra]])

- [x] **B1 · Módulos por usuario (uno o varios).** HECHO (2026-10-13, commit `bb8e78a`): el alta de usuario trae
    el checklist de módulos (todo el catálogo `MODULE_LABELS`); se marca uno o varios y los que ya da el grupo salen
    en gris. Backend `POST /admin/users` acepta y persiste `extra_modules`. La **lista de módulos** = el catálogo
    completo. **Pendiente de decisión (no bloquea):** si el cobro cambia por módulo o sigue plano por usuario (va con F).
- [ ] **B2 · Ordenar la lista de Usuarios por empresa** (agrupados/orden por `business_name`).

## C · Súper Admin — menú Empresas
**Dónde:** `frontend/src/pages/AdminCompanies.tsx` (+ ruta backend de reset)

- [x] **C1 · Quitar el icono de carga de CSD** y cambiarlo por **«Resetear claves de acceso»**. HECHO (2026-10-13,
    commit `25da6f5`): el renglón de Empresas cambió el ícono de CSD por **«Resetear claves»** (KeyRound). Abre un
    modal que **lista los usuarios de la empresa** y resetea al que elijas: temporal + **cambio forzado** en el
    próximo login (`password_change_required`), y la muestra en pantalla. La carga de CSD sigue en **Editar empresa**.
    Decisión resuelta: se elige al usuario en el modal (maneja 1 o varios); la temporal se muestra en pantalla.

## D · Sidebar — quitar 2 opciones
**Dónde:** `frontend/src/components/Layout.tsx`

- [ ] **D1** · Quitar **«Promoción y cobros»** (`/admin/promocion`, línea ~693) y **«Importar XML»**
    (`/import-xml`, línea ~694). Dejar **«Respaldos»** (`/admin/packages`). Las rutas pueden quedarse muertas o
    redirigir; el ask es sacarlas del sidebar.

## E · Datos / RFC
- [ ] **E1 · Eliminar el RFC `EKU9003173C9`** de la empresa **GDM NEXO DEMO** (está de más). Aparece en
    `admin-companies.routes.ts`, `seed-examples.js`, `pac.service.ts`, `render.yaml`. ⚠ Definir si se borra el
    **registro de empresa/RFC** o solo se desliga; EKU es el RFC genérico de pruebas del SAT.
- [ ] **E2 · Mover a pruebas** la empresa **EDGAR VILLAGRAN GARCIA · `VIGE6601128E1`** (es de GRUPO HCGM).
    Usar el mismo mecanismo de ambientes de prueba (`AdminDemos.tsx` / flag demo). ⚠ Confirmar que la empresa ya existe.

## F · Precio por usuario — calendario
**Dónde:** `frontend/src/pages/AdminFacturacion.tsx` · `facturacion-usuarios.service` · `facturacion_config`
(ver [[cobro-por-usuario-algoritmo]])

- [ ] **F1 · Plasmar el costo unitario por usuario con fechas:**
  - **12/10/2026 → 31/12/2026:** **$750 + IVA** por usuario (precio de introducción).
  - **Desde 01/01/2027:** **$1,000 + IVA** por usuario para **nuevas** contrataciones (precio del resto del año).
  - **Igualar** a los que contrataron en la ventana 12/10–31/12/2026.
  - ⚠ **Decisión clave (confirmar):** *"precio de 6 meses"* — ¿los que entran a $750 lo conservan **6 meses** y luego
    suben a $1,000, o todos se **igualan a $1,000 el 01/01/2027**? Esto define si se necesita **precio por cohorte/fecha
    de contratación** (`companies.precio_contratado` + `vigente_hasta`) o un solo precio global con fecha de cambio.

## G · Dos paneles de contratación (NEXO / IVA)
- [ ] **G1** · Separar la vista de contratación/facturación por **producto**: un panel para quienes contratan **NEXO**
    y otro para quienes contratan **IVA** (IVA.HTML como producto de autoservicio, ver [[iva-html-satgo]] y
    `IVA.HTML/COMERCIALIZACION_IVA.md`). ⚠ Confirmar si son dos **pestañas/pantallas** dentro de Súper Admin →
    Facturación, o dos tableros separados, y qué métricas lleva cada uno.

## 7º · Modelo "empresas bajo RFC GHC1707275Y0"
- [ ] **G/arquitectura** · Permitir que, al generar empresas, queden asociadas al **RFC GHC1707275Y0** para que el
    **súper admin configure los CSD y facture** (de una o varias empresas) de forma central — modelo tipo matriz/despacho.
    ⚠ **Decisión de arquitectura (confirmar alcance ANTES de tocar):** cómo convive con los **RFC reales** que sí se
    cobran (p. ej. `BEOA730829LJ0`), con la **exención** (GHC/SAJ, [[exencion-facturacion-dos-rfc]]) y con la
    **autofacturación/multi-RFC**. Riesgo alto si se mezcla el RFC emisor; definir bien antes de codificar.

---

## H · Infra — **paso a paso para el usuario** (hacer en Render / hosting de IVA)

### H1 · SatGo — descarga masiva (`wssolicita`)
1. **Probar si el plan ya lo trae:** en Render → servicio **gdm-almacen-backend** → *Environment* → poner
   `SAT_DESCARGA_VIA=satgo` → *Save* (reinicia solo). Entrar a **XML del SAT** y lanzar una descarga de un RFC con
   e.firma cargada.
2. Si responde **403 · featureCode "wssolicita"** → el plan **no** lo incluye: **contratar/actualizar** el plan de
   SatGo que traiga **descarga masiva** (`wssolicita`; ojalá también `comunicadosfiel`/`notificacionesfiel` para el
   buzón). Vía portal `web.sat-go.com` o tu ejecutivo de SatGo.
3. **Mientras tanto:** en Render **quitar** `SAT_DESCARGA_VIA=satgo` (o ponerlo en `oficial`) → NEXO usa el **WS oficial
   del SAT (gratis)**.
4. Cuando el plan lo incluya: volver a `SAT_DESCARGA_VIA=satgo`, reiniciar y **validar una descarga real**.

### H2 · IVA.HTML — desplegar con SatGo
1. **Conseguir la API Key de SatGo:** del portal `web.sat-go.com` **o** dejar que IVA la genere solo poniendo
   `SATGO_PORTAL_TOKEN` (IVA hace `CreateKey`).
2. En el **hosting de IVA** (Render de `iva.hcgm.com.mx`) → *Environment*: poner **`SATGO_API_KEY=<la llave>`**
   (y `SATGO_BASE_URL=https://api.sat-go.com` si falta).
3. **Reiniciar** el servicio.
4. Probar una **descarga del IVA del mes**. (Aplica el **mismo plan** con descarga masiva del punto H1.)
> Nota: IVA corre en **Render**, no en cPanel/hosting-mexico (ver [[iva-html-satgo]]). Subir ZIPs a cPanel no sirve.

---

## I · Publicar en hosting mexico (cPanel) — al cerrar cada tanda de frontend
- [ ] **I1 · Generar el .zip y re-subir a cPanel.** `hcgm.com.mx/erp` es estático y NO se actualiza con el push.
    Tras cualquier cambio de **frontend** (p. ej. este Punto 1, y todo A–G):
    1. `cd E:\Obsidian\GDM_NEXO\frontend && npm run build:hosting` → genera `frontend\dist-hosting\nexo-erp-hosting.zip`.
    2. cPanel → Administrador de archivos → `public_html` → subir el ZIP y **descomprimir** sobre `public_html/erp/`.
    Los cambios de **backend** NO lo necesitan (el push a `main` ya los sirve a ambas URLs). Ver `DESPLIEGUE_HCGM_ERP.md`.

## ⚠ Para confirmar mañana antes de arrancar
1. **F1** — ¿$750 por 6 meses y luego $1,000, o todos a $1,000 el 01/01/2027? (define precio por cohorte vs global).
2. **7º** — alcance del modelo "todas las empresas bajo GHC1707275Y0" vs RFC reales que se cobran / exención / multi-RFC.
3. **B1** — lista exacta de módulos a ofrecer por usuario (y si el precio sigue plano por usuario).
4. **C1** — a qué usuario se resetea y cómo se entrega la clave temporal.
5. **E1** — ¿borrar el registro de EKU o solo desligarlo del DEMO?
6. **G1** — forma de los dos paneles (pestañas en Facturación vs tableros separados).
