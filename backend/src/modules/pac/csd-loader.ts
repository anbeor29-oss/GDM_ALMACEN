/**
 * csd-loader.ts — obtiene el CSD de una empresa para sellar o cancelar.
 *
 * POR QUÉ EXISTE
 * La carga del certificado estaba escrita dos veces dentro de pac.service —una
 * en cancelInvoice y otra en cancelarComprobante— y ninguna decía por qué no lo
 * había encontrado. Cuando el archivo desaparecía del disco, el sistema cambiaba
 * a la bóveda del PAC EN SILENCIO y el error que llegaba al usuario era un
 * CA305 sin relación aparente con la causa. Averiguarlo costó una tarde.
 *
 * Aquí se resuelve en un solo lugar y, sobre todo, **siempre se dice qué pasó**:
 * el resultado incluye un `motivo` legible que el llamador puede registrar o
 * mostrar. Un fallback que no se anuncia no es un fallback, es un error latente.
 *
 * DE DÓNDE SALE EL CERTIFICADO, EN ESTE ORDEN
 *
 *  1. De la BASE DE DATOS (csd_cer_data / csd_key_data), cifrado. Es la fuente
 *     buena: sobrevive a los despliegues.
 *  2. Del DISCO (csd_cer_path / csd_key_path). Respaldo temporal para las
 *     empresas que aún no se migran. En Render el disco es efímero, así que
 *     esta vía puede fallar en cualquier momento — por eso avisa.
 *
 * El orden importa: si estuviera al revés, una empresa ya migrada seguiría
 * leyendo un archivo viejo que podría no corresponder al certificado vigente.
 */
import * as fs from 'fs';
import { query } from '../../config/database';
import { decryptCsdPassword } from '../../utils/csd-crypto';
import logger from '../../middleware/logger';

export interface CsdDeEmpresa {
  b64Cer: string;
  b64Key: string;
  password: string;
}

export interface ResultadoCsd {
  /** El certificado, o null si no hay uno utilizable. */
  csd: CsdDeEmpresa | null;
  /** De dónde salió, o por qué no salió. Siempre con algo que decir. */
  motivo: string;
  /** true cuando vino del disco: sirve para avisar que hay que migrarla. */
  desdeDisco: boolean;
}

export async function obtenerCsdDeEmpresa(companyId: string): Promise<ResultadoCsd> {
  let fila: any;
  try {
    const r = await query<any>(
      `SELECT csd_cer_data, csd_key_data, csd_cer_path, csd_key_path, csd_password_encrypted
         FROM companies WHERE id = $1`,
      [companyId]
    );
    fila = r.rows[0];
  } catch (e) {
    return {
      csd: null,
      desdeDisco: false,
      motivo: `no se pudo consultar el CSD de la empresa: ${(e as Error).message}`,
    };
  }

  if (!fila) {
    return { csd: null, desdeDisco: false, motivo: 'la empresa no existe' };
  }
  if (!fila.csd_password_encrypted) {
    return {
      csd: null,
      desdeDisco: false,
      motivo: 'la empresa no tiene CSD cargado (falta la contraseña del .key)',
    };
  }

  /* La contraseña se descifra primero: si la llave de cifrado cambió, no hay
   * certificado que valga y conviene decirlo con ese nombre y no como "falta el
   * CSD", que mandaría a buscar en el lugar equivocado. */
  let password: string;
  try {
    password = decryptCsdPassword(fila.csd_password_encrypted);
  } catch (e) {
    return {
      csd: null,
      desdeDisco: false,
      motivo:
        `la contraseña del CSD no se pudo descifrar (${(e as Error).message}). ` +
        `Suele significar que ENCRYPTION_KEY cambió: hay que volver a cargar el CSD.`,
    };
  }

  // 1) Base de datos.
  if (fila.csd_cer_data && fila.csd_key_data) {
    try {
      return {
        csd: {
          b64Cer: decryptCsdPassword(fila.csd_cer_data),
          b64Key: decryptCsdPassword(fila.csd_key_data),
          password,
        },
        desdeDisco: false,
        motivo: 'CSD leído de la base de datos',
      };
    } catch (e) {
      return {
        csd: null,
        desdeDisco: false,
        motivo: `el CSD guardado en la base no se pudo descifrar: ${(e as Error).message}`,
      };
    }
  }

  // 2) Disco, como respaldo.
  if (fila.csd_cer_path && fila.csd_key_path) {
    if (!fs.existsSync(fila.csd_cer_path) || !fs.existsSync(fila.csd_key_path)) {
      return {
        csd: null,
        desdeDisco: true,
        motivo:
          `el CSD está registrado en disco (${fila.csd_cer_path}) pero el archivo YA NO EXISTE. ` +
          `En Render el disco se borra en cada despliegue: hay que volver a cargar el CSD ` +
          `para que quede guardado en la base de datos.`,
      };
    }
    try {
      return {
        csd: {
          b64Cer: fs.readFileSync(fila.csd_cer_path).toString('base64'),
          b64Key: fs.readFileSync(fila.csd_key_path).toString('base64'),
          password,
        },
        desdeDisco: true,
        motivo: 'CSD leído del disco — pendiente de migrar a la base de datos',
      };
    } catch (e) {
      return {
        csd: null,
        desdeDisco: true,
        motivo: `no se pudo leer el CSD del disco: ${(e as Error).message}`,
      };
    }
  }

  return { csd: null, desdeDisco: false, motivo: 'la empresa no tiene CSD cargado' };
}

/**
 * Igual que la anterior, pero deja constancia en el log.
 *
 * Se separa para que el aviso no dependa de que cada llamador se acuerde de
 * escribirlo — que es justamente lo que no ocurrió antes.
 */
export async function obtenerCsdConAviso(
  companyId: string,
  contexto: string,
): Promise<ResultadoCsd> {
  const r = await obtenerCsdDeEmpresa(companyId);
  if (r.csd) {
    if (r.desdeDisco) logger.warn(`[CSD] ${contexto}: ${r.motivo}`);
    else logger.info(`[CSD] ${contexto}: ${r.motivo}`);
  } else {
    logger.warn(
      `[CSD] ${contexto}: NO se enviará el certificado — ${r.motivo}. ` +
      `Se intentará con el que el PAC tenga en su bóveda.`
    );
  }
  return r;
}
