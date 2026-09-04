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
import { crearTrabajoDiario } from '../modules/sat-descarga/programacion.service';
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

  /* Cada 45 minutos: asegura el trabajo del día y avanza lo que ya está pedido.
   *
   * (La expresión cron va abajo, en el código. Escribirla aquí dentro
   * cerraría este comentario: lleva una barra y un asterisco juntos.)
   *
   * DE DÍA basta con 45 min: el SAT tarda minutos u horas en dejar un paquete y
   * preguntar más seguido sólo gasta cuota. DE NOCHE (10PM–7AM, hora de México),
   * cuando el SAT está menos saturado, `correrPendientes` empuja con un FACTOR
   * alto (atiende más paquetes/solicitudes por corrida) para vaciar el rezago.
   *
   * ── POR QUÉ TAMBIÉN AQUÍ, SI YA HAY UNO A LAS 6:00 ──
   * Un reloj con una sola oportunidad al día es frágil: si el servicio está
   * reiniciando a las 6:00 —un despliegue, un reinicio de Render— ese día se
   * pierde entero. Como crearTrabajoDiario es idempotente por día, llamarlo cada
   * rato no crea nada de más; el de las 6:00 sigue por previsibilidad, éste es la red. */
  cron.schedule('*/45 * * * *', () => {
    (async () => {
      await crearDiarios();
      await correrPendientes();
    })().catch((e) =>
      logger.error(`[sat-descarga-cron] falló la corrida: ${e.message}`)
    );
  });

  /* ── El trabajo de cada día, a hora fija ──
   *
   * El cron de arriba sólo AVANZA trabajos que ya existen. Nunca creaba
   * ninguno, así que "descargar a diario" dependía de que alguien entrara a la
   * pantalla y pulsara el botón. Los días que nadie entra no había CFDI, y ese
   * hueco se descubre meses después — cuando el mes ya se declaró.
   *
   * A las 6:00, hora de México. No a medianoche: el SAT tarda en publicar lo
   * del día que acaba de cerrar, y pedirlo a las 00:05 trae menos de lo que
   * hay. */
  cron.schedule('0 6 * * *', () => {
    crearDiarios().catch((e) =>
      logger.error(`[sat-descarga-cron] falló la creación diaria: ${e.message}`)
    );
  }, { timezone: 'America/Mexico_City' });

  /* Al arrancar, sin esperar al primer tick: si el servicio se reinició a
   * media mañana, el día no debería quedarse sin descarga por eso. */
  setTimeout(() => {
    crearDiarios().catch((e) =>
      logger.warn(`[sat-descarga-cron] creación diaria al arrancar: ${e.message}`)
    );
  }, 20_000);

  logger.info(
    '[sat-descarga-cron] Registrado: trabajo diario a las 6:00 (CDMX), ' +
    'con red cada 15 minutos y al arrancar');
}

/**
 * Crea el trabajo del día para cada empresa con e.firma cargada.
 *
 * Sólo empresas con credencial: sin e.firma no se le puede pedir nada al SAT,
 * y llenar la bitácora de errores por eso taparía los errores reales.
 */
async function crearDiarios(): Promise<void> {
  const empresas = await query<any>(
    `SELECT c.company_id
       FROM sat_credenciales c
      WHERE c.estado = 'ACTIVA'
        AND (c.vigencia_hasta IS NULL OR c.vigencia_hasta > NOW())`
  );
  if (empresas.rows.length === 0) {
    logger.info('[sat-descarga-cron] ninguna empresa con e.firma vigente');
    return;
  }

  for (const e of empresas.rows) {
    try {
      const r = await crearTrabajoDiario(e.company_id);
      if (r.creados.length) {
        logger.info(
          `[sat-descarga-cron] diario ${e.company_id}: ` +
          r.creados.map((c) => `${c.direccion} ${c.desde}→${c.hasta}`).join(' · ')
        );
      }
      /* "Ya se creó hoy" es lo NORMAL en 95 de los 96 ticks del día: no se
       * registra, o la bitácora se vuelve ilegible y los avisos reales se
       * pierden entre el ruido. */
      const dignosDeNota = r.omitidos.filter((m) => !/ya se creó/i.test(m));
      if (dignosDeNota.length) {
        logger.info(`[sat-descarga-cron] diario ${e.company_id}: ${dignosDeNota.join(' · ')}`);
      }
    } catch (err) {
      /* Una empresa con la e.firma vencida no puede dejar sin trabajo diario a
       * las demás. Se registra y se sigue. */
      logger.warn(
        `[sat-descarga-cron] diario ${e.company_id}: ${(err as Error).message}`);
    }
  }
}

/** Factor de agresividad por hora de México: de noche (22:00–06:59, cuando el SAT
 *  está menos saturado) atiende ~4× por corrida; de día, normal. Render corre en
 *  UTC, y CDMX es UTC−6. */
function factorNocturno(): number {
  const horaCdmx = (new Date().getUTCHours() - 6 + 24) % 24;
  const esNoche = horaCdmx >= 22 || horaCdmx < 7;
  return esNoche ? 4 : 1;
}

async function correrPendientes(): Promise<void> {
  const empresas = await query<any>(
    `SELECT DISTINCT t.company_id
       FROM sat_trabajos t
      WHERE t.estado IN ('CREADO', 'EN_PROCESO')`
  );
  if (empresas.rows.length === 0) return;

  const factor = factorNocturno();
  for (const e of empresas.rows) {
    try {
      const r = await avanzar(e.company_id, undefined, factor);
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
