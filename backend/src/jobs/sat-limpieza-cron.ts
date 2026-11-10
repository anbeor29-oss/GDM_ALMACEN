/**
 * sat-limpieza-cron — vacía a diario las solicitudes de descarga del SAT que ya NO
 * aportan valor: las TERMINADAS, CANCELADAS y las que quedaron CON ERRORES.
 *
 * Es el mismo botón «Limpiar» que el usuario tiene en la consola de Descarga (XML del
 * SAT), pero para TODAS las empresas y automático. Sólo BORRA registros de control
 * (`sat_trabajos`); los XML que alcanzaron a bajar están en `cfdi_recibidos` y se
 * CONSERVAN (el ON DELETE CASCADE deja su paquete_id en NULL). Un periodo que quedó con
 * error se puede volver a pedir por sus fechas.
 *
 * VIENE ENCENDIDO POR OMISIÓN (como la auditoría), porque sólo limpia la BD: no firma,
 * no llama al SAT, no mueve dinero ni inventario. Para apagarlo: ENABLE_SAT_LIMPIEZA_CRON=false.
 */
import cron from 'node-cron';
import logger from '../middleware/logger';
import { banderaApagada } from '../utils/env-flag';
import { limpiarTrabajosTerminadosTodas } from '../modules/sat-descarga/descarga.service';

export function registerSatLimpiezaCron(): void {
  if (banderaApagada(process.env.ENABLE_SAT_LIMPIEZA_CRON)) {
    logger.info('[sat-limpieza-cron] Apagado a propósito (ENABLE_SAT_LIMPIEZA_CRON=false)');
    return;
  }

  // '30 6 * * *' → todos los días 06:30 (America/Mexico_City)
  cron.schedule('30 6 * * *', () => {
    limpiarTrabajosTerminadosTodas()
      .then((r) => logger.info(`[sat-limpieza-cron] corrida terminada: ${r.trabajos} trabajo(s) borrados`))
      .catch((e) => logger.error(`[sat-limpieza-cron] falló: ${e.message}`));
  }, { timezone: 'America/Mexico_City' });

  logger.info('[sat-limpieza-cron] Registrado: limpieza diaria 06:30 (America/Mexico_City) de solicitudes TERMINADO/CANCELADO/CON_ERRORES');
}
