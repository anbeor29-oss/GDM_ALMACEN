/*
 * Un crédito se abona UNA sola vez por periodo.
 *
 * POR QUÉ HACE FALTA
 * El cierre del periodo escribe los recibos y abona los préstamos en la misma
 * transacción, y lo hace con ON CONFLICT DO NOTHING para que reintentar un
 * cierre que se cayó no descuente dos veces. Ese ON CONFLICT necesita un índice
 * único detrás: sin él Postgres lo rechaza (42P10) y, peor, la idempotencia que
 * el código promete no existe. Un abono duplicado le cobra al trabajador dos
 * veces la misma quincena de su préstamo.
 *
 * POR QUÉ ES PARCIAL
 * periodo_id es nulo en los abonos capturados a mano desde la pantalla de
 * créditos —un pago en efectivo fuera de nómina, por ejemplo—. Esos sí pueden
 * ser varios y no cuelgan de ningún periodo, así que quedan fuera del índice.
 */

/* Si una corrida anterior alcanzó a duplicar abonos, nos quedamos con el
 * primero de cada (crédito, periodo). Es el que corresponde al cierre que sí
 * ajustó el saldo; los siguientes vienen de un reintento. */
DELETE FROM nomina_credito_abonos a
 USING nomina_credito_abonos b
 WHERE a.periodo_id IS NOT NULL
   AND a.credito_id = b.credito_id
   AND a.periodo_id = b.periodo_id
   AND a.created_at > b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS uq_nomina_credito_abonos_periodo
  ON nomina_credito_abonos (credito_id, periodo_id)
  WHERE periodo_id IS NOT NULL;

COMMENT ON INDEX uq_nomina_credito_abonos_periodo IS
  'Un abono por crédito y periodo. Sostiene el ON CONFLICT del cierre: '
  'reintentar un cierre no vuelve a descontarle al trabajador.';
