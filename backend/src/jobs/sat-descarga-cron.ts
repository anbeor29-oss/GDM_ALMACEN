/**
 * sat-descarga-cron — el motor avanza solo mientras nadie mira.
 *
 * POR QUÉ CADA 15 MINUTOS Y NO CADA MINUTO
 * El SAT tarda de minutos a horas en dejar listo un paquete. Preguntar cada
 * minuto no lo apura: sólo gasta cuota de un servicio compartido y acerca el
 * momento en que responde 5002 ("se agotó el límite de solicitudes"). Quince
 * minutos alcanzan de sobra para recoger un paquete dentro de su ventana de 72
 * horas, y cada partición lleva además su propia espera exponencial.
 *
 * POR QUÉ NO ARRANCA SOLO
 * A diferencia del cron de auditoría —que sólo pregunta—, éste usa la e.firma
 * de una empresa para actuar ante el SAT en su nombre. Eso se enciende a
 * propósito: ENABLE_SAT_DESCARGA_CRON=true. Un motor que empieza a firmar
 * solicitudes porque alguien desplegó una versión nueva no es una comodidad,
 * es una sorpresa.
 *
 * SÓLO ATIENDE EMPRESAS CON TRABAJO ABIERTO
 * Sin trabajos en curso no se autentica siquiera: no tiene sentido presentar la
 * e.firma ante el SAT para no pedirle nada.
 */

import cron from 'node-cron';
import logger from '../middleware/logger';
import { query } from '../config/database';
import { avanzar } from '../modules/sat-descarga/descarga.service';
import { bovedaLista } from '../modules/sat-descarga/boveda';

export function registerSatDescargaCron(): void {
  if (process.env.ENABLE_SAT_DESCARGA_CRON !== 'true') {
    logger.info('[sat-descarga-cron] Deshabilitado (ENABLE_SAT_DESCARGA_CRON != true)');
    return;
  }
  if (!bovedaLista()) {
    logger.warn('[sat-descarga-cron] No arranca: falta SAT_VAULT_KEY');
    return;
  }

  // '*/15 * * * *' → cada 15 minutos
  cron.schedule('*/15 * * * *', () => {
    correrPendientes().catch((e) =>
      logger.error(`[sat-descarga-cron] falló la corrida: ${e.message}`)
    );
  });

  logger.info('[sat-descarga-cron] Registrado: avanza los trabajos abiertos cada 15 minutos');
}

async function correrPendientes(): Promise<void> {
  const empresas = await query<any>(
    `SELECT DISTINCT t.company_id
       FROM sat_trabajos t
      WHERE t.estado IN ('CREADO', 'EN_PROCESO')`
  );
  if (empresas.rows.length === 0) return;

  for (const e of empresas.rows) {
    try {
      const r = await avanzar(e.company_id);
      if (r.descargados || r.verificados || r.solicitados || r.divididos) {
        logger.info(
          `[sat-descarga-cron] ${e.company_id}: ${r.solicitados} solicitud(es), ` +
          `${r.verificados} verificación(es), ${r.descargados} paquete(s), ` +
          `${r.divididos} división(es)`
        );
      }
      if (r.errores.length) {
        logger.warn(`[sat-descarga-cron] ${e.company_id}: ${r.errores.slice(0, 3).join(' · ')}`);
      }
    } catch (err) {
      /* Una empresa con la e.firma vencida no puede dejar sin avanzar a las
       * demás. Se registra y se sigue. */
      logger.warn(`[sat-descarga-cron] empresa ${e.company_id}: ${(err as Error).message}`);
    }
  }
}
