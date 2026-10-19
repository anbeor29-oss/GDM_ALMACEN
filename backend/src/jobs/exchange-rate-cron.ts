/**
 * exchange-rate-cron — actualización diaria de tipos de cambio.
 *
 * Base: TIPOS_CAMBIO_BANXICO.MD §"Proceso Automático".
 *
 * Corre todos los días a las 5:30 (hora de México). A esa hora Banxico aún no
 * determina el FIX de hoy, así que la consulta trae el ÚLTIMO FIX publicado —que
 * es justamente el que se aplica a las operaciones del día (Art. 20 CFF: el del
 * día hábil inmediato anterior)—. Así el tipo de cambio está listo a primera hora.
 *
 * Si algo falla, reintenta UNA vez a los 30 minutos. No se insiste más: si sigue
 * caído, la facturación continúa con el último tipo de cambio vigente y la
 * bitácora deja constancia. Un reintento infinito solo llenaría el log.
 */

import cron from 'node-cron';
import logger from '../middleware/logger';
import { updateExchangeRates } from '../modules/exchange-rates/exchange-rate.service';

const ZONA = 'America/Mexico_City';

async function actualizar(intento: 1 | 2): Promise<void> {
  const etiqueta = intento === 1 ? 'diario' : 'reintento';
  try {
    const { actualizadas, fallidas } = await updateExchangeRates('CRON');

    for (const t of actualizadas) {
      logger.info(`[tc-cron] ${t.moneda} = ${t.valor} (rige ${t.fecha}, determinado ${t.fechaDeterminacion})`);
    }

    if (!fallidas.length) {
      logger.info(`[tc-cron] ${etiqueta}: ${actualizadas.length}/3 monedas al día`);
      return;
    }

    for (const f of fallidas) {
      logger.warn(`[tc-cron] ${f.moneda} no se pudo actualizar: ${f.error}`);
    }

    if (intento === 1) {
      logger.warn(`[tc-cron] reintentando en 30 minutos las que fallaron`);
      setTimeout(() => {
        actualizar(2).catch(e => logger.error(`[tc-cron] reintento falló: ${e.message}`));
      }, 30 * 60 * 1000);
    } else {
      logger.error(
        `[tc-cron] tras el reintento siguen sin actualizar: ${fallidas.map(f => f.moneda).join(', ')}. ` +
        `La facturación usará el último tipo de cambio vigente; captúralo a mano si urge.`,
      );
    }
  } catch (e: any) {
    logger.error(`[tc-cron] ${etiqueta} falló por completo: ${e.message}`);
    if (intento === 1) {
      setTimeout(() => {
        actualizar(2).catch(err => logger.error(`[tc-cron] reintento falló: ${err.message}`));
      }, 30 * 60 * 1000);
    }
  }
}

export function registerExchangeRateCron(): void {
  if (!process.env.BANXICO_TOKEN) {
    logger.warn(
      '[tc-cron] Sin BANXICO_TOKEN: no hay actualización automática. ' +
      'Los tipos de cambio se capturan a mano desde Datos de la empresa → Tipos de cambio.',
    );
    return;
  }

  // 5:30 hora de México, TODOS los días: el tipo de cambio queda disponible a
  // primera hora. En fin de semana Banxico no determina nada nuevo, así que la
  // consulta sólo reafirma el último FIX (el del viernes) —sin efecto, sin ruido—.
  cron.schedule('30 5 * * *', () => {
    actualizar(1).catch(e => logger.error(`[tc-cron] error no capturado: ${e.message}`));
  }, { timezone: ZONA });

  logger.info('[tc-cron] Registrado: todos los días 5:30 (America/Mexico_City)');

  // Al arrancar, si la base viene vacía o el servicio estuvo caído varios
  // días, se hace una consulta para no empezar el día sin dato.
  setTimeout(() => {
    actualizar(1).catch(e => logger.warn(`[tc-cron] carga inicial: ${e.message}`));
  }, 20_000);
}
