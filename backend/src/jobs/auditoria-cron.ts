/**
 * auditoria-cron — cada CFDI se revisa ante el SAT cada 72 horas.
 *
 * POR QUÉ CORRE A DIARIO SI EL CICLO ES DE 72 HORAS
 * Un cron de calendario "cada 3 días" (`* * *&#47;3 * *`) se desfasa en los meses
 * de 31 días —salta del 31 al 1— y deja huecos irregulares. Peor: si el
 * servidor está caído justo ese día, la revisión se pierde hasta tres días
 * después.
 *
 * Corriendo a diario y tomando sólo los comprobantes con más de 72 horas sin
 * revisar, cada CFDI lleva su propio reloj, la carga queda repartida entre los
 * días y un día perdido se recupera solo al siguiente.
 *
 * LA MADRUGADA NO ES CAPRICHO
 * El servicio de consulta del SAT es público y compartido con todo el país; a
 * las 4 de la mañana responde, a mediodía de fin de mes no siempre. Y aunque
 * falle, fallar de madrugada no le estorba a nadie: la corrida se limita a
 * marcar "sin respuesta" y lo vuelve a intentar al día siguiente.
 *
 * VIENE ENCENDIDO, AL REVÉS QUE LOS DEMÁS CRONES
 * Los otros son opt-in porque mueven datos: facturan, cierran cajas, generan
 * órdenes. Éste sólo PREGUNTA y anota la respuesta — no cancela, no timbra, no
 * toca inventario. Dejarlo apagado por omisión significaría que la auditoría no
 * corre hasta que alguien se acuerde de encender una variable en el servidor, y
 * la única señal de que no corrió sería una pantalla en ceros que se ve igual
 * que "todo está bien".
 *
 * Para apagarlo: ENABLE_AUDITORIA_CRON=false.
 */

import cron from 'node-cron';
import logger from '../middleware/logger';
import { correrAuditoriaGlobal, HORAS_ENTRE_REVISIONES } from '../modules/auditoria/auditoria.service';

export function registerAuditoriaCron(): void {
  if (process.env.ENABLE_AUDITORIA_CRON === 'false') {
    logger.info('[auditoria-cron] Apagado a propósito (ENABLE_AUDITORIA_CRON=false)');
    return;
  }

  // '0 4 * * *' → diario 04:00 (hora servidor)
  cron.schedule('0 4 * * *', () => {
    correrAuditoriaGlobal()
      .then((r) => logger.info(`[auditoria-cron] corrida terminada: ${JSON.stringify(r)}`))
      .catch((e) => logger.error(`[auditoria-cron] falló: ${e.message}`));
  });

  logger.info(
    `[auditoria-cron] Registrado: revisión diaria 04:00 de los comprobantes ` +
    `con más de ${HORAS_ENTRE_REVISIONES} h sin verificar ante el SAT`
  );
}
