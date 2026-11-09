/**
 * OCR de estados de cuenta ESCANEADOS (documento §4.4).
 *
 * El runtime de Render NO tiene Tesseract ni Python nativos, así que todo es **puro
 * WASM / JS con licencia permisiva** (apto para un producto comercial):
 *   · `@hyzyla/pdfium` (MIT · PDFium) → renderiza cada página del PDF a un bitmap RGBA.
 *   · `pngjs` (MIT) → empaqueta el bitmap como PNG para el OCR.
 *   · `tesseract.js` (Apache-2.0) → reconoce el texto (español + inglés).
 * (Se evitó `mupdf` a propósito: es AGPL-3.0 y en un SaaS obligaría a liberar el código.)
 *
 * Es LENTO y pesado (segundos por página), así que va **apagado por defecto**: se
 * enciende con `ENABLE_OCR=true` en el servidor, igual que los demás motores que
 * actúan. El texto que produce es REAL (no el mojibake de HSBC), así que pasa por el
 * extractor normal; como el OCR puede equivocarse, el resultado se marca para REVISIÓN
 * y el cuadre de saldos es la red que delata una cifra mal leída.
 */
import logger from '../../middleware/logger';
import { banderaEncendida } from '../../utils/env-flag';

// Tope de páginas (un estado de cuenta rara vez pasa de ~12; evita que un PDF enorme
// amarre el proceso). Escala 2× = mejor lectura sin disparar la memoria.
const MAX_PAGINAS = Math.min(30, Math.max(1, Number(process.env.OCR_MAX_PAGINAS) || 12));
const ESCALA = Math.min(4, Math.max(1, Number(process.env.OCR_ESCALA) || 2));
const IDIOMAS = process.env.OCR_IDIOMAS || 'spa+eng';

/** ¿Está encendido el OCR? (ENABLE_OCR=true). Apagado, los escaneados se rechazan igual. */
export function ocrHabilitado(): boolean {
  return banderaEncendida(process.env.ENABLE_OCR);
}

/**
 * Convierte un PDF escaneado (imagen) a TEXTO por OCR, página por página. Lanza si algo
 * falla; el llamador decide el respaldo (seguir mostrando «escaneado»). No cachea el
 * worker de tesseract entre llamadas a propósito: una carga de estado de cuenta es
 * esporádica y mantener el worker vivo gastaría memoria en Render.
 */
export async function ocrPdf(buffer: Buffer): Promise<{ texto: string; paginas: number }> {
  const t0 = Date.now();
  const { PDFiumLibrary } = await import('@hyzyla/pdfium');
  const { PNG } = (await import('pngjs')) as any;   // pngjs no trae tipos; se usa como any
  const { createWorker } = await import('tesseract.js');

  const lib = await PDFiumLibrary.init();
  let worker: any = null;
  let texto = '';
  let paginas = 0;
  try {
    const doc = await lib.loadDocument(new Uint8Array(buffer));
    const total = Math.min(doc.getPageCount(), MAX_PAGINAS);
    if (total === 0) return { texto: '', paginas: 0 };

    worker = await createWorker(IDIOMAS);
    for (let i = 0; i < total; i++) {
      const page = doc.getPage(i);
      const render = await page.render({ scale: ESCALA, colorSpace: 'RGBA' });
      const png = new PNG({ width: render.width, height: render.height });
      png.data = Buffer.from(render.data);
      const pngBuf = PNG.sync.write(png);
      const { data } = await worker.recognize(pngBuf);
      texto += (data?.text || '') + '\n';
      paginas++;
    }
    try { (doc as any).destroy?.(); } catch { /* opcional */ }
  } finally {
    try { await worker?.terminate(); } catch { /* ya terminado */ }
    try { (lib as any).destroy?.(); } catch { /* opcional */ }
  }
  logger.info(`[ocr] ${paginas} página(s) reconocidas en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { texto, paginas };
}
