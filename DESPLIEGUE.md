# Despliegue — DESARROLLO vs PRODUCCIÓN

GDM NEXO se despliega desde **un solo código** en **dos ramas** del remoto `gdmalmacen`
(GitHub `anbeor29-oss/GDM_ALMACEN`), cada una atada a **su propio servicio de Render**.
Todo el ERP se despliega en ambas; **qué módulos ve cada empresa se controla desde el
Súper Administrador** (grupo de trabajo + módulos adicionales por usuario), no por rama.

## Ramas

| Rama (remoto `gdmalmacen`) | Para qué | Servicio de Render |
|---|---|---|
| `main` | **Desarrollo / pruebas** — aquí caen los cambios nuevos para probarlos en vivo. | servicio actual (dev) |
| `produccion` | **Producción** — lo estable, comercial. Solo recibe lo YA probado. | servicio nuevo (lo creas tú apuntando a esta rama) |

> La rama local de trabajo es **`erp-unificado`**; se empuja a `gdmalmacen/main` (dev).

## Flujo de trabajo

1. **Desarrollar y probar (dev):**
   ```bash
   git push gdmalmacen erp-unificado:main
   ```
   Render redepliega el servicio de **desarrollo**; ahí se prueba.

2. **Promover a producción (cuando ya quedó probado):**
   ```bash
   git push gdmalmacen erp-unificado:produccion
   ```
   Esto avanza `produccion` al estado probado y Render redepliega el servicio de
   **producción**. Producción SÓLO cambia con este empujón deliberado.

> Alternativa equivalente: hacer el *merge* `main → produccion` desde GitHub (un PR),
> por si se prefiere dejar rastro/revisión de cada promoción.

## Lo que hay que configurar UNA vez (Render)

- **Servicio de producción nuevo**: mismo repo, **Branch = `produccion`**, mismas
  variables de entorno que el de dev **pero con su propia base de datos** (para no
  mezclar datos de prueba con los reales) y su propio dominio.
- Las migraciones corren solas al arrancar (`arranque-produccion.js` → `migrate-up.js`),
  así que producción se pone al día sin pasos manuales.
- El **timbrado real** (PAC producción, SW Sapien) se activa SÓLO en producción con sus
  3 variables; dev queda en sandbox/simulación para no emitir CFDI reales de prueba.

## Módulos por empresa (comercial)

Se exponen **todos los módulos**; cada empresa/cliente ve los que le tocan desde el
**Súper Administrador → Usuarios → Permisos** (grupo de trabajo + «Módulos adicionales»).
Así el mismo despliegue de producción sirve para vender Nómina, Factura, Almacén,
Tesorería, Compras (o lo que se acuerde) por empresa, sin ramas distintas.
