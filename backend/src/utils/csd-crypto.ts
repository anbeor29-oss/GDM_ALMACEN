/**
 * csd-crypto.ts — cifrado y descifrado de la contraseña del CSD.
 *
 * POR QUÉ EXISTE
 * `encryptPassword` vivía dentro de companies-uploads.routes.ts, una ruta HTTP,
 * y NO tenía función inversa en ningún lado del código: la contraseña del sello
 * digital se guardaba y nunca se volvía a leer. Eso bastaba mientras SW sellara
 * con el certificado de su bóveda, pero no alcanza para cancelar mandando el
 * CSD, que es lo que exige el método /cfdi33/cancel/csd.
 *
 * Se extrae aquí, junto a su inverso, por dos razones:
 *
 *  · Un módulo de rutas no es lugar para primitivas de cifrado. Quien las
 *    necesite desde otro servicio acaba duplicándolas, y dos implementaciones
 *    del mismo cifrado divergen: la que descifra deja de entender lo que cifró
 *    la otra, y el dato queda irrecuperable.
 *  · El formato es un contrato. Está descrito abajo para que nadie lo cambie
 *    creyendo que sólo toca su propio lado.
 *
 * FORMATO — base64( iv(12) | tag(16) | ciphertext )
 * AES-256-GCM. El tag de autenticación va ANTES del texto cifrado: si alguien
 * altera el dato guardado, `decipher.final()` lanza y no devuelve basura
 * silenciosamente, que es justo lo que queremos de la contraseña de un sello.
 *
 * OJO CON ENCRYPTION_KEY: si cambia, las contraseñas guardadas dejan de poder
 * descifrarse y hay que volver a cargar el CSD de cada empresa. No es una
 * variable que se rote a la ligera.
 */
import * as crypto from 'crypto';
import { config } from '../config/environment';

const LARGO_IV = 12;
const LARGO_TAG = 16;

function getKey(): Buffer {
  // ENCRYPTION_KEY es una cadena de 32 chars. Se usa como buffer directo.
  const raw = (config.encryption.key || '').padEnd(32, '0').slice(0, 32);
  return Buffer.from(raw, 'utf8');
}

/** Cifra la contraseña del CSD para guardarla. */
export function encryptCsdPassword(plain: string): string {
  const iv = crypto.randomBytes(LARGO_IV);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/**
 * Descifra la contraseña del CSD.
 *
 * Lanza si el dato fue alterado o si la llave no corresponde. Se deja lanzar a
 * propósito: devolver una cadena vacía o un valor por omisión haría que el
 * intento de sellar fallara más adelante con un error que no señala la causa.
 */
export function decryptCsdPassword(stored: string): string {
  const buf = Buffer.from(stored, 'base64');
  if (buf.length <= LARGO_IV + LARGO_TAG) {
    throw new Error('La contraseña del CSD guardada está incompleta o corrupta.');
  }
  const iv = buf.subarray(0, LARGO_IV);
  const tag = buf.subarray(LARGO_IV, LARGO_IV + LARGO_TAG);
  const enc = buf.subarray(LARGO_IV + LARGO_TAG);

  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
