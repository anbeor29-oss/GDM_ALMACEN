/**
 * zip-seguro.ts — abre los paquetes del SAT sin confiar en su contenido.
 *
 * LA DEFENSA MÁS FUERTE ES NO ESCRIBIR ARCHIVOS
 * El documento (§12) pide protegerse de Zip Slip, rutas absolutas y nombres con
 * "..". Aquí eso ni siquiera puede ocurrir: los XML se leen a memoria y se
 * guardan en la base, nunca en el disco. Un nombre malicioso no tiene dónde
 * escribir. Aun así se valida el nombre —cuesta tres líneas y protege del día
 * en que alguien decida guardar los paquetes en disco.
 *
 * LO QUE SÍ ES UN RIESGO REAL: LA BOMBA ZIP
 * Un ZIP de 2 MB puede descomprimirse en 20 GB y tumbar el proceso. Por eso hay
 * tres topes —por archivo, por paquete y en número de archivos— y se revisan
 * ANTES de descomprimir, leyendo el tamaño declarado en el índice del ZIP, no
 * después de que la memoria ya se llenó.
 *
 * POR QUÉ UN LECTOR PROPIO Y NO UNA LIBRERÍA
 * Un paquete del SAT es un ZIP simple: entradas guardadas o desinfladas, sin
 * cifrado ni volúmenes. Leer su índice son cuarenta líneas con `zlib`, que ya
 * viene en Node. Traer una dependencia nueva a un sistema en producción para
 * eso —y con ella su cadena de suministro— cuesta más de lo que ahorra.
 */

import * as zlib from 'zlib';

/** Tamaño máximo de un XML suelto. Un CFDI enorme ronda los 2 MB. */
const MAX_ARCHIVO = 20 * 1024 * 1024;
/** Tamaño máximo descomprimido de un paquete completo. */
const MAX_PAQUETE = 500 * 1024 * 1024;
/** Máximo de archivos en un paquete. */
const MAX_ENTRADAS = 50_000;

export interface ArchivoDelZip {
  nombre: string;
  contenido: string;
}

export class ZipSospechoso extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ZipSospechoso';
  }
}

/** Un nombre de archivo que no intenta salirse de su carpeta. */
function nombreSeguro(nombre: string): boolean {
  if (!nombre || nombre.length > 300) return false;
  if (nombre.includes('..')) return false;
  if (nombre.startsWith('/') || nombre.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(nombre)) return false;      // C:\...
  if (nombre.includes('\0')) return false;
  return true;
}

/**
 * Extrae los XML de un paquete.
 *
 * Se recorre el índice central del ZIP, que es donde están los tamaños
 * declarados: leer las cabeceras locales una por una obligaría a descomprimir
 * para saber cuánto ocupa cada cosa, que es exactamente lo que se quiere evitar.
 */
export function extraerXml(zip: Buffer): ArchivoDelZip[] {
  if (zip.length < 22) throw new ZipSospechoso('El paquete está vacío o truncado.');

  // Fin del índice central (EOCD): firma 0x06054b50, buscada desde el final.
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0 && i > zip.length - 65_557; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipSospechoso('No es un archivo ZIP válido (falta el índice).');

  const entradas = zip.readUInt16LE(eocd + 10);
  const inicioIndice = zip.readUInt32LE(eocd + 16);
  if (entradas > MAX_ENTRADAS) {
    throw new ZipSospechoso(`El paquete declara ${entradas} archivos; el tope es ${MAX_ENTRADAS}.`);
  }

  const archivos: ArchivoDelZip[] = [];
  let p = inicioIndice;
  let acumulado = 0;

  for (let n = 0; n < entradas; n++) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== 0x02014b50) break;

    const metodo = zip.readUInt16LE(p + 10);
    const comprimido = zip.readUInt32LE(p + 20);
    const original = zip.readUInt32LE(p + 24);
    const largoNombre = zip.readUInt16LE(p + 28);
    const largoExtra = zip.readUInt16LE(p + 30);
    const largoComentario = zip.readUInt16LE(p + 32);
    const offsetLocal = zip.readUInt32LE(p + 42);
    const nombre = zip.slice(p + 46, p + 46 + largoNombre).toString('utf8');
    p += 46 + largoNombre + largoExtra + largoComentario;

    if (nombre.endsWith('/')) continue;                       // carpeta
    if (!nombreSeguro(nombre)) {
      throw new ZipSospechoso(`El paquete trae un nombre de archivo inaceptable: ${nombre.slice(0, 60)}`);
    }
    /* Sólo XML y TXT: los paquetes de metadatos vienen en texto separado por
     * pipes. Cualquier otra cosa dentro de un paquete del SAT no debería estar
     * ahí, y abrirla "por si acaso" es cómo se cuelan sorpresas. */
    if (!/\.(xml|txt)$/i.test(nombre)) continue;

    if (original > MAX_ARCHIVO) {
      throw new ZipSospechoso(
        `Un archivo del paquete declara ${(original / 1048576).toFixed(1)} MB descomprimidos; ` +
        `el tope por archivo es ${MAX_ARCHIVO / 1048576} MB.`
      );
    }
    acumulado += original;
    if (acumulado > MAX_PAQUETE) {
      throw new ZipSospechoso(
        `El paquete pasa de ${MAX_PAQUETE / 1048576} MB descomprimidos. Se detiene por seguridad.`
      );
    }

    // Cabecera local: el contenido empieza después del nombre y los extras.
    if (offsetLocal + 30 > zip.length || zip.readUInt32LE(offsetLocal) !== 0x04034b50) {
      throw new ZipSospechoso(`El índice del ZIP apunta a un lugar inválido (${nombre.slice(0, 40)}).`);
    }
    const inicioDatos = offsetLocal + 30 +
      zip.readUInt16LE(offsetLocal + 26) + zip.readUInt16LE(offsetLocal + 28);
    const datos = zip.subarray(inicioDatos, inicioDatos + comprimido);

    let contenido: Buffer;
    if (metodo === 0) {
      contenido = datos;                                        // guardado
    } else if (metodo === 8) {
      contenido = zlib.inflateRawSync(datos, { maxOutputLength: MAX_ARCHIVO });
    } else {
      throw new ZipSospechoso(`Método de compresión no soportado (${metodo}) en ${nombre.slice(0, 40)}.`);
    }

    archivos.push({ nombre, contenido: contenido.toString('utf8') });
  }

  if (archivos.length === 0) {
    throw new ZipSospechoso('El paquete no trae ningún XML ni TXT.');
  }
  return archivos;
}
