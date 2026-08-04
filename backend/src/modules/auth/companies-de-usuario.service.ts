/**
 * companies-de-usuario.service.ts — a qué empresas tiene acceso un usuario, y
 * cómo cambiar entre ellas.
 *
 * POR QUÉ EXISTE
 * La empresa activa era un atributo del usuario: `users.company_id`, grabado en
 * el token al iniciar sesión. Quien administraba dos RFC necesitaba dos cuentas
 * con correos distintos, y cambiar de empresa era cerrar sesión y entrar con la
 * otra.
 *
 * Con `user_companies` la empresa activa pasa a ser una ELECCIÓN de la sesión.
 * Este módulo es el que la resuelve.
 *
 * LO DELICADO ESTÁ EN UNA SOLA LÍNEA
 * `cambiarDeEmpresa` valida la pertenencia contra la tabla puente ANTES de
 * emitir el token. Si aceptara el companyId que manda el navegador sin
 * comprobarlo, cualquier usuario podría pedir el de otra empresa y entrar a sus
 * datos fiscales. No hay atajo por rol ni caché que valga: se consulta siempre.
 */
import { query } from '../../config/database';
import { generateToken } from '../../middleware/authentication';
import { NotFoundError, ForbiddenError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

export interface EmpresaDelUsuario {
  id: string;
  rfc: string;
  business_name: string;
  work_group: string | null;
  is_default: boolean;
}

/**
 * Empresas a las que este usuario tiene acceso.
 *
 * Incluye un respaldo por `users.company_id`: mientras haya usuarios sin migrar
 * a la tabla puente, devolver una lista vacía los dejaría sin poder entrar.
 */
export async function empresasDelUsuario(userId: string): Promise<EmpresaDelUsuario[]> {
  const r = await query<EmpresaDelUsuario>(
    `SELECT c.id, c.rfc, c.business_name,
            uc.work_group, uc.is_default
       FROM user_companies uc
       JOIN companies c ON c.id = uc.company_id
      WHERE uc.user_id = $1
        AND c.deleted_at IS NULL
      ORDER BY uc.is_default DESC, c.business_name`,
    [userId]
  );
  if (r.rows.length) return r.rows;

  const legado = await query<EmpresaDelUsuario>(
    `SELECT c.id, c.rfc, c.business_name,
            u.work_group, true AS is_default
       FROM users u
       JOIN companies c ON c.id = u.company_id
      WHERE u.id = $1 AND c.deleted_at IS NULL`,
    [userId]
  );
  return legado.rows;
}

/**
 * Emite un token nuevo con la empresa elegida.
 *
 * Se emite uno NUEVO en vez de modificar el actual porque un JWT está firmado:
 * cambiarle un campo lo invalida. Y porque así el cambio de empresa queda
 * registrado como lo que es —una nueva sesión sobre otro contexto— y no como una
 * mutación silenciosa de la que ya existía.
 */
export async function cambiarDeEmpresa(
  userId: string,
  email: string,
  role: string,
  companyId: string,
) {
  /* LA COMPROBACIÓN QUE SOSTIENE TODO EL AISLAMIENTO.
   * Se consulta la pertenencia real; no se confía en lo que llegó del cliente. */
  const r = await query<{ id: string; rfc: string; business_name: string; work_group: string | null }>(
    `SELECT c.id, c.rfc, c.business_name, uc.work_group
       FROM user_companies uc
       JOIN companies c ON c.id = uc.company_id
      WHERE uc.user_id = $1 AND uc.company_id = $2 AND c.deleted_at IS NULL`,
    [userId, companyId]
  );
  let empresa = r.rows[0];

  if (!empresa) {
    /* Respaldo para usuarios aún no migrados: si la empresa pedida es la suya de
     * siempre, se acepta. Cualquier otra, no. */
    const legado = await query<any>(
      `SELECT c.id, c.rfc, c.business_name, u.work_group
         FROM users u JOIN companies c ON c.id = u.company_id
        WHERE u.id = $1 AND c.id = $2 AND c.deleted_at IS NULL`,
      [userId, companyId]
    );
    empresa = legado.rows[0];
  }

  if (!empresa) {
    logger.warn(`Intento de cambiar a una empresa sin acceso: usuario ${userId} → ${companyId}`);
    throw new ForbiddenError('No tienes acceso a esa empresa.');
  }

  /* El grupo de trabajo es EL DE ESA EMPRESA. Arrastrar el de la anterior sería
   * darle permisos que aquí no le tocan. */
  const ug = await query<{ work_group: string | null }>(
    `SELECT work_group FROM users WHERE id = $1`, [userId]
  );
  const workGroup = empresa.work_group || ug.rows[0]?.work_group || 'ADMIN_ALL';

  const token = generateToken({ userId, email, role, companyId: empresa.id, workGroup });

  logger.info(`Usuario ${email} cambió a la empresa ${empresa.rfc} (${empresa.business_name})`);

  return {
    token,
    company: {
      id: empresa.id,
      rfc: empresa.rfc,
      business_name: empresa.business_name,
    },
    workGroup,
  };
}

/** Asocia un usuario con una empresa. Para el panel de SUPER_ADMIN. */
export async function asociarEmpresa(
  userId: string,
  companyId: string,
  workGroup?: string,
) {
  const u = await query(`SELECT id FROM users WHERE id = $1`, [userId]);
  if (!u.rows.length) throw new NotFoundError('Usuario no encontrado');
  const c = await query(`SELECT id FROM companies WHERE id = $1 AND deleted_at IS NULL`, [companyId]);
  if (!c.rows.length) throw new NotFoundError('Empresa no encontrada');

  /* La primera asociación es la de omisión: si no, un usuario con una sola
   * empresa se quedaría sin ninguna marcada y la pantalla no sabría cuál abrir. */
  const previas = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM user_companies WHERE user_id = $1`, [userId]
  );
  const esPrimera = Number(previas.rows[0]?.n || 0) === 0;

  await query(
    `INSERT INTO user_companies (user_id, company_id, work_group, is_default)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, company_id)
     DO UPDATE SET work_group = EXCLUDED.work_group`,
    [userId, companyId, workGroup || null, esPrimera]
  );

  return empresasDelUsuario(userId);
}

/** Quita el acceso de un usuario a una empresa. */
export async function desasociarEmpresa(userId: string, companyId: string) {
  const r = await query<{ is_default: boolean }>(
    `DELETE FROM user_companies WHERE user_id = $1 AND company_id = $2
     RETURNING is_default`,
    [userId, companyId]
  );

  /* Si se quitó la de omisión y quedan otras, hay que marcar una: sin ninguna,
   * el usuario entraría sin empresa activa y las consultas filtrarían por
   * undefined — que no falla, simplemente no devuelve nada, y eso es peor que
   * un error porque parece que se perdieron los datos. */
  if (r.rows[0]?.is_default) {
    await query(
      `UPDATE user_companies SET is_default = true
        WHERE id = (SELECT id FROM user_companies WHERE user_id = $1 ORDER BY created_at LIMIT 1)`,
      [userId]
    );
  }
  return empresasDelUsuario(userId);
}
