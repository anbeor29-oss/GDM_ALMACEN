/**
 * mensajes.service — recados entre la gente de la misma empresa.
 *
 * QUÉ RESUELVE
 * "Ya salió el camión", "el cliente pidió cambiar la dirección", "no timbres la
 * F-120 todavía". Hoy eso se grita entre el almacén y la oficina, o se manda por
 * WhatsApp y se pierde entre memes. Aquí queda escrito, con hora, junto al
 * sistema donde va a ocurrir la acción.
 *
 * LA FRONTERA ES LA EMPRESA, NO EL DOMINIO DEL CORREO
 * Se habló de "usuarios del mismo dominio", y en los datos eso es el mismo
 * `company_id`: el alta hace que los usuarios de una empresa compartan dominio
 * —el cajero de un almacén hereda el de quien lo dio de alta—. Filtrar por el
 * texto del correo dejaría fuera al contador externo que entra con su Gmail,
 * que es justamente alguien a quien hay que poder mandarle un recado.
 *
 * NO ES CHAT NI CORREO
 * Sin adjuntos, sin grupos, sin borradores. Cada una de esas piezas trae su
 * propia pantalla y su propia forma de fallar, y ninguna hace que el recado
 * llegue mejor.
 */

import { query } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

export interface Mensaje {
  id: string;
  de_user_id: string | null;
  de_nombre: string;
  para_user_id: string | null;
  para_nombre: string;
  asunto: string | null;
  cuerpo: string;
  leido_at: string | null;
  created_at: string;
  responde_a: string | null;
}

/** A quién se le puede escribir: la gente activa de la misma empresa. */
export async function destinatarios(companyId: string, exceptoUserId: string) {
  const r = await query<any>(
    `SELECT id, email, work_group,
            NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), '') AS nombre
       FROM users
      WHERE company_id = $1 AND id <> $2
        AND is_active = true AND deleted_at IS NULL AND disabled_at IS NULL
      ORDER BY nombre NULLS LAST, email`,
    [companyId, exceptoUserId]
  );
  return r.rows.map((u: any) => ({ ...u, nombre: u.nombre || u.email }));
}

export async function enviar(
  companyId: string,
  deUserId: string,
  datos: { paraUserId: string; asunto?: string; cuerpo: string; respondeA?: string }
): Promise<Mensaje> {
  const cuerpo = String(datos?.cuerpo || '').trim();
  if (!cuerpo) throw new ValidationError('El mensaje viene vacío');
  if (!datos?.paraUserId) throw new ValidationError('Elige a quién se lo mandas');
  if (datos.paraUserId === deUserId) {
    throw new ValidationError('No puedes mandarte un mensaje a ti mismo');
  }

  /* El destinatario tiene que ser de la MISMA empresa. Sin esta comprobación,
   * mandar un id ajeno cruzaría un recado entre dos clientes del sistema —el
   * peor error posible en un sistema multiempresa. */
  const dest = await query<any>(
    `SELECT id, email,
            NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), '') AS nombre
       FROM users
      WHERE id = $1 AND company_id = $2 AND is_active = true AND deleted_at IS NULL`,
    [datos.paraUserId, companyId]
  );
  if (dest.rows.length === 0) {
    throw new NotFoundError('Ese destinatario no existe o no es de tu empresa');
  }

  const r = await query<any>(
    `INSERT INTO mensajes_internos
       (company_id, de_user_id, de_nombre, de_email,
        para_user_id, para_nombre, para_email, asunto, cuerpo, responde_a)
     SELECT $1, u.id,
            NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), ''),
            u.email,
            $2, $3, $4, $5, $6, $7
       FROM users u WHERE u.id = $8
     RETURNING *`,
    [companyId, datos.paraUserId, dest.rows[0].nombre || dest.rows[0].email,
     dest.rows[0].email, (datos.asunto || '').trim().slice(0, 150) || null,
     cuerpo, datos.respondeA || null, deUserId]
  );

  logger.info(`[mensajes] ${deUserId} → ${datos.paraUserId}: "${(datos.asunto || cuerpo).slice(0, 40)}"`);
  return r.rows[0];
}

export async function bandeja(
  companyId: string,
  userId: string,
  opts: { buzon?: 'recibidos' | 'enviados'; soloNoLeidos?: boolean; limite?: number } = {}
): Promise<Mensaje[]> {
  const enviados = opts.buzon === 'enviados';
  const params: any[] = [companyId, userId];
  const where = ['m.company_id = $1', enviados ? 'm.de_user_id = $2' : 'm.para_user_id = $2'];
  if (opts.soloNoLeidos && !enviados) where.push('m.leido_at IS NULL');

  const limite = Math.min(200, Math.max(1, opts.limite ?? 100));
  const r = await query<any>(
    `SELECT m.* FROM mensajes_internos m
      WHERE ${where.join(' AND ')}
      ORDER BY m.created_at DESC
      LIMIT ${limite}`,
    params
  );
  return r.rows;
}

/** El número del menú. Se pide seguido, por eso pesa lo menos posible. */
export async function noLeidos(companyId: string, userId: string): Promise<number> {
  const r = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM mensajes_internos
      WHERE company_id = $1 AND para_user_id = $2 AND leido_at IS NULL`,
    [companyId, userId]
  );
  return Number(r.rows[0].n);
}

/**
 * Marca leído.
 *
 * Sólo lo puede marcar su destinatario, y sólo una vez: el `leido_at IS NULL`
 * conserva la hora en que de verdad se leyó. Volver a abrirlo no la mueve, que
 * es lo que importa cuando alguien pregunta "¿a qué hora te enteraste?".
 */
export async function marcarLeido(
  companyId: string, userId: string, mensajeId: string
): Promise<any> {
  const r = await query<any>(
    `UPDATE mensajes_internos SET leido_at = NOW()
      WHERE id = $1 AND company_id = $2 AND para_user_id = $3 AND leido_at IS NULL
      RETURNING id, leido_at`,
    [mensajeId, companyId, userId]
  );
  /* Que no devuelva nada no es error: ya estaba leído. */
  return r.rows[0] || { id: mensajeId, yaEstaba: true };
}

/** Marca leído todo el buzón de una vez. */
export async function marcarTodoLeido(companyId: string, userId: string): Promise<number> {
  const r = await query(
    `UPDATE mensajes_internos SET leido_at = NOW()
      WHERE company_id = $1 AND para_user_id = $2 AND leido_at IS NULL`,
    [companyId, userId]
  );
  return r.rowCount || 0;
}
