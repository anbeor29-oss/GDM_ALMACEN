/**
 * lista-69b-cron — el padrón del 69-B se refresca solo.
 *
 * POR QUÉ SEMANAL Y NO DIARIO
 * El SAT no publica todos los días: la corrida de mayo de 2026 salió con fecha
 * de archivo del 17 de junio, y entre corte y corte pasan semanas. Bajar 4.7 MB
 * cada madrugada para reescribir catorce mil renglones idénticos es carga sin
 * ganancia. Semanal alcanza de sobra para que la lista nunca tenga más de siete
 * días de atraso.
 *
 * POR QUÉ ESTE SÍ ES OPT-IN
 * A diferencia del cron de auditoría —que sólo pregunta y anota—, éste
 * REEMPLAZA el padrón con el que se juzga a los proveedores, y lo hace bajando
 * un archivo de un servidor ajeno. Si esa dirección un día devuelve otra cosa,
 * el efecto recae sobre datos con consecuencias fiscales. Que alguien tenga que
 * encenderlo a conciencia es parte del punto.
 *
 * Para encenderlo: ENABLE_69B_CRON=true
 *
 * QUE FALLE NO ROMPE NADA
 * El servicio comprueba tamaño y contenido antes de importar; si algo no cuadra
 * revienta ANTES de tocar la base y el padrón anterior se queda como estaba.
 * Lo peor que pasa es que la lista envejezca una semana más — y la pantalla
 * enseña la fecha de corte, así que se nota.
 */

import cron from 'node-cron';
import logger from '../middleware/logger';
import { actualizarDesdeElSat, URL_69B } from '../modules/auditoria/descarga-69b.service';

export function registerLista69BCron(): void {
  if (process.env.ENABLE_69B_CRON !== 'true') {
    logger.info('[69b-cron] Apagado (para encenderlo: ENABLE_69B_CRON=true)');
    return;
  }

  /* Domingo 03:30. Fuera de horario de trabajo y antes del cron de auditoría de
   * las 04:00, para que la revisión del lunes cruce contra el padrón fresco. */
  cron.schedule('30 3 * * 0', () => {
    actualizarDesdeElSat()
      .then((r) =>
        logger.info(
          `[69b-cron] padrón actualizado: ${r.renglones} contribuyentes ` +
          `(${r.nuevos} nuevos, ${r.actualizados} actualizados) en ${r.segundos}s`
        )
      )
      .catch((e) =>
        logger.error(
          `[69b-cron] falló: ${e.message} — el padrón anterior sigue intacto. ` +
          `Dirección configurada: ${URL_69B}`
        )
      );
  });

  logger.info('[69b-cron] Programado: domingos 03:30');
}
