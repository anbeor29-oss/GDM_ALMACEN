/**
 * descarga-69b.service — trae la lista del 69-B del portal del SAT.
 *
 * DE DÓNDE SALE
 * El SAT la publica como datos abiertos en
 * https://www.sat.gob.mx/minisitio/DatosAbiertos/contribuyentes_publicados.html
 * y los archivos viven en un almacenamiento de Azure. No hay API: son CSV que
 * se reemplazan cada corte. Se descarga el LISTADO COMPLETO porque trae las
 * cuatro situaciones en un solo archivo —presunto, definitivo, desvirtuado y
 * sentencia favorable—; bajar sólo "Definitivos" dejaría a un contribuyente
 * marcado como definitivo para siempre aunque después lo desvirtuara.
 *
 * LA DIRECCIÓN ES CONFIGURABLE
 * Va en SAT_69B_URL. La de abajo es la que el portal publicaba al escribir
 * esto, comprobada bajando el archivo; pero es una URL de un almacenamiento
 * ajeno y puede cambiar sin aviso. Cuando cambie se ajusta la variable, sin
 * tocar código ni volver a desplegar.
 *
 * SI FALLA, NO PISA LO QUE HAY
 * Una descarga incompleta o una página de error de 200 bytes no debe reemplazar
 * un padrón bueno. Se comprueba tamaño y contenido ANTES de importar: sin eso,
 * el día que el SAT mueva el archivo, la lista se vaciaría en silencio y la
 * pantalla diría que ninguno de tus proveedores está en el 69-B — la peor
 * mentira posible en este módulo.
 */

import * as https from 'https';
import logger from '../../middleware/logger';
import { ValidationError } from '../../middleware/errorHandler';
import { importarLista } from './lista-69b.service';

export const URL_69B =
  process.env.SAT_69B_URL ||
  'https://wu1agsprosta001.blob.core.windows.net/agsc-publicaciones/' +
  'Datos_abiertos/Documents_AGAFF/Listado_completo_69-B.csv';

/* El archivo real de mayo de 2026 pesa 4.7 MB. Los topes son holgados en ambas
 * direcciones: por abajo para descartar una página de error, por arriba para no
 * quedarnos sin memoria si algún día sirven otra cosa en esa dirección. */
const MINIMO_BYTES = 200 * 1024;        // 200 KB
const MAXIMO_BYTES = 80 * 1024 * 1024;  // 80 MB
const TIEMPO_LIMITE_MS = 120_000;

export interface Descarga {
  bytes: number;
  ultimaModificacion: string | null;
  texto: string;
}

/** Baja el archivo. No importa nada: sólo trae y comprueba. */
export function descargar(url = URL_69B): Promise<Descarga> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: TIEMPO_LIMITE_MS }, (res) => {
      /* Azure redirige de vez en cuando; se sigue una sola vez para no entrar
       * en un ciclo si algún día apunta a sí mismo. */
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const destino = res.headers.location;
        logger.info(`[69-B] redirección a ${destino}`);
        https.get(destino, { timeout: TIEMPO_LIMITE_MS }, (r2) => leer(r2, resolve, reject))
          .on('error', reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new ValidationError(
          `El portal del SAT respondió ${res.statusCode} al pedir la lista del 69-B. ` +
          'Puede que hayan movido el archivo: revisa SAT_69B_URL.'
        ));
        return;
      }
      leer(res, resolve, reject);
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new ValidationError('El portal del SAT no respondió a tiempo.'));
    });
    req.on('error', (e) =>
      reject(new ValidationError(`No se pudo conectar con el portal del SAT: ${e.message}`)));
  });
}

function leer(
  res: NodeJS.ReadableStream & { headers?: any },
  resolve: (d: Descarga) => void,
  reject: (e: any) => void
) {
  const partes: Buffer[] = [];
  let total = 0;
  res.on('data', (c: Buffer) => {
    total += c.length;
    if (total > MAXIMO_BYTES) {
      reject(new ValidationError(
        `El archivo pasa de ${Math.round(MAXIMO_BYTES / 1024 / 1024)} MB. Se abandona la descarga.`
      ));
      (res as any).destroy?.();
      return;
    }
    partes.push(c);
  });
  res.on('error', reject);
  res.on('end', () => {
    const buf = Buffer.concat(partes);
    if (buf.length < MINIMO_BYTES) {
      reject(new ValidationError(
        `Lo que llegó pesa ${buf.length} bytes, muy poco para el padrón del 69-B. ` +
        'Probablemente sea una página de error, no el archivo. NO se tocó la lista que ya estaba.'
      ));
      return;
    }
    /* El SAT publica en Windows-1252: leerlo como UTF-8 llena de rombos los
     * nombres con acentos, que son la mitad del padrón. */
    resolve({
      bytes: buf.length,
      ultimaModificacion: (res.headers?.['last-modified'] as string) || null,
      texto: buf.toString('latin1'),
    });
  });
}

/**
 * Descarga y carga. Es lo que corre el botón de la pantalla y el cron.
 *
 * Si la descarga falla, el padrón anterior se queda intacto: el import sólo
 * ocurre con un archivo que ya pasó las comprobaciones.
 */
export async function actualizarDesdeElSat(userId?: string) {
  const t0 = Date.now();
  const d = await descargar();

  /* Comprobación de contenido, no sólo de tamaño: 5 MB de HTML también pesan.
   * Si no trae una columna RFC no es el padrón, y el importador lo diría — pero
   * con un mensaje sobre encabezados que no explicaría de dónde vino. */
  if (!/\bRFC\b/i.test(d.texto.slice(0, 4000))) {
    throw new ValidationError(
      'El archivo que devolvió el portal no parece el padrón del 69-B (no trae una ' +
      'columna RFC en las primeras líneas). NO se tocó la lista que ya estaba.'
    );
  }

  const nombre = `SAT 69-B (descarga automática${
    d.ultimaModificacion ? `, publicado ${new Date(d.ultimaModificacion).toLocaleDateString('es-MX')}` : ''
  })`;

  const r = await importarLista(d.texto, nombre, userId);
  const segundos = ((Date.now() - t0) / 1000).toFixed(1);
  logger.info(
    `[69-B] descarga automática: ${(d.bytes / 1024 / 1024).toFixed(1)} MB, ` +
    `${r.renglones} renglones en ${segundos}s`
  );
  return { ...r, bytes: d.bytes, ultimaModificacion: d.ultimaModificacion, segundos, url: URL_69B };
}
