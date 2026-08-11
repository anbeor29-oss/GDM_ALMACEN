-- ============================================================================
-- PRESENCIA — quién más está parado en esta pantalla
--
-- LO QUE SE COMPROBÓ ANTES DE ESCRIBIR ESTO
-- Nada impide hoy que dos personas trabajen en el mismo módulo. Los `FOR UPDATE`
-- que hay viven dentro de transacciones que duran milisegundos —el tiempo de
-- descontar existencias o marcar un pago—, no mientras alguien tiene un
-- formulario abierto. No hacía falta quitar ningún candado.
--
-- EL PROBLEMA REAL NO ERA EL BLOQUEO, ERA LA CEGUERA
-- Dos personas abren la misma Carta Porte, cada una captura veinte minutos, y
-- la segunda en guardar borra el trabajo de la primera sin que ninguna se
-- entere. El daño no lo hace la concurrencia: lo hace no verla.
--
-- POR QUÉ UN AVISO Y NO UN CANDADO
-- Un candado que reserva el registro para el primero suena más seguro y en la
-- práctica es peor: el que se fue a comer con la pantalla abierta deja el
-- documento congelado, y alguien acaba pidiendo un botón para "forzar" que
-- vuelve al mismo punto. Aquí los dos pueden trabajar —que es lo que se pidió—,
-- pero cada uno ve al otro, con nombre y desde qué hora.
--
-- SE BORRA SOLO
-- Un renglón sin latido en 90 segundos ya no cuenta: nadie cierra sesión con el
-- botón, se cierra la laptop. La tabla se limpia sola en cada consulta en vez de
-- necesitar un cron que nadie recuerda encender.
-- ============================================================================

CREATE TABLE IF NOT EXISTS presencia_edicion (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Qué se está viendo. `recurso_id` es texto y no UUID a propósito: las
  -- pantallas de alta todavía no tienen id y se identifican como 'nuevo'.
  recurso     VARCHAR(40) NOT NULL,
  recurso_id  VARCHAR(64) NOT NULL,

  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_email  VARCHAR(255),
  user_nombre VARCHAR(200),

  entro_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  latido_at   TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Una persona, una presencia por pantalla. Si recarga, se actualiza la que
  -- ya tenía en vez de acumular renglones fantasma.
  UNIQUE (company_id, recurso, recurso_id, user_id)
);

/* La consulta es siempre la misma: quién está en ESTE recurso y sigue vivo. */
CREATE INDEX IF NOT EXISTS ix_presencia_recurso
  ON presencia_edicion (company_id, recurso, recurso_id, latido_at DESC);

/* Y la de limpieza: los muertos de toda la empresa. */
CREATE INDEX IF NOT EXISTS ix_presencia_latido
  ON presencia_edicion (latido_at);

COMMENT ON TABLE presencia_edicion IS
  'Quién tiene abierta cada pantalla. Es un aviso, no un candado: los dos '
  'pueden trabajar, pero se ven. Un renglón sin latido en 90 s se descarta.';

COMMENT ON COLUMN presencia_edicion.entro_at IS
  'Cuándo llegó. Define la prioridad: el de entro_at más antiguo es "quien '
  'llegó primero", y así se le anuncia al que llega después.';
