/**
 * efirma.ts — lee y valida la e.firma antes de dejar que se use.
 *
 * POR QUÉ VALIDAR ANTES Y NO "A VER QUÉ DICE EL SAT"
 * El servicio de descarga masiva responde con códigos como 300 o 305 —"revisar
 * identidad", "tipo o codificación del certificado"— que no distinguen entre un
 * archivo corrupto, una contraseña equivocada, un certificado vencido o haber
 * subido el CSD en lugar de la e.firma. Averiguar cuál de las cuatro es cuesta
 * horas. Aquí se responde antes de mandar nada, y con nombre y apellido.
 *
 * LO QUE MÁS SE EQUIVOCA: SUBIR EL CSD
 * Son dos certificados del SAT que se parecen y sirven para cosas distintas: el
 * CSD sella facturas, la e.firma identifica al contribuyente. Casi todo el
 * mundo tiene los dos en la misma carpeta y sube el que encuentra primero. Se
 * distinguen por el uso de llave declarado en el certificado: la e.firma incluye
 * cifrado de datos (bit dataEncipherment) porque sirve para autenticarse; el CSD
 * sólo firma y no repudia. Es una heurística —no hay un campo que diga "soy una
 * e.firma"— pero es la que usan todas las bibliotecas serias del ramo, y falla
 * del lado seguro: ante la duda, rechaza y lo dice.
 *
 * LA CONTRASEÑA NO SE REGISTRA NUNCA
 * Ni en bitácora, ni en el mensaje de error, ni en el objeto que se devuelve.
 * Sólo se informa si abrió la llave o no.
 */

import * as crypto from 'crypto';

export interface DatosEfirma {
  rfc: string;
  nombre: string;
  numeroSerie: string;
  vigenciaDesde: Date;
  vigenciaHasta: Date;
  /** false = es un CSD (o algo que no sirve para autenticarse ante el SAT). */
  esEfirma: boolean;
  usosDeLlave: string[];
}

export class EfirmaInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'EfirmaInvalida';
  }
}

/* Bits del BIT STRING de la extensión keyUsage (RFC 5280 §4.2.1.3), en orden. */
const USOS_DE_LLAVE = [
  'digitalSignature', 'nonRepudiation', 'keyEncipherment', 'dataEncipherment',
  'keyAgreement', 'keyCertSign', 'cRLSign', 'encipherOnly', 'decipherOnly',
];

/**
 * Lee la extensión keyUsage del DER.
 *
 * Node expone sujeto, serie y vigencia de un X.509, pero no el uso de llave, y
 * es justo el dato que separa una e.firma de un CSD. Se busca el OID 2.5.29.15
 * —`06 03 55 1D 0F` en DER— y se lee el BIT STRING que lo sigue. Es un recorte
 * quirúrgico y no un analizador de ASN.1: si el certificado no trae la
 * extensión, se devuelve vacío y el llamador decide, en vez de fingir que la
 * leyó.
 */
export function leerUsosDeLlave(der: Buffer): string[] {
  const oid = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x0f]);
  const i = der.indexOf(oid);
  if (i < 0) return [];

  let p = i + oid.length;
  // La extensión puede traer el indicador "crítica" (BOOLEAN) antes del valor.
  if (der[p] === 0x01) p += 3;
  if (der[p] !== 0x04) return [];          // OCTET STRING que envuelve el valor
  p += 2;
  if (der[p] !== 0x03) return [];          // BIT STRING
  const largo = der[p + 1];
  const bitsSinUsar = der[p + 2];
  const bytes = der.slice(p + 3, p + 2 + largo);

  const usos: string[] = [];
  const totalBits = bytes.length * 8 - bitsSinUsar;
  for (let bit = 0; bit < totalBits && bit < USOS_DE_LLAVE.length; bit++) {
    const octeto = bytes[Math.floor(bit / 8)];
    if (octeto & (0x80 >> (bit % 8))) usos.push(USOS_DE_LLAVE[bit]);
  }
  return usos;
}

/** El RFC vive en el sujeto, con nombre distinto según cómo se emitió. */
function rfcDelSujeto(sujeto: string): string {
  for (const linea of sujeto.split('\n')) {
    const [clave, ...resto] = linea.split('=');
    if (!/^(x500UniqueIdentifier|uniqueIdentifier|serialNumber)$/i.test(clave.trim())) continue;
    /* Viene como "URE180429TM6 / VADA800927DJ3": el primero es el RFC del
     * titular y el segundo el del representante legal. */
    const valor = resto.join('=').split('/')[0].trim();
    if (/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(valor)) return valor.toUpperCase();
  }
  return '';
}

function campoDelSujeto(sujeto: string, campo: string): string {
  const m = new RegExp(`^${campo}=(.*)$`, 'mi').exec(sujeto);
  return m ? m[1].trim() : '';
}

/**
 * Valida el par .cer/.key y su contraseña.
 *
 * @param cer  contenido del .cer (DER, tal como lo entrega el SAT)
 * @param key  contenido del .key (PKCS#8 cifrado, DER)
 * @param password contraseña de la llave privada — no se guarda ni se registra
 */
export function validarEfirma(cer: Buffer, key: Buffer, password: string): DatosEfirma {
  if (!cer?.length) throw new EfirmaInvalida('El archivo .cer viene vacío.');
  if (!key?.length) throw new EfirmaInvalida('El archivo .key viene vacío.');

  let certificado: crypto.X509Certificate;
  try {
    certificado = new crypto.X509Certificate(cer);
  } catch {
    throw new EfirmaInvalida(
      'El .cer no se pudo leer. El SAT entrega el certificado en formato DER; ' +
      'si lo abriste y lo volviste a guardar, o subiste otro archivo por error, ' +
      'vuelve a descargarlo del portal.'
    );
  }

  const ahora = new Date();
  const desde = new Date(certificado.validFrom);
  const hasta = new Date(certificado.validTo);
  if (ahora < desde) {
    throw new EfirmaInvalida(`Ese certificado empieza a ser válido hasta el ${desde.toLocaleDateString('es-MX')}.`);
  }
  if (ahora > hasta) {
    throw new EfirmaInvalida(
      `Ese certificado venció el ${hasta.toLocaleDateString('es-MX')}. ` +
      'Renuévalo en el portal del SAT y vuelve a cargarlo.'
    );
  }

  const usos = leerUsosDeLlave(cer);
  const esEfirma = usos.includes('dataEncipherment') || usos.includes('keyEncipherment');
  if (usos.length > 0 && !esEfirma) {
    throw new EfirmaInvalida(
      'Eso es un CSD (sello digital), no una e.firma. El CSD sirve para timbrar ' +
      'facturas; la descarga masiva exige la e.firma, que es la que identifica ' +
      'al contribuyente. Suele estar en otra carpeta y sus archivos empiezan ' +
      'con las siglas FIEL.'
    );
  }

  /* La contraseña se prueba abriendo la llave de verdad. Node lee PKCS#8
   * cifrado en DER, que es exactamente lo que entrega el SAT. */
  let llave: crypto.KeyObject;
  try {
    llave = crypto.createPrivateKey({
      key, format: 'der', type: 'pkcs8', passphrase: password,
    });
  } catch {
    throw new EfirmaInvalida(
      'La contraseña no abre el archivo .key. Es la de la CLAVE PRIVADA, que no ' +
      'siempre es la misma que la de acceso al portal del SAT.'
    );
  }

  /* Que el .cer y el .key sean pareja.
   *
   * Se comprueba firmando algo y verificándolo con la llave pública del
   * certificado: si son de trámites distintos —pasa cuando alguien mezcla la
   * e.firma vieja con la nueva—, cada solicitud al SAT sería rechazada con un
   * código que no explica nada. */
  const prueba = Buffer.from('pareja-cer-key');
  const firma = crypto.sign('sha256', prueba, llave);
  if (!crypto.verify('sha256', prueba, certificado.publicKey, firma)) {
    throw new EfirmaInvalida(
      'El .cer y el .key no son pareja: son de trámites distintos. Vuelve a ' +
      'tomar los dos archivos de la misma carpeta de e.firma.'
    );
  }

  const rfc = rfcDelSujeto(certificado.subject);
  if (!rfc) {
    throw new EfirmaInvalida('No se pudo leer el RFC del certificado.');
  }

  return {
    rfc,
    nombre: campoDelSujeto(certificado.subject, 'CN') ||
            campoDelSujeto(certificado.subject, 'O') || rfc,
    /* El SAT numera sus certificados con 20 dígitos, pero dentro del X.509 esos
     * dígitos van guardados como texto ASCII. Leer el número "en crudo" da un
     * hexadecimal ilegible que no coincide con el del portal. */
    numeroSerie: Buffer.from(certificado.serialNumber, 'hex').toString('ascii'),
    vigenciaDesde: desde,
    vigenciaHasta: hasta,
    esEfirma: true,
    usosDeLlave: usos,
  };
}

/** Firma bytes con la llave privada de la e.firma (RSA-SHA1, que es lo que pide el SAT). */
export function firmarSha1(datos: string | Buffer, key: Buffer, password: string): Buffer {
  const llave = crypto.createPrivateKey({
    key, format: 'der', type: 'pkcs8', passphrase: password,
  });
  return crypto.sign('sha1', Buffer.from(datos as any), llave);
}
