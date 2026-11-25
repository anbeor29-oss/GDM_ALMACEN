/**
 * pie-nexo — el sello de la casa al pie de TODO reporte.
 *
 * Logo de GDM NEXO en plata y, a su derecha, «Reporte emitido por GDM NEXO».
 * Va en todas las páginas, centrado abajo.
 *
 * QUÉ LO LLEVA Y QUÉ NO
 * Lo llevan los REPORTES: lo que alguien descarga para leer o analizar (balanza,
 * estados financieros, cobranza, ventas, inventario, nómina, remesas…). NO lo
 * llevan los COMPROBANTES FISCALES ni los documentos firmados —factura, nota de
 * crédito, complemento de pago, recibo de nómina, manifiesto, documento de
 * baja—: ésos son documentos legales con su propio pie, y meterle marca de
 * software a un papel que alguien firma o presenta ante una autoridad es ruido
 * en el peor sitio. (La representación impresa del CFDI ya trae su propia línea
 * discreta, «Sistema de GDM NEXO», desde antes.)
 *
 * CÓMO SE DIBUJA
 * Con `bufferPages: true` las páginas siguen abiertas al terminar, así que se
 * recorren y se estampa el pie en cada una. Los márgenes se anulan MIENTRAS se
 * escribe: sin eso PDFKit ve que el cursor pasó el margen inferior y crea una
 * página de más —en blanco, con su propio pie— al final de cada reporte.
 */

import { NEXO_LOGO_PLATA_PNG, NEXO_LOGO_PLATA_RATIO } from './nexo-logo-plata.data';

const LEYENDA = 'Reporte emitido por GDM NEXO';
const GRIS = '#8a94a6';
const ALTO_LOGO = 16;      // pt
const HUECO = 5;           // pt entre el logo y la leyenda
const DESDE_ABAJO = 30;    // pt desde el borde inferior de la hoja

/**
 * Estampa el pie en UNA página ya activa. Se usa suelto cuando el documento no
 * guarda sus páginas (sin bufferPages) y hay que llamarlo antes de cada salto.
 */
export function pieNexo(doc: any): void {
  const margenes = { ...doc.page.margins };
  doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
  try {
    const anchoLogo = ALTO_LOGO * NEXO_LOGO_PLATA_RATIO;
    const y = doc.page.height - DESDE_ABAJO;
    doc.font('Helvetica').fontSize(7.5);
    const anchoTexto = doc.widthOfString(LEYENDA);
    const x = (doc.page.width - (anchoLogo + HUECO + anchoTexto)) / 2;

    doc.image(NEXO_LOGO_PLATA_PNG, x, y, { width: anchoLogo, height: ALTO_LOGO });
    doc.fillColor(GRIS).text(LEYENDA, x + anchoLogo + HUECO, y + ALTO_LOGO / 2 - 4, { lineBreak: false });
    doc.fillColor('#000000');
  } catch {
    /* Un pie que no se pudo dibujar NO debe tumbar el reporte: el contenido es
     * lo que importa y el usuario ya lo está esperando. */
  } finally {
    doc.page.margins = margenes;
  }
}

/**
 * Estampa el pie en TODAS las páginas del documento. Es la forma normal de
 * usarlo: se llama una sola vez, justo antes de `doc.end()`, en un documento
 * creado con `bufferPages: true`.
 */
export function pieNexoEnTodasLasPaginas(doc: any): void {
  try {
    const paginas = doc.bufferedPageRange();          // { start, count }
    for (let i = 0; i < paginas.count; i++) {
      doc.switchToPage(paginas.start + i);
      pieNexo(doc);
    }
  } catch {
    /* Sin bufferPages no hay páginas que recorrer; se omite en silencio. */
  }
}
