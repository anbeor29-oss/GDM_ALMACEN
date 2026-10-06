# Pendientes — GDM NEXO

> Lista viva de lo que falta. Actualizada 2026-10-05. Lo hecho se documenta en `BITACORA.md`.

## 🔴 Bloqueado / requiere acción del usuario (no es código)

- **Descarga por SatGo — el plan NO incluye la descarga masiva.** Al activar `SAT_DESCARGA_VIA=satgo`, el SAT devuelve
  `HTTP 403 · "Este plan no tiene acceso a esta funcionalidad" · featureCode "wssolicita" · dailyLimit 5 / monthlyLimit 5`.
  Es un **candado del plan de SatGo**, no un bug. **Acción:** contratar/actualizar el plan de SatGo que incluya la
  **descarga masiva** (feature `wssolicita`, y probablemente `comunicadosfiel`/`notificacionesfiel` para el buzón).
  **Mientras tanto:** quitar `SAT_DESCARGA_VIA=satgo` en Render para volver al **WS oficial del SAT (gratis)**.
- **IVA.HTML → desplegar.** Poner `SATGO_API_KEY` en el hosting y desplegar (el mismo plan con descarga masiva aplica).
- **Producción.** Promover cuando se dé el visto bueno: `git push gdmalmacen erp-unificado:produccion` (lo hace el usuario).

## 🟡 Por construir

- **Nómina — tabla de impuestos SEMANAL (12 meses) y ANUAL.** Hoy NEXO sólo tiene la tarifa **MENSUAL** del ISR
  (`nomina_tarifa_isr`, periodicidad `MENSUAL`, Art. 96, cotejada DOF). Falta incorporar la **tarifa SEMANAL** (para
  nóminas semanales) y la **ANUAL** (cálculo/ajuste anual), con sus 12 periodos donde aplique, y cablear el motor de
  nómina para que las use según la periodicidad del pago. Ver [[indicadores-fiscales]].
- **Punto de Venta (POS) — mejoramiento.** Mejorar el POS (`PointOfSale.tsx` / módulo pos). Falta definir alcance con
  el usuario (UX, flujo de cobro, atajos, impresión).
- **Panel fiscal con cuadrícula.** 32-D/CIF/INFONAVIT en una **rejilla tipo declaraciones** (trámite × periodo), doble
  clic para configurar/descargar. Se difirió; por ahora el hub de Cumplimiento fiscal los maneja como pestañas con
  punto verde. Ver [[satgo-integracion]].
- **PLD / antilavado.** Falta la **captura completa del expediente** (Anexos 2/3 + beneficiario controlador) y la
  **generación del XML del Aviso** para el Portal SPPLD. El módulo v1 (config + tablero de alertas) ya está. Ver
  [[pld-lfpiorpi]].

## 🔵 Por probar en vivo (requieren e.firma + plan de SatGo)

- **Descarga por SatGo** (bloqueada por el plan, ver arriba).
- **Buzón de notificaciones** (`comunicadosfiel`/`notificacionesfiel`): puede estar **gated por el mismo plan**; si lo
  está, el buzón se verá vacío (no rompe). Se confirma al tener el plan.
- **IVA.HTML por SatGo** (al desplegar).

## ✅ Terminado recientemente (resumen; detalle en BITACORA)

Batch de 7 (2026-10-05): notificaciones 6 meses · foto checador→expediente · hub Cumplimiento unificado (IMSS/INFONAVIT
+ punto verde) · rediseño de Pólizas · motor de descarga conmutable a SatGo + Comprobantes unidos · login · logo NEXO.
Antes: PLD v1, IVA→SatGo (motor), vigencias, onboarding/facturación, etc.
