/**
 * presencia.service — quién más está parado en la misma pantalla.
 *
 * QUÉ RESUELVE
 * Dos personas abren la misma Carta Porte, cada una captura veinte minutos y la
 * segunda en guardar borra el trabajo de la primera. El daño no lo hace que
 * trabajen a la vez —eso tiene que poder pasar— sino que no se vean.
 *
 * PRIORIDAD, NO EXCLUSIVIDAD
 * `entro_at` define quién llegó primero, y eso es lo que se le dice al que llega
 * después. Pero nadie queda bloqueado: los dos capturan. Un candado real
 * congelaría el documento de quien se fue a comer con la pantalla abierta, y
 * acabaría necesitando un botón de "forzar" que devuelve el problema al inicio.
 *
 * EL LATIDO ES LA ÚNICA SEÑAL DE VIDA
 * Nadie cierra sesión con el botón: se cierra la laptop, se cae el internet, se
 * duerme la máquina. Por eso una presencia vale 90 segundos desde su último
 * latido y el frente late cada 30 — tres oportunidades antes de desaparecer, que
 * es lo que aguanta un wifi de bodega.
 */

import { query } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';

/** Segundos que sobrevive una presencia sin latir. */
export const VIDA_SEGUNDOS = 90;

export interface Presente {
  userId: string;
  email: string;
  nombre: string;
  entroAt: string;
  latidoAt: string;
  /** Minutos que lleva en la pantalla — es lo que se muestra. */
  minutos: number;
}

function limpiaRecurso(v: any, campo: string, max: number): string {
  const s = String(v ?? '').trim();
  if (!s) throw new ValidationError(`Falta ${campo}`);
  return s.slice(0, max);
}

/**
 * Anuncia que este usuario está aquí y devuelve a los DEMÁS que también están.
 *
 * Es una sola operación —entrar y mirar— porque el frente necesita las dos
 * cosas en el mismo instante: separarlas abriría una ventana en la que dos
 * personas entran a la vez y ninguna ve a la otra.
 */
export async function entrar(
  companyId: string,
  user: { userId: string },
  recurso: string,
  recursoId: string
): Promise<{ presentes: Presente[]; soyElPrimero: boolean }> {
  const r = limpiaRecurso(recurso, 'el recurso', 40);
  const rid = limpiaRecurso(recursoId, 'el identificador', 64);

  /* El nombre sale de `users` dentro del mismo INSERT.
   *
   * El JWT sólo trae correo, y el aviso tiene que decir "Antonio Bernal está
   * capturando esto", no "admin@gdmfac2.local". Resolverlo con un SELECT aparte
   * costaría una consulta extra en CADA latido —uno cada 30 segundos por
   * pantalla abierta—; aquí no cuesta ninguna. */
  await query(
    `INSERT INTO presencia_edicion
       (company_id, recurso, recurso_id, user_id, user_email, user_nombre)
     SELECT $1, $2, $3, u.id, u.email,
            NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), '')
       FROM users u WHERE u.id = $4
     ON CONFLICT (company_id, recurso, recurso_id, user_id) DO UPDATE
       SET latido_at = NOW(),
           /* entro_at NO se toca: si se actualizara, recargar la página
            * convertiría al primero en el último y la prioridad sería de quien
            * más veces le da F5. */
           user_email = EXCLUDED.user_email,
           user_nombre = EXCLUDED.user_nombre`,
    [companyId, r, rid, user.userId]
  );

  return quienEsta(companyId, r, rid, user.userId);
}

/** Los que siguen vivos en ese recurso, sin contar a quien pregunta. */
export async function quienEsta(
  companyId: string,
  recurso: string,
  recursoId: string,
  exceptoUserId?: string
): Promise<{ presentes: Presente[]; soyElPrimero: boolean }> {
  const r = await query<any>(
    `SELECT user_id, user_email, user_nombre, entro_at, latido_at,
            GREATEST(0, EXTRACT(EPOCH FROM (NOW() - entro_at)) / 60)::int AS minutos
       FROM presencia_edicion
      WHERE company_id = $1 AND recurso = $2 AND recurso_id = $3
        AND latido_at > NOW() - INTERVAL '${VIDA_SEGUNDOS} seconds'
      ORDER BY entro_at ASC`,
    [companyId, recurso, recursoId]
  );

  const todos = r.rows;
  /* Quien llegó primero es el de entro_at más antiguo — el primer renglón,
   * porque la consulta ya viene ordenada. */
  const soyElPrimero = !!exceptoUserId && todos.length > 0 && todos[0].user_id === exceptoUserId;

  const presentes: Presente[] = todos
    .filter((p) => p.user_id !== exceptoUserId)
    .map((p) => ({
      userId: p.user_id,
      email: p.user_email || '',
      nombre: (p.user_nombre || p.user_email || 'Alguien').trim(),
      entroAt: p.entro_at,
      latidoAt: p.latido_at,
      minutos: Number(p.minutos || 0),
    }));

  return { presentes, soyElPrimero };
}

/** Se va: cerrar la pantalla libera el renglón sin esperar a que expire. */
export async function salir(
  companyId: string,
  userId: string,
  recurso: string,
  recursoId: string
): Promise<void> {
  await query(
    `DELETE FROM presencia_edicion
      WHERE company_id = $1 AND user_id = $2 AND recurso = $3 AND recurso_id = $4`,
    [companyId, userId, recurso, recursoId]
  );
}

/**
 * Barrido de presencias muertas.
 *
 * Se llama desde la propia consulta de entrada, no desde un cron: son renglones
 * que ya nadie lee —la consulta los filtra por latido— y borrarlos es sólo
 * higiene. Un cron para esto es una pieza más que mantener y que alguien tiene
 * que acordarse de encender.
 */
export async function barrerMuertas(): Promise<number> {
  const r = await query(
    `DELETE FROM presencia_edicion
      WHERE latido_at < NOW() - INTERVAL '${VIDA_SEGUNDOS * 10} seconds'`
  );
  return r.rowCount || 0;
}
