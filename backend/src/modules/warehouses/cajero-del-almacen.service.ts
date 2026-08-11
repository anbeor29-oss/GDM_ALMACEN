/**
 * cajero-del-almacen.service — al dar de alta un almacén, se crea su cajero.
 *
 * QUÉ HACE
 * Genera un usuario de grupo PUNTO_VENTA atado a ese almacén, con contraseña
 * temporal y cambio obligatorio en el primer acceso. El ADMIN completa el
 * nombre y le entrega la clave.
 *
 * EL CORREO SALE DEL DOMINIO DE QUIEN DA DE ALTA
 * Si el ADMIN entró como `antonio@hcgm.com.mx` y crea la "Bodega Centro", el
 * cajero queda como `bodega-centro@hcgm.com.mx`. Es lo que pidió Antonio y
 * tiene sentido: el dominio de la empresa que opera el sistema es el único que
 * está disponible sin preguntar nada.
 *
 * LA CONTRASEÑA SE DEVUELVE UNA VEZ Y NO SE GUARDA EN CLARO
 * Se muestra al ADMIN en la misma pantalla del alta y no vuelve a aparecer. En
 * la base sólo queda el hash. Si se pierde, se restablece — que es más seguro
 * que dejarla legible en algún lado "por si acaso".
 *
 * NUNCA IMPIDE CREAR EL ALMACÉN
 * Si el correo ya existe o algo falla, el almacén se guarda igual y se devuelve
 * el motivo. Un almacén es un dato de inventario; no tiene por qué depender de
 * que su cajero se haya podido crear.
 */

import { PoolClient } from 'pg';
import { transactionQuery } from '../../config/database';
import bcryptjs from 'bcryptjs';
import logger from '../../middleware/logger';

export interface CajeroCreado {
  creado: boolean;
  email?: string;
  passwordTemporal?: string;
  motivo?: string;
}

/**
 * Convierte "Bodega Centro Nº 2" en "bodega-centro-n-2".
 *
 * Se quitan acentos y todo lo que no sea letra o número: un correo con acentos
 * o espacios es rechazado por la mitad de los servidores, y el usuario ni
 * siquiera podría teclearlo bien para entrar.
 */
function aSlug(texto: string): string {
  return String(texto)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'caja';
}

/**
 * Contraseña temporal legible pero no adivinable.
 *
 * Se evitan los caracteres que se confunden al dictarla por teléfono —O y 0,
 * l y 1, I— porque esta clave se transmite de viva voz o en un papel, y un
 * cajero que no puede entrar en su primer turno acaba usando la cuenta de
 * alguien más.
 */
function claveTemporal(): string {
  const letras = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const digitos = '23456789';
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  return (
    Array.from({ length: 4 }, () => pick(letras)).join('') + '-' +
    Array.from({ length: 4 }, () => pick(digitos)).join('')
  );
}

export async function crearCajeroDelAlmacen(
  client: PoolClient,
  opts: {
    companyId: string;
    warehouseId: string;
    warehouseCode: string;
    warehouseName: string;
    /** Correo de quien está dando de alta el almacén — de ahí sale el dominio. */
    creadorEmail?: string;
    creadorId?: string;
  }
): Promise<CajeroCreado> {
  try {
    const dominio = String(opts.creadorEmail || '').split('@')[1];
    if (!dominio) {
      return {
        creado: false,
        motivo: 'No se pudo deducir el dominio de tu correo. Crea el cajero desde Usuarios.',
      };
    }

    /* El código del almacén va primero: es corto, único por empresa y ya lo
     * eligió el usuario. El nombre sólo se usa si no hubiera código. */
    const email = `${aSlug(opts.warehouseCode || opts.warehouseName)}@${dominio}`.toLowerCase();

    const existe = await transactionQuery(client,
      'SELECT 1 FROM users WHERE LOWER(email) = $1', [email]
    );
    if (existe.rows.length > 0) {
      return {
        creado: false, email,
        motivo: `Ya existe un usuario con el correo ${email}. El almacén se creó; ` +
                'asígnale su cajero desde Usuarios.',
      };
    }

    const password = claveTemporal();
    const hash = await bcryptjs.hash(password, 10);

    await transactionQuery(client,
      `INSERT INTO users
         (email, password_hash, first_name, last_name, role, company_id,
          work_group, warehouse_id, is_active, failed_login_attempts,
          password_change_required, created_by_user_id)
       VALUES ($1, $2, $3, 'Punto de venta', 'USER', $4,
               'PUNTO_VENTA', $5, true, 0, true, $6)`,
      [email, hash, opts.warehouseName.slice(0, 100), opts.companyId,
       opts.warehouseId, opts.creadorId || null]
    );

    logger.info(`[almacenes] cajero ${email} creado para ${opts.warehouseCode}`);
    return { creado: true, email, passwordTemporal: password };
  } catch (e) {
    /* El almacén ya se guardó. Ver la nota del encabezado. */
    const motivo = (e as Error).message;
    logger.warn(`[almacenes] no se pudo crear el cajero: ${motivo}`);
    return { creado: false, motivo: `El almacén se creó, pero su cajero no: ${motivo}` };
  }
}
