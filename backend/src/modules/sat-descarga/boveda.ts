/**
 * boveda.ts — guarda la e.firma cifrada y la entrega sólo a quien la va a usar.
 *
 * POR QUÉ UNA LLAVE MAESTRA APARTE (SAT_VAULT_KEY) Y NO LA DE SIEMPRE
 * `ENCRYPTION_KEY` ya cifra la contraseña de los CSD. Reutilizarla aquí ataría
 * dos secretos de gravedad distinta: una contraseña de sello digital se
 * reemplaza pidiendo otro CSD, y la llave privada de la e.firma tiene efectos
 * de firma autógrafa. Con llaves separadas, rotar una no obliga a recargar la
 * otra, y quien tenga acceso a una no obtiene la otra.
 *
 * SI NO ESTÁ CONFIGURADA, EL MÓDULO NO ARRANCA
 * No hay respaldo silencioso a una llave por omisión. Una bóveda con llave
 * conocida es peor que no tener bóveda: da la impresión de proteger algo.
 *
 * FORMATO — base64( iv(12) | tag(16) | datos cifrados )
 * AES-256-GCM, con el tag ANTES del contenido: si alguien altera el registro,
 * el descifrado falla en vez de devolver basura.
 */

import * as crypto from 'crypto';

const LARGO_IV = 12;
const LARGO_TAG = 16;

export class BovedaSinConfigurar extends Error {
  constructor() {
    super(
      'Falta la variable SAT_VAULT_KEY. La descarga masiva guarda la e.firma ' +
      'cifrada y no arranca sin su llave maestra — que debe vivir en el ' +
      'servidor, nunca en la base de datos.'
    );
    this.name = 'BovedaSinConfigurar';
  }
}

function llaveMaestra(): Buffer {
  const raw = process.env.SAT_VAULT_KEY || '';
  if (raw.length < 32) throw new BovedaSinConfigurar();
  /* SHA-256 sobre el valor configurado: acepta una frase de cualquier largo y
   * siempre produce los 32 bytes que pide AES-256, sin rellenar con ceros —que
   * es como se pierde entropía sin darse cuenta. */
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

/** ¿Está configurada? Sirve para avisar en la pantalla antes de pedir archivos. */
export function bovedaLista(): boolean {
  try { llaveMaestra(); return true; } catch { return false; }
}

export function cifrar(datos: Buffer | string): string {
  const iv = crypto.randomBytes(LARGO_IV);
  const cipher = crypto.createCipheriv('aes-256-gcm', llaveMaestra(), iv);
  const buf = Buffer.isBuffer(datos) ? datos : Buffer.from(datos, 'utf8');
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function descifrar(guardado: string): Buffer {
  const raw = Buffer.from(guardado, 'base64');
  const iv = raw.subarray(0, LARGO_IV);
  const tag = raw.subarray(LARGO_IV, LARGO_IV + LARGO_TAG);
  const enc = raw.subarray(LARGO_IV + LARGO_TAG);
  const decipher = crypto.createDecipheriv('aes-256-gcm', llaveMaestra(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

export function descifrarTexto(guardado: string): string {
  return descifrar(guardado).toString('utf8');
}
