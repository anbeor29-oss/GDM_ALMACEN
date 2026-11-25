/**
 * pie-nexo — el sello de la casa al pie de TODO reporte.
 *
 * Logo de GDM NEXO en plata y, a su derecha, «Reporte emitido por GDM NEXO».
 * Va en todas las páginas, centrado abajo.
 *
 * QUÉ LO LLEVA Y QUÉ NO
 * Lo llevan los REPORTES —lo que alguien descarga para leer o analizar: balanza,
 * estados financieros, cobranza, ventas, inventario, nómina, remesas…— con la
 * leyenda «Reporte emitido por GDM NEXO», y los COMPROBANTES —factura en sus
 * seis formatos, nota de crédito y complemento de pago— con «Sistema de GDM
 * NEXO», que es la línea discreta que la factura ya traía desde antes.
 *
 * NO lo llevan los documentos que alguien FIRMA o presenta ante una autoridad
 * —manifiesto PAC, documento de baja—: ahí la marca del software es ruido en el
 * peor sitio. El recibo de nómina detallado lleva la suya en su propio recuadro
 * «Emitido desde», que es donde los recibos la ponen.
 *
 * CÓMO SE DIBUJA
 * Con `bufferPages: true` las páginas siguen abiertas al terminar, así que se
 * recorren y se estampa el pie en cada una. Los márgenes se anulan MIENTRAS se
 * escribe: sin eso PDFKit ve que el cursor pasó el margen inferior y crea una
 * página de más —en blanco, con su propio pie— al final de cada reporte.
 */

import { NEXO_LOGO_MARCA_PNG, NEXO_LOGO_MARCA_RATIO } from './nexo-logo-marca.data';

const LEYENDA = 'Reporte emitido por GDM NEXO';
const GRIS = '#8a94a6';
const ALTO_LOGO = 16;      // pt
const HUECO = 5;           // pt entre el logo y la leyenda
const DESDE_ABAJO = 30;    // pt desde el borde inferior de la hoja

/**
 * Dibuja el logo + la leyenda, centrados, en la Y que se le diga.
 *
 * Es la pieza que comparten el pie de los reportes y el de los comprobantes
 * —factura en sus seis formatos, nota de crédito y complemento de pago—. Antes
 * cada formato llevaba su propia copia de estas doce líneas; tres copias ya se
 * habían separado entre sí.
 *
 * Los márgenes se anulan MIENTRAS se escribe y se restauran siempre: sin eso
 * PDFKit ve que el cursor pasó el margen inferior y crea una página de más.
 */
export function marcaNexo(doc: any, o: {
  y: number;                 // borde superior del logo
  alto?: number;             // alto del logo en pt
  leyenda?: string;
  color?: string;
  x?: number; ancho?: number; // área donde se centra; por omisión, la hoja
} ): void {
  const margenes = { ...doc.page.margins };
  doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
  try {
    const alto = o.alto ?? ALTO_LOGO;
    const leyenda = o.leyenda ?? LEYENDA;
    const anchoLogo = alto * NEXO_LOGO_MARCA_RATIO;
    doc.font('Helvetica').fontSize(7.5);
    const anchoTexto = doc.widthOfString(leyenda);
    const zonaX = o.x ?? 0;
    const zonaW = o.ancho ?? doc.page.width;
    const x = zonaX + (zonaW - (anchoLogo + HUECO + anchoTexto)) / 2;

    doc.image(NEXO_LOGO_MARCA_PNG, x, o.y, { width: anchoLogo, height: alto });
    doc.fillColor(o.color ?? GRIS)
      .text(leyenda, x + anchoLogo + HUECO, o.y + alto / 2 - 4, { lineBreak: false });
    doc.fillColor('#000000');
  } catch {
    /* Una marca que no se pudo dibujar NO debe tumbar el documento: el
     * contenido es lo que importa y el usuario ya lo está esperando. */
  } finally {
    doc.page.margins = margenes;
  }
}

/** Leyenda de los COMPROBANTES (factura, nota de crédito, complemento de pago). */
export const LEYENDA_COMPROBANTE = 'Sistema de GDM NEXO';

/**
 * Estampa el pie en UNA página ya activa. Se usa suelto cuando el documento no
 * guarda sus páginas (sin bufferPages) y hay que llamarlo antes de cada salto.
 */
export function pieNexo(doc: any): void {
  marcaNexo(doc, { y: doc.page.height - DESDE_ABAJO });
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
